const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const { execCommand } = require('./platform');
const {
  listExternalIPv4,
  matchingInterfaces,
  preferLocalAddress,
  isMultiHomed
} = require('./network');

const CHARGER_PORT = 8000;

/**
 * Local connection diagnostics for customer machines.
 * Can be printed, or served over a Cloudflare tunnel for remote support.
 */
class Doctor {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * @param {{ targets?: string[] }} [options]
   */
  async run(options = {}) {
    const targets = (options.targets || [])
      .map((t) => String(t).trim())
      .filter(Boolean);

    const interfaces = this._listInterfaces();
    const multiHomed = isMultiHomed();
    const routing = [];
    const pingResults = [];
    const httpResults = [];

    for (const ip of targets) {
      const matches = matchingInterfaces(ip);
      const preferred = preferLocalAddress(ip);
      routing.push({
        target: ip,
        preferredLocal: preferred,
        matchingInterfaces: matches.map((m) => `${m.name} ${m.address}/${m.cidr}`)
      });

      // Ping/HTTP via each matching NIC, then unbound — shows Wi‑Fi vs USB clearly
      const bindList = preferred
        ? [preferred, ...matches.map((m) => m.address).filter((a) => a !== preferred)]
        : [undefined];
      // Also try other external IPs when nothing matches (mask mismatch cases)
      if (!preferred) {
        for (const iface of listExternalIPv4()) {
          if (!bindList.includes(iface.address)) bindList.push(iface.address);
        }
        bindList.push(undefined);
      }

      const seenBind = new Set();
      for (const bind of bindList) {
        const key = String(bind);
        if (seenBind.has(key)) continue;
        seenBind.add(key);
        pingResults.push(await this._ping(ip, bind));
        httpResults.push(await this._probeCharger(ip, bind));
      }
    }

    const report = {
      kind: 'klvr-doctor',
      generatedAt: new Date().toISOString(),
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      multiHomed,
      interfaces,
      routing,
      ping: pingResults,
      chargerHttp: httpResults,
      summary: this._summarize(interfaces, pingResults, httpResults, multiHomed)
    };

    return report;
  }

  formatText(report) {
    const lines = [];
    lines.push('KLVR CONNECTION DOCTOR');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Host:      ${report.hostname}`);
    lines.push(`Platform:  ${report.platform}`);
    lines.push('');
    if (report.multiHomed) {
      lines.push('WARNING: Multiple networks active (Wi‑Fi + cable). Tool will bind to the matching adapter.');
      lines.push('');
    }
    lines.push('Network interfaces:');
    if (report.interfaces.length === 0) {
      lines.push('  (none)');
    } else {
      for (const iface of report.interfaces) {
        if (iface.family !== 'IPv4') continue;
        lines.push(
          `  ${iface.name}: ${iface.address}  mask=${iface.netmask}`
          + `${iface.internal ? '  (internal)' : ''}`
        );
      }
    }
    if (report.routing && report.routing.length) {
      lines.push('');
      lines.push('Routing (which adapter owns the charger IP):');
      for (const r of report.routing) {
        lines.push(
          `  ${r.target} → preferred bind ${r.preferredLocal || '(none — will try all NICs)'}`
        );
        if (r.matchingInterfaces && r.matchingInterfaces.length) {
          for (const m of r.matchingInterfaces) {
            lines.push(`      match: ${m}`);
          }
        }
      }
    }
    lines.push('');
    lines.push('Ping:');
    if (report.ping.length === 0) {
      lines.push('  (no targets)');
    } else {
      for (const p of report.ping) {
        const via = p.via ? ` via ${p.via}` : ' via default-route';
        lines.push(`  ${p.target}${via}: ${p.ok ? 'OK' : 'FAIL'}${p.detail ? ` — ${p.detail}` : ''}`);
      }
    }
    lines.push('');
    lines.push('Charger HTTP (:8000):');
    if (report.chargerHttp.length === 0) {
      lines.push('  (no targets)');
    } else {
      for (const h of report.chargerHttp) {
        const via = h.via ? ` via ${h.via}` : ' via default-route';
        if (h.ok) {
          lines.push(
            `  ${h.target}${via}: OK — ${h.deviceName || 'device'}`
            + `  fw=${h.firmware || '?'}`
          );
        } else {
          lines.push(`  ${h.target}${via}: FAIL — ${h.error}`);
        }
      }
    }
    lines.push('');
    lines.push(`Summary: ${report.summary}`);
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Serve fresh doctor reports on localhost for cloudflared.
   * @param {{ targets?: string[], port?: number }} [options]
   */
  async startServer(options = {}) {
    const targets = options.targets || [];
    const port = options.port || 0;

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const qTargets = url.searchParams.get('targets');
        const runTargets = qTargets
          ? qTargets.split(',').map((s) => s.trim()).filter(Boolean)
          : targets;

        const report = await this.run({ targets: runTargets });

        if (url.pathname === '/api/diagnostics' || url.pathname === '/json') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          });
          res.end(JSON.stringify(report, null, 2));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(this.formatText(report));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Doctor error: ${err.message}\n`);
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });

    const address = server.address();
    return {
      server,
      port: address.port,
      url: `http://127.0.0.1:${address.port}`
    };
  }

  async fetchRemote(tunnelBaseUrl) {
    const base = tunnelBaseUrl.replace(/\/$/, '');
    const jsonUrl = `${base}/api/diagnostics`;
    try {
      const body = await this._httpGet(jsonUrl, 20000);
      const report = JSON.parse(body);
      if (report && report.kind === 'klvr-doctor') {
        return { type: 'doctor', report };
      }
    } catch (_) {
      // fall through — might be a charger tunnel
    }

    try {
      const infoBody = await this._httpGet(`${base}/api/v2/device/info`, 15000);
      const info = JSON.parse(infoBody);
      return { type: 'charger', info, base };
    } catch (err) {
      throw new Error(
        `Could not read diagnostics or charger API at ${base}: ${err.message}`
      );
    }
  }

  _listInterfaces() {
    const raw = os.networkInterfaces();
    const list = [];
    for (const [name, addrs] of Object.entries(raw)) {
      for (const addr of addrs || []) {
        list.push({
          name,
          family: addr.family === 'IPv6' || addr.family === 6 ? 'IPv6' : 'IPv4',
          address: addr.address,
          netmask: addr.netmask,
          internal: !!addr.internal,
          mac: addr.mac
        });
      }
    }
    return list;
  }

  async _ping(target, sourceAddress) {
    const platform = process.platform;
    let args;
    if (platform === 'win32') {
      args = sourceAddress
        ? ['-n', '2', '-w', '2000', '-S', sourceAddress, target]
        : ['-n', '2', '-w', '2000', target];
    } else if (platform === 'darwin') {
      // macOS: -S source, -W timeout ms
      args = sourceAddress
        ? ['-c', '2', '-W', '2000', '-S', sourceAddress, target]
        : ['-c', '2', '-W', '2000', target];
    } else {
      // Linux: -I source/iface, -W timeout seconds
      args = sourceAddress
        ? ['-c', '2', '-W', '2', '-I', sourceAddress, target]
        : ['-c', '2', '-W', '2', target];
    }
    try {
      const { stdout } = await execCommand('ping', args, { timeout: 8000 });
      const ok = platform === 'win32'
        ? /TTL=/i.test(stdout) || /\(0% loss\)/i.test(stdout)
        : /bytes from/i.test(stdout) || /[12] packets received/i.test(stdout);
      const timeMatch = stdout.match(/time[=<]([\d.]+)\s*ms/i);
      return {
        target,
        via: sourceAddress || null,
        ok,
        detail: timeMatch ? `${timeMatch[1]}ms` : (ok ? 'reachable' : 'no reply')
      };
    } catch (err) {
      return { target, via: sourceAddress || null, ok: false, detail: 'no reply' };
    }
  }

  async _probeCharger(ip, localAddress) {
    const base = `http://${ip}:${CHARGER_PORT}`;
    try {
      const started = Date.now();
      const infoBody = await this._httpGet(`${base}/api/v2/device/info`, 5000, localAddress);
      const info = JSON.parse(infoBody);
      let firmware = info.firmwareVersion || info.firmware || null;
      try {
        const verBody = await this._httpGet(
          `${base}/api/v2/device/firmware_version`,
          5000,
          localAddress
        );
        const ver = JSON.parse(verBody);
        firmware = `rear=${ver.firmwareRear || ver.rear || '?'} main=${ver.firmwareMain || ver.main || '?'}`;
      } catch (_) {
        // optional
      }
      return {
        target: ip,
        via: localAddress || null,
        ok: true,
        latencyMs: Date.now() - started,
        deviceName: info.deviceName || info.name || 'Klvr',
        firmware
      };
    } catch (err) {
      return { target: ip, via: localAddress || null, ok: false, error: err.message };
    }
  }

  _httpGet(url, timeoutMs, localAddress) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const parsed = new URL(url);
      const options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs
      };
      if (localAddress) options.localAddress = localAddress;

      const req = mod.get(options, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          this._httpGet(res.headers.location, timeoutMs, localAddress).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
      req.on('error', reject);
    });
  }

  _summarize(interfaces, pingResults, httpResults, multiHomed) {
    const externalV4 = interfaces.filter((i) => i.family === 'IPv4' && !i.internal);
    if (externalV4.length === 0) {
      return 'NO usable IPv4 interface — check USB LAN / cable.';
    }
    const httpOk = httpResults.filter((h) => h.ok);
    if (httpOk.length > 0) {
      const via = httpOk[0].via ? ` via ${httpOk[0].via}` : '';
      return `Charger API reachable at ${httpOk[0].target}${via}.`
        + (multiHomed ? ' Multi-homed: tool binds to the working adapter.' : '');
    }
    const pingOk = pingResults.filter((p) => p.ok);
    if (pingOk.length > 0) {
      return `Ping OK to ${pingOk[0].target} but charger HTTP :8000 failed — wrong device or firmware API down.`;
    }
    if (pingResults.length > 0) {
      return 'No ping/HTTP via any adapter — check cable, APPLY on charger, and Mac subnet mask (use 255.255.255.0).'
        + (multiHomed ? ' Tip: temporarily disable Wi‑Fi and retry.' : '');
    }
    return 'Collected interface list only. Pass a charger IP (e.g. 10.101.0.56) for ping/HTTP tests.';
  }
}

module.exports = Doctor;
