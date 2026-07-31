const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');
const { normalizeVersion, versionsMatch } = require('./platform');

/**
 * Firmware Manager — LAN and remote (tunnel) updates.
 *
 * Safe order (matches device flash policy):
 *   upload main → upload rear → reboot main → reboot rear → poll versions
 * Both boards reboot so RS485 baud renegotiation restarts cleanly.
 */
class FirmwareManager {
  constructor(logger) {
    this.logger = logger;
    this.config = {
      defaultPort: 8000,
      firmwareProcessingWait: 7000,
      sendRebootWait: 1500,
      versionPollIntervalMs: 2000,
      versionPollTimeoutMs: 60000,
      requestTimeoutMs: 120000,
      uploadTimeoutMs: 300000,
      maxRetries: 3,
      endpoints: {
        firmwareCharger: '/api/v2/device/firmware_charger',
        firmwareRear: '/api/v2/device/firmware_rear',
        reboot: '/api/v2/device/reboot',
        info: '/api/v2/device/info',
        firmwareVersion: '/api/v2/device/firmware_version'
      }
    };
  }

  async updateDevice(device, options = {}) {
    try {
      this.logger.step('Starting firmware update process...');
      const firmwareFiles = await this.findAndSelectFirmwareFiles(options);

      if (options.rearOnly) {
        return await this.executeRearOnlyFirmwareUpdate(device, firmwareFiles, options);
      }
      return await this.executeFirmwareUpdate(device, firmwareFiles, options);
    } catch (error) {
      this.logger.error(`Firmware update failed: ${error.message}`);
      throw error;
    }
  }

  async findAndSelectFirmwareFiles(options = {}) {
    const firmwareDir = options.firmwareDir || path.join(__dirname, '../../firmware');

    if (options.rearOnly && options.rear) {
      return { rear: path.resolve(options.rear) };
    }
    if (options.main && options.rear) {
      return {
        main: path.resolve(options.main),
        rear: path.resolve(options.rear)
      };
    }

    const files = await fs.readdir(firmwareDir);
    const mainFiles = files.filter((f) => f.startsWith('main_') && f.endsWith('.signed.bin'));
    const rearFiles = files.filter((f) => f.startsWith('rear_') && f.endsWith('.signed.bin'));

    const sortFiles = async (fileList) => {
      const withStats = await Promise.all(
        fileList.map(async (file) => {
          const filePath = path.join(firmwareDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime };
        })
      );
      return withStats.sort((a, b) => b.mtime - a.mtime);
    };

    const sortedMain = await sortFiles(mainFiles);
    const sortedRear = await sortFiles(rearFiles);

    if (options.version) {
      const want = options.version.startsWith('v') ? options.version : `v${options.version}`;
      const main = sortedMain.find((f) => this._extractFirmwareVersion(f.file) === want
        || versionsMatch(this._extractFirmwareVersion(f.file), options.version));
      const rear = sortedRear.find((f) => this._extractFirmwareVersion(f.file) === want
        || versionsMatch(this._extractFirmwareVersion(f.file), options.version));
      if (!rear || (!options.rearOnly && !main)) {
        throw new Error(`Firmware version not found: ${options.version}`);
      }
      if (options.rearOnly) {
        return { rear: path.join(firmwareDir, rear.file) };
      }
      return {
        main: path.join(firmwareDir, main.file),
        rear: path.join(firmwareDir, rear.file)
      };
    }

    if (options.rearOnly) {
      if (sortedRear.length === 0) {
        throw new Error('No rear firmware files found in firmware directory');
      }
      return { rear: path.join(firmwareDir, sortedRear[0].file) };
    }

    if (sortedMain.length === 0 || sortedRear.length === 0) {
      throw new Error('Missing firmware files in firmware directory');
    }

    const pairs = this._findMatchedFirmwarePairs(sortedMain, sortedRear);
    if (pairs.length === 0) {
      throw new Error('No matching firmware pairs found. Main and rear versions must match.');
    }
    const latest = pairs[0];
    return {
      main: path.join(firmwareDir, latest.main.file),
      rear: path.join(firmwareDir, latest.rear.file)
    };
  }

  async listAvailableVersions(rearOnly = false) {
    const firmwareDir = path.join(__dirname, '../../firmware');
    const files = await fs.readdir(firmwareDir);
    const mainFiles = files.filter((f) => f.startsWith('main_') && f.endsWith('.signed.bin'));
    const rearFiles = files.filter((f) => f.startsWith('rear_') && f.endsWith('.signed.bin'));

    const sortFiles = async (fileList) => {
      const withStats = await Promise.all(
        fileList.map(async (file) => {
          const filePath = path.join(firmwareDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime };
        })
      );
      return withStats.sort((a, b) => b.mtime - a.mtime);
    };

    const sortedMain = await sortFiles(mainFiles);
    const sortedRear = await sortFiles(rearFiles);

    if (rearOnly) {
      return sortedRear.map((rearFile) => ({
        version: this._extractFirmwareVersion(rearFile.file) || 'Unknown',
        rearPath: path.join(firmwareDir, rearFile.file),
        mtime: rearFile.mtime
      }));
    }

    return this._findMatchedFirmwarePairs(sortedMain, sortedRear).map((pair) => ({
      version: pair.version,
      mainPath: path.join(firmwareDir, pair.main.file),
      rearPath: path.join(firmwareDir, pair.rear.file),
      mtime: pair.mtime
    }));
  }

  async preflight(device) {
    this.logger.step('Preflight: checking device reachability...');
    const started = Date.now();
    const info = await this._getDeviceInfo(device);
    const versions = await this._getFirmwareVersions(device);
    const latencyMs = Date.now() - started;
    const isRemote = !!(device.url && String(device.url).startsWith('https://'));

    this.logger.info(`Device: ${info.name || 'unknown'} @ ${device.ip || device.url}`);
    this.logger.info(`Firmware: rear=${versions.firmwareRear}  main=${versions.firmwareMain}`);
    this.logger.info(`Latency: ${latencyMs}ms${isRemote ? ' (tunnel)' : ''}`);

    if (isRemote && latencyMs > 5000) {
      this.logger.warn('High tunnel latency — large uploads may be slow; keep customer session open.');
    }

    return { info, versions, latencyMs, isRemote };
  }

  async executeFirmwareUpdate(device, firmwareFiles, options = {}) {
    const targetVersion = this._extractFirmwareVersion(path.basename(firmwareFiles.main));
    const pre = await this.preflight(device);
    const oldVersion = pre.versions.firmwareMain || pre.info.firmwareVersion;

    this.logger.info(`Current: ${oldVersion}`);
    this.logger.info(`Target:  ${targetVersion}`);

    if (!options.force
        && versionsMatch(pre.versions.firmwareMain, targetVersion)
        && versionsMatch(pre.versions.firmwareRear, targetVersion)) {
      this.logger.success('Device already on target version — skipping (pass --force to reflash).');
      return {
        success: true,
        skipped: true,
        oldVersion,
        newVersion: normalizeVersion(targetVersion),
        targetVersion
      };
    }

    this.logger.step('Reading firmware files...');
    const mainFirmware = await fs.readFile(firmwareFiles.main);
    const rearFirmware = await fs.readFile(firmwareFiles.rear);
    this.logger.info(`Main: ${(mainFirmware.length / 1024).toFixed(1)} KB`);
    this.logger.info(`Rear: ${(rearFirmware.length / 1024).toFixed(1)} KB`);

    this.logger.step('Upload main board firmware...');
    await this._uploadFirmware(device, mainFirmware, true);
    this.logger.success('Main upload OK');
    await this._wait(this.config.firmwareProcessingWait);

    this.logger.step('Upload rear board firmware...');
    await this._uploadFirmware(device, rearFirmware, false);
    this.logger.success('Rear upload OK');
    await this._wait(this.config.firmwareProcessingWait);

    // Reboot both boards close together (baud renegotiation)
    this.logger.step('Reboot main board...');
    await this._rebootDevice(device, 'main');
    this.logger.success('Main reboot requested');
    await this._wait(this.config.sendRebootWait);

    this.logger.step('Reboot rear board...');
    await this._rebootDevice(device, 'rear');
    this.logger.success('Rear reboot requested');

    this.logger.step('Waiting for both boards to come online on target version...');
    const confirmed = await this._pollUntilVersion(device, targetVersion);
    if (!confirmed) {
      throw new Error(
        `Upload and reboot completed, but device did not report ${normalizeVersion(targetVersion)} `
        + `within ${this.config.versionPollTimeoutMs / 1000}s. Check the tunnel/session and retry device-info.`
      );
    }

    this.logger.success('FIRMWARE UPDATE CONFIRMED');
    this.logger.info(`Version: ${oldVersion} → ${normalizeVersion(targetVersion)}`);
    return {
      success: true,
      oldVersion,
      newVersion: normalizeVersion(targetVersion),
      targetVersion,
      confirmed: true
    };
  }

  async executeRearOnlyFirmwareUpdate(device, firmwareFiles, options = {}) {
    const targetVersion = this._extractFirmwareVersion(path.basename(firmwareFiles.rear));
    const pre = await this.preflight(device);
    const oldVersion = pre.versions.firmwareRear || pre.info.firmwareVersion;

    if (!options.force && versionsMatch(pre.versions.firmwareRear, targetVersion)) {
      this.logger.success('Rear already on target version — skipping (pass --force to reflash).');
      return {
        success: true,
        skipped: true,
        oldVersion,
        newVersion: normalizeVersion(targetVersion),
        targetVersion,
        updateType: 'rear-only'
      };
    }

    const rearFirmware = await fs.readFile(firmwareFiles.rear);
    this.logger.step('Upload rear board firmware...');
    await this._uploadFirmware(device, rearFirmware, false);
    this.logger.success('Rear upload OK');
    await this._wait(this.config.firmwareProcessingWait);

    this.logger.step('Reboot rear board...');
    await this._rebootDevice(device, 'rear');
    this.logger.success('Rear reboot requested');

    const confirmed = await this._pollUntilVersion(device, targetVersion, { rearOnly: true });
    if (!confirmed) {
      throw new Error(
        `Rear update completed, but device did not report ${normalizeVersion(targetVersion)} in time.`
      );
    }

    this.logger.success('REAR FIRMWARE UPDATE CONFIRMED');
    return {
      success: true,
      oldVersion,
      newVersion: normalizeVersion(targetVersion),
      targetVersion,
      updateType: 'rear-only',
      confirmed: true
    };
  }

  _extractFirmwareVersion(filename) {
    // main_v1.8.92-beta.signed.bin → v1.8.92-beta
    const match = filename.match(/_(v\d+\.\d+\.\d+(?:beta|alpha|rc)?(?:-[^.]+)?)\.signed\.bin$/);
    return match ? match[1] : null;
  }

  _findMatchedFirmwarePairs(mainFiles, rearFiles) {
    const pairs = [];
    for (const mainFile of mainFiles) {
      const version = this._extractFirmwareVersion(mainFile.file);
      if (!version) continue;
      const matchingRear = rearFiles.find((rearFile) => {
        return this._extractFirmwareVersion(rearFile.file) === version;
      });
      if (matchingRear) {
        pairs.push({
          version,
          main: mainFile,
          rear: matchingRear,
          mtime: mainFile.mtime > matchingRear.mtime ? mainFile.mtime : matchingRear.mtime
        });
      }
    }
    return pairs.sort((a, b) => b.mtime - a.mtime);
  }

  async _getDeviceInfo(device) {
    const response = await this._makeRequest(device, this.config.endpoints.info, 'GET', {
      timeout: 15000
    });
    if (!response.ok) {
      throw new Error(`GET info failed: HTTP ${response.status}`);
    }
    return JSON.parse(response.data);
  }

  async _getFirmwareVersions(device) {
    const response = await this._makeRequest(device, this.config.endpoints.firmwareVersion, 'GET', {
      timeout: 15000
    });
    if (!response.ok) {
      throw new Error(`GET firmware_version failed: HTTP ${response.status}`);
    }
    const data = JSON.parse(response.data);
    return {
      firmwareRear: data.firmwareRear || data.firmware_version || data.version,
      firmwareMain: data.firmwareMain || data.firmware_version || data.version
    };
  }

  async _uploadFirmware(device, firmware, isMainBoard) {
    const endpoint = isMainBoard
      ? this.config.endpoints.firmwareCharger
      : this.config.endpoints.firmwareRear;
    const boardType = isMainBoard ? 'main' : 'rear';

    const response = await this._makeRequest(device, endpoint, 'POST', {
      body: firmware,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': firmware.length
      },
      timeout: this.config.uploadTimeoutMs,
      retries: this.config.maxRetries
    });

    if (!response.ok) {
      throw new Error(`${boardType} firmware upload failed: HTTP ${response.status}`);
    }
    return response;
  }

  async _rebootDevice(device, board) {
    const endpoint = `${this.config.endpoints.reboot}?board=${board}`;
    const response = await this._makeRequest(device, endpoint, 'POST', {
      body: board,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(board)
      },
      timeout: 30000,
      retries: 2
    });
    if (!response.ok) {
      throw new Error(`${board} reboot failed: HTTP ${response.status}`);
    }
    return response;
  }

  async _pollUntilVersion(device, targetVersion, { rearOnly = false } = {}) {
    const deadline = Date.now() + this.config.versionPollTimeoutMs;
    let attempt = 0;

    // Give the rear a moment to drop/rebind before first poll
    await this._wait(5000);

    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const versions = await this._getFirmwareVersions(device);
        this.logger.info(
          `  poll #${attempt}: rear=${versions.firmwareRear}  main=${versions.firmwareMain}`
        );
        const rearOk = versionsMatch(versions.firmwareRear, targetVersion);
        const mainOk = versionsMatch(versions.firmwareMain, targetVersion);
        if (rearOnly ? rearOk : (rearOk && mainOk)) {
          return true;
        }
      } catch (err) {
        this.logger.info(`  poll #${attempt}: waiting (${err.message})`);
      }
      await this._wait(this.config.versionPollIntervalMs);
    }
    return false;
  }

  async _makeRequest(device, reqPath, method = 'GET', options = {}) {
    const timeout = options.timeout || this.config.requestTimeoutMs;
    const retries = options.retries || 0;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this._makeRequestOnce(device, reqPath, method, options, timeout);
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          const backoff = 1000 * (attempt + 1);
          this.logger.warn(`Request retry ${attempt + 1}/${retries} after: ${err.message}`);
          await this._wait(backoff);
        }
      }
    }
    throw lastError;
  }

  _makeRequestOnce(device, reqPath, method, options, timeout) {
    return new Promise((resolve, reject) => {
      const parsed = this._parseTarget(device.url || `http://${device.ip}:${device.port || this.config.defaultPort}`);
      const headers = { ...(options.headers || {}) };

      const requestOptions = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: reqPath,
        method,
        headers,
        timeout
      };

      // Keep firmware uploads on the same NIC that discovered the charger
      // (critical when Wi‑Fi + USB LAN are both up).
      const localAddress = device.localAddress || options.localAddress;
      if (localAddress) {
        requestOptions.localAddress = localAddress;
      } else if (parsed.protocol === 'http:' && /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
        try {
          const { preferLocalAddress } = require('./network');
          const preferred = preferLocalAddress(parsed.hostname);
          if (preferred) requestOptions.localAddress = preferred;
        } catch (_) {
          // optional
        }
      }

      const httpModule = parsed.protocol === 'https:' ? https : http;
      const req = httpModule.request(requestOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            data
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeout}ms (${method} ${reqPath})`));
      });
      req.on('error', reject);

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  _parseTarget(target) {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      const url = new URL(target);
      return {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80)
      };
    }
    return {
      protocol: 'http:',
      hostname: target,
      port: this.config.defaultPort
    };
  }

  async _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = FirmwareManager;
