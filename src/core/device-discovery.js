const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const inquirer = require('inquirer');

/**
 * Device Discovery and Connection Manager
 * Handles finding Klvr devices on network and connecting to specific targets
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
     * interface in parallel. This ensures the charger is found even when the
     * computer is connected to it via a dedicated NIC on a different subnet
     * (e.g. static IP cable) while also being connected to Wi-Fi.
     *
     * Results from both probes are merged and deduplicated by IP address.
     */
    async discoverDevices() {
        this.logger.step('🔍 Searching for Klvr devices on your network...');

        const [mdnsDevices, scanDevices] = await Promise.all([
            this._discoverViaMdns(),
            this._scanNetworkInterfaces()
        ]);

        // Merge results, deduplicate by IP (mDNS wins for richer service info)
        const byIp = new Map();
        for (const d of [...scanDevices, ...mdnsDevices]) {
            byIp.set(d.ip, d);
        }
        const devices = Array.from(byIp.values());

        if (devices.length > 0) {
            this.logger.success(`Found ${devices.length} device(s)`);
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
     * Scan every local IPv4 network interface for Klvr devices by probing
     * each host on the subnet directly over HTTP. Subnets larger than /24
     * are capped to /24 to keep scan time bounded (~2 s worst case).
     *
     * All probes fire concurrently so the total time equals scanTimeout
     * regardless of how many hosts are in the subnet.
     */
    async _scanNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const allIps = [];

        for (const [name, addrs] of Object.entries(interfaces)) {
            for (const addr of addrs) {
                if (addr.internal || addr.family !== 'IPv4') continue;

                const { network, cidr } = this._calculateSubnet(addr.address, addr.netmask);
                // Cap scan at /24 to avoid scanning thousands of addresses on
                // corporate or wide subnets (/16, /8, etc.)
                const effectiveCidr = Math.max(cidr, 24);
                const ips = this._generateSubnetIps(network, effectiveCidr, addr.address);
                this.logger.debug(`Scanning ${name} (${addr.address}/${cidr}, effective /${effectiveCidr}): ${ips.length} addresses`);
                allIps.push(...ips);
            }
        }

        if (allIps.length === 0) return [];

        // Deduplicate across overlapping subnets, then probe all at once
        const uniqueIps = [...new Set(allIps)];
        const results = await Promise.all(uniqueIps.map(ip => this._testConnectionFast(ip)));
        return results.filter(Boolean);
    }

    _calculateSubnet(ip, netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        const networkParts = ipParts.map((part, i) => part & maskParts[i]);
        const cidr = maskParts.reduce((acc, p) => acc + p.toString(2).split('1').length - 1, 0);
        return { network: networkParts.join('.'), cidr };
    }

    _generateSubnetIps(network, cidr, skipIp) {
        const hostBits = 32 - cidr;
        const base = this._ipToInt(network);
        const count = Math.pow(2, hostBits) - 2; // exclude network + broadcast
        const ips = [];
        for (let i = 1; i <= count; i++) {
            const ip = this._intToIp(base + i);
            if (ip !== skipIp) ips.push(ip);
        }
        return ips;
    }

    _ipToInt(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    _intToIp(n) {
        return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
    }

    /**
     * Fast HTTP probe used by the subnet scanner. Uses a shorter timeout than
     * the interactive connection flow.
     */
    async _testConnectionFast(ip) {
        return new Promise((resolve) => {
            const req = http.request({
                hostname: ip,
                port: this.defaultPort,
                path: '/api/v2/device/info',
                method: 'GET',
                timeout: this.scanTimeout
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        const deviceName = info.deviceName || info.name;
                        if (deviceName && deviceName.toLowerCase().includes('klvr')) {
                            this.logger.debug(`Subnet scan found: ${deviceName} at ${ip}`);
                            resolve({
                                ip,
                                deviceName,
                                firmwareVersion: info.firmwareVersion,
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: this.defaultPort,
                                url: `http://${ip}:${this.defaultPort}`
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
     * Connect to a specific target (IP address or URL)
     */
    async connectToTarget(target) {
        this.logger.step(`🔗 Connecting to target: ${target}`);
        
        const parsed = this._parseTarget(target);
        const device = await this._testConnection(parsed);
        
        if (!device) {
            throw new Error(`Failed to connect to ${target}`);
        }
        
        this.logger.success(`Connected to ${device.deviceName}`);
        return device;
    }

    /**
     * Ask the user how they want to connect, then find the device.
     * Users on a cabled static-IP setup can skip mDNS discovery entirely.
     */
    async discoverAndSelect() {
        const { method } = await inquirer.prompt([
            {
                type: 'list',
                name: 'method',
                message: 'How is your Klvr Charger Pro connected?',
                choices: [
                    { name: 'I know the IP address  (e.g. direct cable / static IP)', value: 'manual' },
                    { name: 'Search for it automatically on the network',               value: 'discover' }
                ]
            }
        ]);

        if (method === 'manual') {
            return this._promptManualIp();
        }

        // Auto-discover
        const devices = await this.discoverDevices();

        if (devices.length === 0) {
            this.logger.warn('No devices found automatically.');
            return this._promptManualIp();
        }

        if (devices.length === 1) {
            this.logger.info(`Found: ${devices[0].deviceName} (${devices[0].ip})`);
            return devices[0];
        }

        // Multiple devices — let user pick
        const { chosen } = await inquirer.prompt([
            {
                type: 'list',
                name: 'chosen',
                message: `Found ${devices.length} devices — which one do you want to update?`,
                choices: devices.map(d => ({
                    name: `${d.deviceName}  (${d.ip})`,
                    value: d
                }))
            }
        ]);
        return chosen;
    }

    /**
     * Prompt the user to enter an IP address manually
     */
    async _promptManualIp() {
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
            return this.discoverAndSelect();
        }

        const { ip } = await inquirer.prompt([
            {
                type: 'input',
                name: 'ip',
                message: 'Enter the device IP address (e.g. 192.168.1.50):',
                validate: (val) => {
                    const trimmed = val.trim();
                    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return true;
                    return 'Please enter a valid IP address like 192.168.1.50';
                },
                filter: (val) => val.trim()
            }
        ]);

        this.logger.step(`Connecting to ${ip}...`);
        const device = await this._testConnection(this._parseTarget(ip));

        if (!device) {
            console.log('');
            this.logger.warn(`Could not reach a Klvr device at ${ip}.`);
            console.log('  Double-check the IP and that the device is on the same network.');
            console.log('');
            return this._promptManualIp();
        }

        this.logger.success(`Connected to ${device.deviceName} (${device.ip})`);
        return device;
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
                'Connection': device.url
            };
        } catch (error) {
            throw new Error(`Failed to get device info: ${error.message}`);
        }
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
                                url: parsed.baseUrl
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
                this.logger.debug(`Connection failed to ${parsed.hostname}: ${error.message}`);
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
