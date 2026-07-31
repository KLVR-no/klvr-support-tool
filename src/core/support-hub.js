const http = require('http');
const { URL } = require('url');
const Doctor = require('./doctor');
const DeviceDiscovery = require('./device-discovery');
const {
  preferLocalAddress,
  isIPv4,
  listExternalIPv4
} = require('./network');

/**
 * Customer-side Support Hub — single remote entry point.
 *
 * Always starts (no charger required). Exposes diagnostics, discovery,
 * target selection, and reverse-proxies /api/v2/* to the active charger
 * with correct NIC binding for Wi‑Fi + USB LAN setups.
 */
class SupportHub {
  constructor(logger, options = {}) {
    this.logger = logger;
    this.doctor = new Doctor(logger);
    this.discovery = new DeviceDiscovery(logger);
    this.hintIps = (options.hintIps || []).filter(isIPv4);
    this.active = null; // { ip, localAddress, deviceName, firmwareVersion }
    this.server = null;
    this.port = null;
    this.url = null;
    this.startedAt = null;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((err) => {
        this.logger.debug(`Hub request error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: err.message }));
      });
    });

    // WebSocket upgrade → charger /api/v2/ws (cloudflared forwards Upgrade)
    this.server.on('upgrade', (req, socket, head) => {
      this._proxyWebSocket(req, socket, head).catch((err) => {
        this.logger.debug(`WS proxy error: ${err.message}`);
        try { socket.destroy(); } catch (_) {}
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });

    const addr = this.server.address();
    this.port = addr.port;
    this.url = `http://127.0.0.1:${this.port}`;
    this.startedAt = new Date().toISOString();

    // Background: try to find a charger without blocking tunnel startup
    this._refreshDiscovery().catch(() => {});

    return { url: this.url, port: this.port, server: this.server };
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  getStatus() {
    return {
      kind: 'klvr-support-hub',
      version: '2.4.0',
      startedAt: this.startedAt,
      multiHomed: listExternalIPv4().length > 1,
      interfaces: listExternalIPv4().map((i) => ({
        name: i.name,
        address: i.address,
        cidr: i.cidr,
        preference: i.preference
      })),
      hintIps: this.hintIps,
      charger: this.active,
      readyForFirmware: !!(this.active && this.active.ip)
    };
  }

  async _refreshDiscovery() {
    const found = [];

    // Probe hint IPs first (customer may know static IP)
    for (const ip of this.hintIps) {
      const device = await this._probeIp(ip);
      if (device) found.push(device);
    }

    try {
      const scanned = await this.discovery.discoverDevices({ quiet: true });
      for (const d of scanned) {
        if (!found.some((f) => f.ip === d.ip)) found.push(d);
      }
    } catch (err) {
      this.logger.debug(`Hub discover: ${err.message}`);
    }

    if (!this.active && found.length === 1) {
      this._setActive(found[0]);
      this.logger.success(`Auto-selected charger ${found[0].deviceName} @ ${found[0].ip}`);
    } else if (this.active) {
      // Refresh still-active device info
      const still = found.find((f) => f.ip === this.active.ip);
      if (still) this._setActive(still);
    }

    return found;
  }

  _setActive(device) {
    this.active = {
      ip: device.ip,
      localAddress: device.localAddress || preferLocalAddress(device.ip) || null,
      deviceName: device.deviceName || 'Klvr',
      firmwareVersion: device.firmwareVersion || null
    };
  }

  async _probeIp(ip) {
    try {
      return await this.discovery.connectToTarget(ip);
    } catch (_) {
      return null;
    }
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, this._cors());
      res.end();
      return;
    }

    // Hub control plane
    if (path === '/' || path === '/status') {
      return this._textStatus(res);
    }
    if (path === '/api/status') {
      return this._json(res, 200, this.getStatus());
    }
    if (path === '/api/diagnostics' || path === '/json') {
      const q = url.searchParams.get('targets') || url.searchParams.get('ip');
      const targets = q
        ? q.split(',').map((s) => s.trim()).filter(Boolean)
        : (this.active ? [this.active.ip] : this.hintIps);
      const report = await this.doctor.run({ targets });
      return this._json(res, 200, report);
    }
    if (path === '/api/diagnostics.txt' || path === '/doctor') {
      const q = url.searchParams.get('targets') || url.searchParams.get('ip');
      const targets = q
        ? q.split(',').map((s) => s.trim()).filter(Boolean)
        : (this.active ? [this.active.ip] : this.hintIps);
      const report = await this.doctor.run({ targets });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...this._cors() });
      res.end(this.doctor.formatText(report));
      return;
    }
    if (path === '/api/discover' && req.method === 'GET') {
      const devices = await this._refreshDiscovery();
      return this._json(res, 200, {
        devices: devices.map((d) => ({
          ip: d.ip,
          deviceName: d.deviceName,
          firmwareVersion: d.firmwareVersion,
          localAddress: d.localAddress || null
        })),
        active: this.active
      });
    }
    if (path === '/api/target' && req.method === 'POST') {
      const body = await this._readBody(req);
      let ip;
      try {
        ip = JSON.parse(body).ip;
      } catch (_) {
        ip = String(body || '').trim();
      }
      if (!isIPv4(ip)) {
        return this._json(res, 400, { error: 'Provide { "ip": "x.x.x.x" }' });
      }
      const device = await this._probeIp(ip);
      if (!device) {
        this.hintIps = [...new Set([...this.hintIps, ip])];
        return this._json(res, 404, {
          error: `No Klvr charger reachable at ${ip}`,
          hint: 'Stored as hint for diagnostics; fix cable/subnet and POST again or GET /api/discover'
        });
      }
      this._setActive(device);
      return this._json(res, 200, { ok: true, charger: this.active });
    }

    // Charger API proxy — what supporters' firmware-update / device-info hit
    if (path.startsWith('/api/v2/')) {
      return this._proxyToCharger(req, res, path);
    }

    return this._json(res, 404, {
      error: 'Not found',
      endpoints: [
        'GET /api/status',
        'GET /api/diagnostics',
        'GET /api/discover',
        'POST /api/target',
        'GET|POST /api/v2/*  (proxied to active charger)',
        'WS /api/v2/ws  (proxied to active charger)'
      ]
    });
  }

  async _ensureActive() {
    if (!this.active) {
      await this._refreshDiscovery();
    }
    return this.active;
  }

  async _proxyWebSocket(req, clientSocket, head) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/v2/')) {
      clientSocket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    const active = await this._ensureActive();
    if (!active) {
      clientSocket.write(
        'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n'
        + JSON.stringify({ error: 'No charger selected yet' })
      );
      clientSocket.destroy();
      return;
    }

    const headers = { ...req.headers };
    headers.host = `${active.ip}:8000`;

    const options = {
      hostname: active.ip,
      port: 8000,
      path: req.url,
      method: 'GET',
      headers,
      timeout: 15000
    };
    if (active.localAddress) {
      options.localAddress = active.localAddress;
    }

    const proxyReq = http.request(options);
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode || 101} Switching Protocols`];
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) lines.push(`${key}: ${v}`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
      lines.push('', '');
      clientSocket.write(lines.join('\r\n'));
      if (proxyHead && proxyHead.length) clientSocket.write(proxyHead);
      if (head && head.length) proxySocket.write(head);

      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);

      const cleanup = () => {
        try { proxySocket.destroy(); } catch (_) {}
        try { clientSocket.destroy(); } catch (_) {}
      };
      proxySocket.on('error', cleanup);
      clientSocket.on('error', cleanup);
    });

    proxyReq.on('response', (res) => {
      clientSocket.write(
        `HTTP/1.1 ${res.statusCode} ${res.statusMessage || ''}\r\nConnection: close\r\n\r\n`
      );
      res.pipe(clientSocket);
    });

    proxyReq.on('error', (err) => {
      this.logger.debug(`WS upstream error: ${err.message}`);
      try {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      } catch (_) {}
      clientSocket.destroy();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      clientSocket.destroy();
    });

    proxyReq.end();
  }

  async _proxyToCharger(req, res, path) {
    const active = await this._ensureActive();
    if (!active) {
      res.writeHead(503, { 'Content-Type': 'application/json', ...this._cors() });
      res.end(JSON.stringify({
        error: 'No charger selected yet',
        kind: 'klvr-support-hub',
        hint: 'Customer cable/Wi‑Fi may be broken. GET /api/diagnostics and /api/discover first.',
        status: this.getStatus()
      }));
      return;
    }

    const body = await this._readBody(req);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    // Drop hop-by-hop / encoding headers; we buffer the body and must send a
    // real Content-Length. Charger OTA rejects requests without it (HTTP 400
    // "Invalid content length given") — Cloudflare/tunnel often arrives as
    // chunked, which previously left the upstream charger with no length.
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    delete headers['content-encoding'];
    headers['Content-Length'] = String(body.length);

    const options = {
      hostname: active.ip,
      port: 8000,
      path: path + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
      method: req.method,
      headers,
      // Firmware OTA over tunnel can exceed 2 minutes on slow links
      timeout: path.includes('/firmware_') ? 600000 : 120000
    };
    if (active.localAddress) {
      options.localAddress = active.localAddress;
    }

    await new Promise((resolve) => {
      const proxyReq = http.request(options, (proxyRes) => {
        const outHeaders = { ...proxyRes.headers, ...this._cors() };
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      });
      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Charger proxy timeout' }));
        }
        resolve();
      });
      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Charger unreachable via hub: ${err.message}`,
            charger: active
          }));
        }
        resolve();
      });
      if (body.length) proxyReq.write(body);
      proxyReq.end();
    });
  }

  _textStatus(res) {
    const s = this.getStatus();
    const lines = [
      'KLVR REMOTE SUPPORT HUB',
      `Started: ${s.startedAt}`,
      `Multi-homed: ${s.multiHomed ? 'YES' : 'no'}`,
      '',
      'Interfaces:'
    ];
    for (const i of s.interfaces) {
      lines.push(`  ${i.name}: ${i.address}/${i.cidr}`);
    }
    lines.push('');
    if (s.charger) {
      lines.push(`Charger: ${s.charger.deviceName} @ ${s.charger.ip}`);
      lines.push(`  via local ${s.charger.localAddress || 'default'}`);
      lines.push('Firmware/API proxy: READY');
    } else {
      lines.push('Charger: NOT FOUND YET');
      lines.push('Support can still pull diagnostics: GET /api/diagnostics');
      lines.push('Discovery: GET /api/discover');
    }
    lines.push('');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...this._cors() });
    res.end(lines.join('\n'));
  }

  _json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', ...this._cors(), 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj, null, 2));
  }

  _cors() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}

module.exports = SupportHub;
