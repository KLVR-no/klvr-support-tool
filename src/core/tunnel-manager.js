const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const {
  getTempDir,
  getPlatformKey,
  execCommand,
  commandExists
} = require('./platform');

/**
 * Tunnel Manager — Cloudflare quick tunnels for remote support.
 * Cross-platform cloudflared install (macOS / Linux / Windows).
 */
class TunnelManager {
  constructor(logger) {
    this.logger = logger;
    this.activeTunnels = new Map();
    this.sessionDir = path.join(os.homedir(), '.klvr-support');
    this.sessionFile = path.join(this.sessionDir, 'tunnel-sessions.json');
    this.cloudflaredConfig = {
      downloadUrls: {
        'darwin-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
        'darwin-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz',
        'linux-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
        'linux-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
        'win32-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
      }
    };
    this._cloudflaredBin = null;
  }

  async createTunnel(device, options = {}) {
    const provider = options.tunnelProvider || 'cloudflare';
    if (provider !== 'cloudflare') {
      throw new Error(`Unsupported tunnel provider: ${provider}`);
    }

    const existingSession = await this._getExistingSession(device);
    if (existingSession && options.reuseSession !== false) {
      this.logger.info('Found previous tunnel session');
      this.logger.info(`  Previous URL: ${existingSession.url}`);
      this.logger.info('Creating new tunnel (quick tunnels mint a new URL each time)');
      await this._removeSession(device);
    }

    if (options.persistent || options.customDomain) {
      this.logger.warn('Named/persistent Cloudflare tunnels are not configured.');
      this.logger.info('Falling back to a quick tunnel for this support session.');
    }

    const tunnel = await this._createCloudflaredTunnel(device, options);
    if (tunnel) {
      await this._saveSession(device, tunnel);
    }
    return tunnel;
  }

  async closeTunnel(tunnel) {
    try {
      if (tunnel.process && !tunnel.process.killed) {
        tunnel.process.kill();
        this.logger.info('Tunnel process terminated');
      }
      if (this.activeTunnels.has(tunnel.id)) {
        this.activeTunnels.delete(tunnel.id);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Error closing tunnel: ${error.message}`);
      return false;
    }
  }

  async _getExistingSession(device) {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      const sessions = JSON.parse(await fs.readFile(this.sessionFile, 'utf8'));
      const session = sessions[this._getDeviceKey(device)];
      if (session && this._isSessionValid(session)) {
        return session;
      }
    } catch (_) {
      // ok
    }
    return null;
  }

  async _saveSession(device, tunnel) {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      let sessions = {};
      try {
        sessions = JSON.parse(await fs.readFile(this.sessionFile, 'utf8'));
      } catch (_) {
        // empty
      }
      sessions[this._getDeviceKey(device)] = {
        url: tunnel.url,
        deviceName: device.deviceName || device.name,
        deviceIP: device.ip,
        created: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        tunnelId: tunnel.id
      };
      await fs.writeFile(this.sessionFile, JSON.stringify(sessions, null, 2));
    } catch (error) {
      this.logger.warn(`Failed to save session: ${error.message}`);
    }
  }

  async _removeSession(device) {
    try {
      const sessions = JSON.parse(await fs.readFile(this.sessionFile, 'utf8'));
      delete sessions[this._getDeviceKey(device)];
      await fs.writeFile(this.sessionFile, JSON.stringify(sessions, null, 2));
    } catch (_) {
      // ok
    }
  }

  _getDeviceKey(device) {
    return device.ip || device.deviceName || device.name || 'unknown';
  }

  _isSessionValid(session) {
    const maxAge = 24 * 60 * 60 * 1000;
    return (Date.now() - new Date(session.created).getTime()) < maxAge;
  }

  async _createCloudflaredTunnel(device, options = {}) {
    const bin = await this._resolveCloudflared();
    const targetUrl = device.url || `http://${device.ip}:8000`;
    this.logger.step(`Creating tunnel to ${targetUrl}...`);

    return new Promise((resolve, reject) => {
      const tunnelProcess = spawn(bin, [
        'tunnel',
        '--url', targetUrl,
        '--no-autoupdate'
      ], { windowsHide: true });

      let tunnelUrl = null;
      let startupComplete = false;
      const tunnelId = `tunnel-${Date.now()}`;

      const tryParse = (output) => {
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !tunnelUrl) {
          tunnelUrl = urlMatch[0];
          startupComplete = true;
          const tunnel = {
            id: tunnelId,
            url: tunnelUrl,
            process: tunnelProcess,
            device,
            provider: 'cloudflare'
          };
          this.activeTunnels.set(tunnelId, tunnel);
          resolve(tunnel);
        }
      };

      tunnelProcess.stdout.on('data', (data) => {
        const output = data.toString();
        this.logger.debug(`[TUNNEL] ${output.trim()}`);
        tryParse(output);
      });
      tunnelProcess.stderr.on('data', (data) => {
        const output = data.toString();
        this.logger.debug(`[TUNNEL] ${output.trim()}`);
        tryParse(output);
      });
      tunnelProcess.on('close', (code) => {
        if (!startupComplete) {
          reject(new Error(`Tunnel process exited with code ${code}`));
        }
      });
      tunnelProcess.on('error', (error) => {
        if (!startupComplete) {
          reject(new Error(`Failed to start tunnel: ${error.message}`));
        }
      });

      setTimeout(() => {
        if (!startupComplete) {
          try { tunnelProcess.kill(); } catch (_) {}
          reject(new Error('Timeout waiting for tunnel to start'));
        }
      }, 45000);
    });
  }

  async _resolveCloudflared() {
    if (this._cloudflaredBin && await commandExists(this._cloudflaredBin)) {
      return this._cloudflaredBin;
    }
    if (await commandExists('cloudflared')) {
      this._cloudflaredBin = 'cloudflared';
      return this._cloudflaredBin;
    }
    // User-local install from a previous run
    const localBin = process.platform === 'win32'
      ? path.join(this.sessionDir, 'bin', 'cloudflared.exe')
      : path.join(this.sessionDir, 'bin', 'cloudflared');
    try {
      await fs.access(localBin);
      this._cloudflaredBin = localBin;
      return localBin;
    } catch (_) {
      // need install
    }

    this.logger.step('cloudflared not found — installing locally...');
    const installed = await this._installCloudflared();
    this._cloudflaredBin = installed;
    return installed;
  }

  async _installCloudflared() {
    const platform = getPlatformKey();
    const downloadUrl = this.cloudflaredConfig.downloadUrls[platform];
    if (!downloadUrl) {
      throw new Error(`No cloudflared binary available for ${platform}`);
    }

    const binDir = path.join(this.sessionDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const tempDir = getTempDir(`cloudflared-install-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      if (platform.startsWith('darwin')) {
        const tgz = path.join(tempDir, 'cloudflared.tgz');
        await this._downloadFile(downloadUrl, tgz);
        await execCommand('tar', ['-xzf', tgz, '-C', tempDir]);
        const dest = path.join(binDir, 'cloudflared');
        await fs.copyFile(path.join(tempDir, 'cloudflared'), dest);
        await fs.chmod(dest, 0o755);
        this.logger.success(`cloudflared installed to ${dest}`);
        return dest;
      }

      if (platform.startsWith('linux')) {
        const dest = path.join(binDir, 'cloudflared');
        await this._downloadFile(downloadUrl, dest);
        await fs.chmod(dest, 0o755);
        this.logger.success(`cloudflared installed to ${dest}`);
        return dest;
      }

      if (platform === 'win32-x64') {
        const dest = path.join(binDir, 'cloudflared.exe');
        await this._downloadFile(downloadUrl, dest);
        this.logger.success(`cloudflared installed to ${dest}`);
        return dest;
      }

      throw new Error(`Unsupported platform: ${platform}`);
    } catch (error) {
      this.logger.error(`Failed to install cloudflared: ${error.message}`);
      this.logger.info('Install manually:');
      this.logger.info('  macOS:  brew install cloudflared');
      this.logger.info('  Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
      throw error;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (_) {
        // ignore
      }
    }
  }

  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(destPath);
      const get = (targetUrl, redirectsLeft = 5) => {
        const mod = targetUrl.startsWith('https') ? https : http;
        const req = mod.get(targetUrl, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (redirectsLeft <= 0) {
              reject(new Error('Too many redirects downloading cloudflared'));
              return;
            }
            res.resume();
            get(res.headers.location, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(destPath)));
        });
        req.on('error', reject);
      };
      get(url);
    });
  }

  getActiveTunnels() {
    return Array.from(this.activeTunnels.values());
  }

  async closeAllTunnels() {
    const tunnels = this.getActiveTunnels();
    await Promise.all(tunnels.map((t) => this.closeTunnel(t)));
    this.logger.info(`Closed ${tunnels.length} tunnel(s)`);
  }
}

module.exports = TunnelManager;
