const bonjour = require('bonjour')();
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Device Discovery and Connection Manager
 * Handles finding KLVR devices on network and connecting to specific targets
 */
class DeviceDiscovery {
    constructor(logger) {
        this.logger = logger;
        this.discoveryTimeout = 10000; // 10 seconds
        this.connectionTimeout = 5000;  // 5 seconds
        this.bonjourService = 'klvrcharger';
        this.defaultPort = 8000;
    }

    /**
     * Discover KLVR devices on the network using Bonjour/mDNS
     */
    async discoverDevices() {
        this.logger.step('🔍 Discovering KLVR devices...');
        
        return new Promise((resolve) => {
            const devices = [];
            let foundDevices = 0;
            
            const timeout = setTimeout(() => {
                this.logger.debug('Discovery timeout reached');
                bonjour.destroy();
                resolve(devices);
            }, this.discoveryTimeout);
            
            const browser = bonjour.find({ type: this.bonjourService }, (service) => {
                // Prefer IPv4 address if available
                const ip = (service.addresses || []).find(addr => 
                    addr && addr.split('.').length === 4
                ) || service.host;
                
                const device = {
                    ip: ip,
                    deviceName: service.name,
                    port: service.port || this.defaultPort,
                    url: `http://${ip}:${service.port || this.defaultPort}`
                };
                
                devices.push(device);
                foundDevices++;
                this.logger.debug(`Found device ${foundDevices}: ${service.name} at ${ip}:${device.port}`);
            });
            
            // Wait for discovery to complete
            setTimeout(() => {
                clearTimeout(timeout);
                browser.stop();
                bonjour.destroy();
                
                if (devices.length > 0) {
                    this.logger.success(`Discovery complete: Found ${devices.length} device(s)`);
                } else {
                    this.logger.warn('No devices found via auto-discovery');
                }
                
                resolve(devices);
            }, 5000); // 5 second discovery window
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
     * Discover devices and let user select one interactively
     */
    async discoverAndSelect() {
        const devices = await this.discoverDevices();
        
        if (devices.length === 0) {
            throw new Error('No KLVR devices found. Please check device connectivity and network settings.');
        }
        
        if (devices.length === 1) {
            this.logger.info(`Using device: ${devices[0].deviceName} at ${devices[0].ip}`);
            return devices[0];
        }
        
        // Multiple devices - let user choose
        // For now, return first device, but this should be interactive
        this.logger.info(`Multiple devices found, using: ${devices[0].deviceName}`);
        return devices[0];
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
                            this.logger.warn(`Device at ${parsed.hostname} is not a KLVR device`);
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
