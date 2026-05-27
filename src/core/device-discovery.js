const http = require('http');
const https = require('https');
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
        this.bonjourService = 'klvrcharger';
        this.defaultPort = 8000;
    }

    /**
     * Discover Klvr devices on the network using Bonjour/mDNS
     */
    async discoverDevices() {
        this.logger.step('🔍 Searching for Klvr devices on your network...');

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
                if (devices.length > 0) {
                    this.logger.success(`Found ${devices.length} device(s)`);
                }
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
                    this.logger.debug(`Found: ${service.name} at ${ip}`);
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
     * Discover devices and let user select one interactively.
     * Falls back to manual IP entry if nothing is found.
     */
    async discoverAndSelect() {
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
        console.log('    • Connected to the same Wi-Fi / network as this computer');
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
