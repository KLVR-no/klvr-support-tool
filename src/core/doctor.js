const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const { execCommand } = require('./platform');

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
    const pingResults = [];
    const httpResults = [];

    for (const ip of targets) {
      pingResults.push(await this._ping(ip));
      httpResults.push(await this._probeCharger(ip));
    }

    // Also probe any IPv4 that looks like a peer on USB/LAN adapters (same /24 guess)
    if (targets.length === 0) {
      for (const iface of interfaces) {
        if (iface.internal || iface.family !== 'IPv4') continue;
        const guess = this._guessGateway(iface.address);
        if (guess && !targets.includes(guess)) {
          pingResults.push(await this._ping(guess));
        }
      }
    }

    const report = {
      kind: 'klvr-doctor',
      generatedAt: new Date().toISOString(),
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      interfaces,
      ping: pingResults,
      chargerHttp: httpResults,
      summary: this._summarize(interfaces, pingResults, httpResults)
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
    lines.push('');
    lines.push('Ping:');
    if (report.ping.length === 0) {
      lines.push('  (no targets)');
    } else {
      for (const p of report.ping) {
        lines.push(`  ${p.target}: ${p.ok ? 'OK' : 'FAIL'}${p.detail ? ` — ${p.detail}` : ''}`);
      }
    }
    lines.push('');
    lines.push('Charger HTTP (:8000):');
    if (report.chargerHttp.length === 0) {
      lines.push('  (no targets)');
    } else {
      for (const h of report.chargerHttp) {
        if (h.ok) {
          lines.push(
            `  ${h.target}: OK — ${h.deviceName || 'device'}`
            + `  fw=${h.firmware || '?'}`
          );
        } else {
          lines.push(`  ${h.target}: FAIL — ${h.error}`);
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

  async _ping(target) {
    const platform = process.platform;
    let args;
    if (platform === 'win32') {
      args = ['-n', '2', '-w', '2000', target];
    } else if (platform === 'darwin') {
      // macOS -W is milliseconds
      args = ['-c', '2', '-W', '2000', target];
    } else {
      // Linux -W is seconds
      args = ['-c', '2', '-W', '2', target];
    }
    try {
      const { stdout } = await execCommand('ping', args, { timeout: 8000 });
      const ok = platform === 'win32'
        ? /TTL=/i.test(stdout) || /\(0% loss\)/i.test(stdout)
        : /bytes from/i.test(stdout) || /[12] packets received/i.test(stdout);
      const timeMatch = stdout.match(/time[=<]([\d.]+)\s*ms/i);
      return {
        target,
        ok,
        detail: timeMatch ? `${timeMatch[1]}ms` : (ok ? 'reachable' : 'no reply')
      };
    } catch (err) {
      return { target, ok: false, detail: 'no reply' };
    }
  }

  async _probeCharger(ip) {
    const base = `http://${ip}:${CHARGER_PORT}`;
    try {
      const started = Date.now();
      const infoBody = await this._httpGet(`${base}/api/v2/device/info`, 5000);
      const info = JSON.parse(infoBody);
      let firmware = info.firmwareVersion || info.firmware || null;
      try {
        const verBody = await this._httpGet(`${base}/api/v2/device/firmware_version`, 5000);
        const ver = JSON.parse(verBody);
        firmware = `rear=${ver.firmwareRear || ver.rear || '?'} main=${ver.firmwareMain || ver.main || '?'}`;
      } catch (_) {
        // optional
      }
      return {
        target: ip,
        ok: true,
        latencyMs: Date.now() - started,
        deviceName: info.deviceName || info.name || 'Klvr',
        firmware
      };
    } catch (err) {
      return { target: ip, ok: false, error: err.message };
    }
  }

  _httpGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: timeoutMs }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          this._httpGet(res.headers.location, timeoutMs).then(resolve, reject);
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

  _guessGateway(address) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
    // Common static direct-cable pattern: host .60 / charger .56 — don't invent; skip
    return null;
  }

  _summarize(interfaces, pingResults, httpResults) {
    const externalV4 = interfaces.filter((i) => i.family === 'IPv4' && !i.internal);
    if (externalV4.length === 0) {
      return 'NO usable IPv4 interface — check USB LAN / cable.';
    }
    const httpOk = httpResults.filter((h) => h.ok);
    if (httpOk.length > 0) {
      return `Charger API reachable at ${httpOk.map((h) => h.target).join(', ')}.`;
    }
    const pingOk = pingResults.filter((p) => p.ok);
    if (pingOk.length > 0) {
      return `Ping OK to ${pingOk.map((p) => p.target).join(', ')} but charger HTTP :8000 failed — wrong device or firmware API down.`;
    }
    if (pingResults.length > 0) {
      return 'No ping reply to tested IPs — Mac and charger are not linking on this cable/subnet.';
    }
    return 'Collected interface list only. Pass a charger IP (e.g. 10.101.0.56) for ping/HTTP tests.';
  }
}

module.exports = Doctor;
