#!/usr/bin/env node

const os = require('os');
const http = require('http');
const chalk = require('chalk');

/**
 * High-Speed KLVR Device Scanner
 * Optimized for speed with aggressive parallel scanning
 */
class FastKLVRScanner {
    constructor() {
        this.defaultPort = 8000;
        this.connectionTimeout = 1000; // Reduced to 1 second
        this.maxConcurrentScans = 200; // Increased from 50 to 200
        this.foundDevices = [];
        this.activeScans = 0;
        this.completedScans = 0;
        this.totalScans = 0;
        this.startTime = Date.now();
    }

    /**
     * Get network interfaces with smart filtering
     */
    getNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const networks = [];

        for (const [name, addresses] of Object.entries(interfaces)) {
            for (const addr of addresses) {
                if (addr.internal || addr.family !== 'IPv4') continue;
                
                const subnet = this.calculateSubnet(addr.address, addr.netmask);
                
                // Skip very large networks (>4096 hosts) for speed
                if (subnet.hostCount > 4096) {
                    console.log(chalk.yellow(`⚠️  Skipping large network ${name}: ${addr.address}/${subnet.cidr} (${subnet.hostCount} hosts - too large)`));
                    continue;
                }
                
                networks.push({
                    interface: name,
                    address: addr.address,
                    netmask: addr.netmask,
                    subnet: subnet,
                    network: `${subnet.network}/${subnet.cidr}`
                });
            }
        }
        
        return networks;
    }

    /**
     * Calculate subnet with optimization for common ranges
     */
    calculateSubnet(ip, netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        
        const networkParts = ipParts.map((part, i) => part & maskParts[i]);
        const broadcastParts = networkParts.map((part, i) => part | (255 - maskParts[i]));
        
        const cidr = maskParts.reduce((sum, part) => {
            return sum + part.toString(2).split('1').length - 1;
        }, 0);
        
        return {
            network: networkParts.join('.'),
            broadcast: broadcastParts.join('.'),
            cidr: cidr,
            hostCount: Math.pow(2, 32 - cidr) - 2
        };
    }

    /**
     * Generate smart IP ranges - prioritize common KLVR ranges
     */
    generateSmartIPRange(network, cidr) {
        const networkParts = network.split('.').map(Number);
        const hostBits = 32 - cidr;
        const hostCount = Math.pow(2, hostBits);
        
        // For /24 networks, scan in smart order
        if (cidr === 24) {
            return this.generatePriorityIPs(networkParts);
        }
        
        // For larger networks, limit to reasonable ranges
        const ips = [];
        const maxIPs = Math.min(hostCount - 2, 1000); // Limit to 1000 IPs max
        
        for (let i = 1; i <= maxIPs; i++) {
            const ip = [...networkParts];
            let carry = i;
            
            for (let j = 3; j >= 0 && carry > 0; j--) {
                const bitsInOctet = Math.min(8, hostBits - (3 - j) * 8);
                if (bitsInOctet > 0) {
                    const octetMask = (1 << bitsInOctet) - 1;
                    ip[j] = (ip[j] & ~octetMask) | (carry & octetMask);
                    carry = carry >> bitsInOctet;
                }
            }
            
            ips.push(ip.join('.'));
        }
        
        return ips;
    }

    /**
     * Generate IPs in priority order for /24 networks
     */
    generatePriorityIPs(networkParts) {
        const base = networkParts.slice(0, 3).join('.');
        const ips = [];
        
        // Common KLVR IP patterns (based on typical deployments)
        const priorityRanges = [
            [100, 200], // Common device range
            [50, 99],   // Mid range
            [10, 49],   // Low range
            [201, 254], // High range
            [1, 9]      // Very low range
        ];
        
        for (const [start, end] of priorityRanges) {
            for (let i = start; i <= end; i++) {
                ips.push(`${base}.${i}`);
            }
        }
        
        return ips;
    }

    /**
     * Ultra-fast KLVR device test
     */
    async testKLVRDevice(ip) {
        return new Promise((resolve) => {
            this.activeScans++;
            
            const options = {
                hostname: ip,
                port: this.defaultPort,
                path: '/api/v2/device/info',
                method: 'GET',
                timeout: this.connectionTimeout
            };

            const req = http.request(options, (res) => {
                if (res.statusCode !== 200) {
                    this.finishScan(resolve, null);
                    return;
                }
                
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        const deviceName = info.deviceName || info.name || '';
                        
                        if (deviceName.toLowerCase().includes('klvr')) {
                            const device = {
                                ip: ip,
                                deviceName: deviceName,
                                firmwareVersion: info.firmwareVersion || 'Unknown',
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: this.defaultPort,
                                url: `http://${ip}:${this.defaultPort}`,
                                lastSeen: new Date().toISOString()
                            };
                            this.finishScan(resolve, device);
                        } else {
                            this.finishScan(resolve, null);
                        }
                    } catch (error) {
                        this.finishScan(resolve, null);
                    }
                });
            });

            req.on('error', () => this.finishScan(resolve, null));
            req.on('timeout', () => {
                req.destroy();
                this.finishScan(resolve, null);
            });

            req.setTimeout(this.connectionTimeout);
            req.end();
        });
    }

    /**
     * Finish individual scan and update progress
     */
    finishScan(resolve, device) {
        this.activeScans--;
        this.completedScans++;
        
        if (device) {
            this.foundDevices.push(device);
            console.log(chalk.green(`🎯 FOUND: ${device.deviceName} at ${device.ip}`));
        }
        
        // Update progress every 50 scans
        if (this.completedScans % 50 === 0) {
            this.updateProgress();
        }
        
        resolve(device);
    }

    /**
     * Update progress display
     */
    updateProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = this.completedScans / elapsed;
        const percent = ((this.completedScans / this.totalScans) * 100).toFixed(1);
        const eta = this.totalScans > this.completedScans ? (this.totalScans - this.completedScans) / rate : 0;
        
        process.stdout.write(`\r⚡ ${this.completedScans}/${this.totalScans} (${percent}%) | ${rate.toFixed(1)}/s | ETA: ${eta.toFixed(0)}s | Active: ${this.activeScans} | Found: ${this.foundDevices.length}`);
    }

    /**
     * High-speed concurrent scanning
     */
    async scanWithThrottle(ips) {
        return new Promise((resolve) => {
            let ipIndex = 0;
            const results = [];
            
            const startNextScan = async () => {
                if (ipIndex >= ips.length) {
                    // Check if all scans are complete
                    if (this.activeScans === 0) {
                        resolve(results);
                    }
                    return;
                }
                
                const ip = ips[ipIndex++];
                const device = await this.testKLVRDevice(ip);
                if (device) results.push(device);
                
                // Start next scan
                setImmediate(startNextScan);
            };
            
            // Start initial batch of scans
            for (let i = 0; i < this.maxConcurrentScans && i < ips.length; i++) {
                startNextScan();
            }
        });
    }

    /**
     * Fast scan all networks
     */
    async fastScanAllNetworks() {
        console.log(chalk.blue.bold('⚡ FAST KLVR Scanner'));
        console.log(chalk.blue('=' .repeat(40)));
        
        const networks = this.getNetworkInterfaces();
        
        if (networks.length === 0) {
            console.log(chalk.red('❌ No suitable networks found'));
            return [];
        }

        console.log(chalk.cyan('🌐 Networks to scan:'));
        let allIPs = [];
        
        for (const network of networks) {
            const ips = this.generateSmartIPRange(network.subnet.network, network.subnet.cidr);
            allIPs = allIPs.concat(ips);
            console.log(chalk.yellow(`   ${network.interface}: ${ips.length} addresses (${network.network})`));
        }
        
        this.totalScans = allIPs.length;
        console.log(chalk.green(`🚀 Scanning ${this.totalScans} addresses with ${this.maxConcurrentScans} concurrent connections...`));
        console.log('');

        this.startTime = Date.now();
        await this.scanWithThrottle(allIPs);
        
        console.log(''); // New line after progress
        return this.foundDevices;
    }

    /**
     * Display results
     */
    displayResults() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        
        console.log('');
        console.log(chalk.blue.bold('📊 Fast Scan Results'));
        console.log(chalk.blue('=' .repeat(40)));
        console.log(chalk.gray(`Scan completed in ${elapsed.toFixed(1)} seconds`));
        console.log(chalk.gray(`Average rate: ${(this.completedScans / elapsed).toFixed(1)} scans/second`));
        console.log('');
        
        if (this.foundDevices.length === 0) {
            console.log(chalk.yellow('⚠️  No KLVR devices found'));
            console.log('');
            console.log(chalk.cyan('💡 Try:'));
            console.log(chalk.cyan('   • Check devices are powered on'));
            console.log(chalk.cyan('   • Verify network connectivity'));
            console.log(chalk.cyan('   • Run: node tools/network-scanner.js (full scan)'));
            return;
        }

        console.log(chalk.green(`🎯 Found ${this.foundDevices.length} KLVR device(s):`));
        console.log('');
        
        this.foundDevices.forEach((device, index) => {
            console.log(chalk.white.bold(`${index + 1}. ${device.deviceName}`));
            console.log(chalk.gray(`   🌐 ${device.ip}:${device.port}`));
            console.log(chalk.gray(`   📦 Firmware: ${device.firmwareVersion}`));
            console.log(chalk.gray(`   🔢 Serial: ${device.serialNumber}`));
            console.log(chalk.blue(`   🔗 ${device.url}`));
            console.log('');
        });
    }
}

// CLI Interface
async function main() {
    const scanner = new FastKLVRScanner();
    
    try {
        await scanner.fastScanAllNetworks();
        scanner.displayResults();
        process.exit(0);
    } catch (error) {
        console.log('');
        console.log(chalk.red(`❌ Fast scan failed: ${error.message}`));
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log(chalk.yellow('🛑 Fast scan interrupted'));
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = FastKLVRScanner;



