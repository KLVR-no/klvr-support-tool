const http = require('http');
const https = require('https');
const { URL } = require('url');
const inquirer = require('inquirer');
const {
    listExternalIPv4,
    preferLocalAddress,
    localAddressesToTry,
    describeMultiHome,
    isIPv4,
    ipToInt,
    intToIp,
    netmaskToCidr
} = require('./network');

/**
 * Device Discovery and Connection Manager
 * Handles finding Klvr devices on network and connecting to specific targets.
 * Multi-homed hosts (Wi‑Fi + USB LAN): binds HTTP to the matching adapter.
 */
class DeviceDiscovery {
    constructor(logger) {
        this.logger = logger;
        this.discoveryTimeout = 5000;
        this.connectionTimeout = 5000;
        this.scanTimeout = 2000;
        this.bonjourService = 'klvrcharger';
        this.defaultPort = 8000;
    }

    /**
     * Discover Klvr devices on the network.
     *
     * Runs mDNS (Bonjour) and a direct HTTP scan of every local network
     * interface in parallel. Subnet probes bind to that interface's address
     * so Wi‑Fi being up does not steal direct-cable traffic.
     */
    async discoverDevices() {
        this.logger.step('🔍 Searching for Klvr devices on your network...');
        describeMultiHome(this.logger);

        const [mdnsDevices, scanDevices] = await Promise.all([
            this._discoverViaMdns(),
            this._scanNetworkInterfaces()
        ]);

        if (mdnsDevices.length === 0 && process.platform === 'win32') {
            this.logger.info('mDNS/Bonjour found nothing — common on Windows without Bonjour Print Services.');
            this.logger.info('Falling back to subnet HTTP scan (and you can always enter an IP manually).');
        } else if (mdnsDevices.length === 0) {
            this.logger.debug('mDNS found nothing; relying on subnet scan / manual IP.');
        }

        // Attach localAddress to mDNS hits; prefer scan results (already bound).
        for (const d of mdnsDevices) {
            if (!d.localAddress && isIPv4(d.ip)) {
                d.localAddress = preferLocalAddress(d.ip) || undefined;
            }
        }

        const byIp = new Map();
        for (const d of [...mdnsDevices, ...scanDevices]) {
            const prev = byIp.get(d.ip);
            if (!prev || (d.localAddress && !prev.localAddress)) {
                byIp.set(d.ip, d);
            }
        }
        const devices = Array.from(byIp.values());

        if (devices.length > 0) {
            this.logger.success(`Found ${devices.length} device(s)`);
            for (const d of devices) {
                if (d.localAddress) {
                    this.logger.info(`  ${d.deviceName} @ ${d.ip} via local ${d.localAddress}`);
                }
            }
        } else {
            this.logger.warn('No devices discovered. Enter the charger IP manually, or check the network.');
        }
        return devices;
    }

    /**
     * Discover devices via mDNS/Bonjour (_klvrcharger._tcp).
     * Works on the OS default multicast interface only.
     */
    async _discoverViaMdns() {
        let bonjour;
        try {
            bonjour = require('bonjour')();
        } catch (e) {
            this.logger.debug('Bonjour not available, skipping mDNS discovery');
            return [];
        }

        return new Promise((resolve) => {
            const devices = [];
            let settled = false;

            const finish = () => {
                if (settled) return;
                settled = true;
                try { bonjour.destroy(); } catch (_) {}
                resolve(devices);
            };

            try {
                bonjour.find({ type: this.bonjourService }, (service) => {
                    const ip = (service.addresses || []).find(addr =>
                        addr && addr.split('.').length === 4
                    ) || service.host;

                    devices.push({
                        ip,
                        deviceName: service.name,
                        port: service.port || this.defaultPort,
                        url: `http://${ip}:${service.port || this.defaultPort}`
                    });
                    this.logger.debug(`mDNS found: ${service.name} at ${ip}`);
                });
            } catch (e) {
                this.logger.debug(`mDNS browse error: ${e.message}`);
                finish();
                return;
            }

            setTimeout(finish, this.discoveryTimeout);
        });
    }

    /**
     * Scan every local IPv4 interface for Klvr devices. Each probe binds to
     * that interface so dual Wi‑Fi + USB setups reach the cable side.
     * Subnets wider than /24 are capped to the containing /24.
     */
    async _scanNetworkInterfaces() {
        const interfaces = listExternalIPv4();
        const probes = [];

        for (const iface of interfaces) {
            const cidr = iface.cidr || netmaskToCidr(iface.netmask);
            const networkInt = ipToInt(iface.address) & ipToInt(iface.netmask);
            let scanNetwork = intToIp(networkInt);
            let effectiveCidr = cidr;
            if (cidr < 24) {
                effectiveCidr = 24;
                const mask = (0xFFFFFFFF << (32 - 24)) >>> 0;
                scanNetwork = intToIp(ipToInt(iface.address) & mask);
            }

            const ips = this._generateSubnetIps(scanNetwork, effectiveCidr, iface.address);
            this.logger.debug(
                `Scanning ${iface.name} (${iface.address}/${cidr} → ${scanNetwork}/${effectiveCidr}): ${ips.length} hosts, bind ${iface.address}`
            );
            for (const ip of ips) {
                probes.push({ ip, localAddress: iface.address });
            }
        }

        if (probes.length === 0) return [];

        // Deduplicate identical bind+target pairs
        const seen = new Set();
        const unique = [];
        for (const p of probes) {
            const key = `${p.localAddress}->${p.ip}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(p);
        }

        const results = await Promise.all(
            unique.map((p) => this._testConnectionFast(p.ip, p.localAddress))
        );
        return results.filter(Boolean);
    }

    _generateSubnetIps(network, cidr, skipIp) {
        const hostBits = 32 - cidr;
        const base = ipToInt(network);
        const count = Math.pow(2, hostBits) - 2;
        const ips = [];
        for (let i = 1; i <= count; i++) {
            const ip = intToIp(base + i);
            if (ip !== skipIp) ips.push(ip);
        }
        return ips;
    }

    /**
     * Fast HTTP probe used by the subnet scanner.
     * @param {string} ip
     * @param {string} [localAddress] bind to this NIC
     */
    async _testConnectionFast(ip, localAddress) {
        return new Promise((resolve) => {
            const options = {
                hostname: ip,
                port: this.defaultPort,
                path: '/api/v2/device/info',
                method: 'GET',
                timeout: this.scanTimeout
            };
            if (localAddress) options.localAddress = localAddress;

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        const deviceName = info.deviceName || info.name;
                        if (deviceName && deviceName.toLowerCase().includes('klvr')) {
                            this.logger.debug(
                                `Subnet scan found: ${deviceName} at ${ip}`
                                + (localAddress ? ` via ${localAddress}` : '')
                            );
                            resolve({
                                ip,
                                deviceName,
                                firmwareVersion: info.firmwareVersion,
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: this.defaultPort,
                                url: `http://${ip}:${this.defaultPort}`,
                                localAddress: localAddress || undefined
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (_) {
                        resolve(null);
                    }
                });
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.end();
        });
    }

    /**
     * Connect to a specific target (IP address or URL).
     * For LAN IPs, tries each local NIC bind so Wi‑Fi does not steal the route.
     */
    async connectToTarget(target) {
        this.logger.step(`🔗 Connecting to target: ${target}`);
        describeMultiHome(this.logger);

        const parsed = this._parseTarget(target);

        if (parsed.isUrl || !isIPv4(parsed.hostname)) {
            // Support hub tunnel (diagnostics even when charger is offline)
            const hubDevice = await this._trySupportHub(parsed);
            if (hubDevice) {
                if (hubDevice.hubReady) {
                    this.logger.success(
                        `Connected via support hub → ${hubDevice.deviceName} (${hubDevice.ip})`
                    );
                } else {
                    this.logger.warn(
                        'Support hub is up, but no charger found yet — diagnostics available.'
                    );
                }
                return hubDevice;
            }

            const device = await this._testConnection(parsed);
            if (!device) throw new Error(`Failed to connect to ${target}`);
            this.logger.success(`Connected to ${device.deviceName}`);
            return device;
        }

        const candidates = localAddressesToTry(parsed.hostname);
        let lastError = null;
        for (const localAddress of candidates) {
            const label = localAddress || 'default-route';
            this.logger.debug(`Trying ${parsed.hostname} via ${label}...`);
            const device = await this._testConnection({ ...parsed, localAddress });
            if (device) {
                if (localAddress) {
                    this.logger.info(`Using local adapter ${localAddress} → ${parsed.hostname}`);
                }
                this.logger.success(`Connected to ${device.deviceName}`);
                return device;
            }
            lastError = label;
        }

        throw new Error(
            `Failed to connect to ${target}`
            + (lastError ? ` (tried binds including ${lastError})` : '')
            + '. If Wi‑Fi and USB LAN are both on, keep trying — or temporarily disable Wi‑Fi.'
        );
    }

    /**
     * Ask the user how they want to connect, then find the device.
     *
     * @param {{ mode?: 'local'|'support' }} [options]
     *   local   — customer paths (firmware update, open remote-support): LAN IP / scan only
     *   support — Klvr supporter: paste customer tunnel URL (or IP)
     */
    async discoverAndSelect(options = {}) {
        const mode = options.mode === 'support' ? 'support' : 'local';

        if (mode === 'support') {
            return this._promptTunnelUrl();
        }

        describeMultiHome(this.logger);

        const { method } = await inquirer.prompt([
            {
                type: 'list',
                name: 'method',
                message: 'How is your Klvr Charger Pro connected?',
                choices: [
                    { name: 'Search for it automatically on the network', value: 'discover' },
                    { name: 'I know the IP address  (e.g. direct cable / static IP)', value: 'manual' }
                ]
            }
        ]);

        if (method === 'manual') {
            return this._promptManualIp({ mode: 'local' });
        }

        const devices = await this.discoverDevices();

        if (devices.length === 0) {
            this.logger.warn('No devices found automatically.');
            return this._promptManualIp({ mode: 'local' });
        }

        if (devices.length === 1) {
            this.logger.info(`Found: ${devices[0].deviceName} (${devices[0].ip})`);
            return devices[0];
        }

        const { chosen } = await inquirer.prompt([
            {
                type: 'list',
                name: 'chosen',
                message: `Found ${devices.length} devices — which one?`,
                choices: devices.map(d => ({
                    name: `${d.deviceName}  (${d.ip})`,
                    value: d
                }))
            }
        ]);
        return chosen;
    }

    async _promptTunnelUrl() {
        const { url } = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Paste the customer tunnel URL:',
                validate: (v) => {
                    if (!v || !/^https:\/\/.+/i.test(v.trim())) {
                        return 'Enter a full https:// URL from the customer remote-support session';
                    }
                    return true;
                }
            }
        ]);
        return this.connectToTarget(url.trim());
    }

    /**
     * Prompt the user to enter an IP address manually (local / customer path).
     */
    async _promptManualIp(options = {}) {
        const mode = options.mode === 'support' ? 'support' : 'local';

        console.log('');
        console.log('  Make sure the Klvr Charger Pro is:');
        console.log('    • Powered on');
        console.log('    • Connected to this computer (Wi-Fi, direct cable, or LAN)');
        console.log('');

        const { choice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'What would you like to do?',
                choices: [
                    { name: 'Enter the device IP address manually', value: 'manual' },
                    { name: 'Try searching again', value: 'retry' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }
        ]);

        if (choice === 'cancel') {
            throw new Error('Cancelled by user');
        }

        if (choice === 'retry') {
            return this.discoverAndSelect({ mode });
        }

        const { ip } = await inquirer.prompt([
            {
                type: 'input',
                name: 'ip',
                message: 'Enter device IP address (e.g. 192.168.1.50):',
                validate: (val) => {
                    const trimmed = val.trim();
                    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return true;
                    return 'Enter an IP like 192.168.1.50';
                },
                filter: (val) => val.trim()
            }
        ]);

        this.logger.step(`Connecting to ${ip}...`);
        try {
            const device = await this.connectToTarget(ip);
            this.logger.success(`Connected to ${device.deviceName} (${device.ip || device.url})`);
            return device;
        } catch (_) {
            console.log('');
            this.logger.warn(`Could not reach a Klvr device at ${ip}.`);
            console.log('  Double-check the IP and that the charger is on this network.');
            console.log('');
            return this._promptManualIp({ mode });
        }
    }

    /**
     * Get detailed information about a device
     */
    async getDetailedInfo(device) {
        try {
            const response = await this._makeRequest(device, '/api/v2/device/info');
            const info = JSON.parse(response);
            
            return {
                'Device Name': info.deviceName || info.name || 'Unknown',
                'IP Address': device.ip,
                'Firmware Version': info.firmwareVersion || 'Unknown',
                'Serial Number': info.serialNumber || info.ip?.macAddress || 'Unknown',
                'Status': 'Connected',
                'Connection': device.url,
                'Local adapter': device.localAddress || 'default-route'
            };
        } catch (error) {
            throw new Error(`Failed to get device info: ${error.message}`);
        }
    }

    /**
     * Detect klvr-support-hub behind a tunnel URL.
     * Works even when no charger is selected yet.
     */
    async _trySupportHub(parsed) {
        if (!parsed.isUrl) return null;
        const base = String(parsed.baseUrl || parsed.url).replace(/\/$/, '');
        try {
            const raw = await this._httpGetRaw(`${base}/api/status`, 12000);
            const status = JSON.parse(raw);
            if (!status || status.kind !== 'klvr-support-hub') return null;

            // Refresh discovery on customer side
            try {
                await this._httpGetRaw(`${base}/api/discover`, 20000);
            } catch (_) {
                // ok
            }

            let refreshed = status;
            try {
                refreshed = JSON.parse(await this._httpGetRaw(`${base}/api/status`, 8000));
            } catch (_) {
                // keep first status
            }

            const charger = refreshed.charger;
            if (charger && charger.ip) {
                return {
                    ip: charger.ip,
                    deviceName: charger.deviceName || 'Klvr',
                    firmwareVersion: charger.firmwareVersion || 'Unknown',
                    serialNumber: 'via-hub',
                    port: parsed.port,
                    url: base,
                    isSupportHub: true,
                    hubReady: true,
                    localAddress: undefined // binding happens on customer hub
                };
            }

            return {
                ip: 'hub',
                deviceName: 'Klvr Support Hub (no charger yet)',
                firmwareVersion: 'n/a',
                serialNumber: 'via-hub',
                port: parsed.port,
                url: base,
                isSupportHub: true,
                hubReady: false,
                hubStatus: refreshed
            };
        } catch (_) {
            return null;
        }
    }

    _httpGetRaw(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const parsed = this._parseTarget(url);
            const httpModule = parsed.protocol === 'https:' ? https : http;
            const req = httpModule.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: new URL(url).pathname + new URL(url).search,
                method: 'GET',
                timeout: timeoutMs
            }, (res) => {
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
            req.end();
        });
    }

    /**
     * Parse target string into connection options
     */
    _parseTarget(target) {
        // Handle full URLs like https://abc123.trycloudflare.com
        if (target.startsWith('http://') || target.startsWith('https://')) {
            const url = new URL(target);
            return {
                isUrl: true,
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                baseUrl: target,
                url: target
            };
        }
        
        // Handle IP addresses like 10.110.73.155
        return {
            isUrl: false,
            protocol: 'http:',
            hostname: target,
            port: this.defaultPort,
            baseUrl: `http://${target}:${this.defaultPort}`,
            url: `http://${target}:${this.defaultPort}`,
            ip: target
        };
    }

    /**
     * Test connection to a parsed target
     */
    async _testConnection(parsed) {
        return new Promise((resolve) => {
            const options = {
                hostname: parsed.hostname,
                port: parsed.port,
                path: '/api/v2/device/info',
                method: 'GET',
                timeout: this.connectionTimeout
            };
            if (parsed.localAddress) {
                options.localAddress = parsed.localAddress;
            }

            const httpModule = parsed.protocol === 'https:' ? https : http;

            const req = httpModule.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        const deviceName = info.deviceName || info.name;

                        if (deviceName && deviceName.toLowerCase().includes('klvr')) {
                            resolve({
                                ip: parsed.hostname,
                                deviceName: deviceName,
                                firmwareVersion: info.firmwareVersion,
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: parsed.port,
                                url: parsed.baseUrl,
                                localAddress: parsed.localAddress || preferLocalAddress(parsed.hostname) || undefined
                            });
                        } else {
                            this.logger.warn(`Device at ${parsed.hostname} is not a Klvr device`);
                            resolve(null);
                        }
                    } catch (error) {
                        this.logger.debug(`Failed to parse response from ${parsed.hostname}: ${error.message}`);
                        resolve(null);
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.debug(
                    `Connection failed to ${parsed.hostname}`
                    + (parsed.localAddress ? ` via ${parsed.localAddress}` : '')
                    + `: ${error.message}`
                );
                resolve(null);
            });

            req.on('timeout', () => {
                this.logger.debug(`Connection timeout to ${parsed.hostname}`);
                req.destroy();
                resolve(null);
            });

            req.end();
        });
    }

    /**
     * Make HTTP request to device
     */
    async _makeRequest(device, path, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = this._parseTarget(device.url || `http://${device.ip}:${device.port}`);

            const requestOptions = {
                hostname: parsed.hostname,
                port: parsed.port,
                path: path,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: this.connectionTimeout
            };
            const localAddress = device.localAddress
                || (!parsed.isUrl && isIPv4(parsed.hostname) ? preferLocalAddress(parsed.hostname) : null);
            if (localAddress) {
                requestOptions.localAddress = localAddress;
            }

            const httpModule = parsed.protocol === 'https:' ? https : http;
            const req = httpModule.request(requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        });
    }
}

module.exports = DeviceDiscovery;
