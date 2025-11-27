#!/usr/bin/env node

const os = require('os');
const http = require('http');
const chalk = require('chalk');

/**
 * Comprehensive KLVR Scanner - Scans ALL networks thoroughly
 */
class ComprehensiveKLVRScanner {
    constructor() {
        this.defaultPort = 8000;
        this.connectionTimeout = 800; // Very fast timeout
        this.maxConcurrentScans = 300; // High concurrency
        this.foundDevices = [];
        this.completedScans = 0;
        this.totalScans = 0;
        this.startTime = Date.now();
        this.activeScans = 0;
    }

    /**
     * Get ALL network interfaces without size restrictions
     */
    getAllNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const networks = [];

        console.log(chalk.blue('🌐 All Network Interfaces:'));
        
        for (const [name, addresses] of Object.entries(interfaces)) {
            for (const addr of addresses) {
                if (addr.internal || addr.family !== 'IPv4') continue;
                
                const subnet = this.calculateSubnet(addr.address, addr.netmask);
                networks.push({
                    interface: name,
                    address: addr.address,
                    netmask: addr.netmask,
                    subnet: subnet,
                    network: `${subnet.network}/${subnet.cidr}`
                });
                
                console.log(chalk.cyan(`   ${name}: ${addr.address}/${subnet.cidr} (${subnet.hostCount.toLocaleString()} hosts)`));
            }
        }
        
        console.log('');
        return networks;
    }

    /**
     * Calculate subnet information
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
     * Generate ALL IPs in a subnet with smart chunking for large networks
     */
    generateAllIPs(network, cidr, maxIPs = null) {
        const networkParts = network.split('.').map(Number);
        const hostBits = 32 - cidr;
        const hostCount = Math.pow(2, hostBits) - 2;
        
        // For very large networks, use smart sampling
        if (hostCount > 10000 && !maxIPs) {
            return this.generateSmartSample(networkParts, hostBits, 5000);
        }
        
        const limit = maxIPs || hostCount;
        const ips = [];
        
        for (let i = 1; i <= Math.min(limit, hostCount); i++) {
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
     * Generate smart sample for very large networks
     */
    generateSmartSample(networkParts, hostBits, sampleSize) {
        const ips = [];
        const base = networkParts.slice(0, 3).join('.');
        
        // If it's a /16 network, sample across multiple subnets
        if (hostBits === 16) {
            // Sample 20 subnets around the current one
            const currentSubnet = networkParts[2];
            const subnetsToScan = [];
            
            // Add current subnet and neighbors
            for (let i = Math.max(0, currentSubnet - 10); i <= Math.min(255, currentSubnet + 10); i++) {
                subnetsToScan.push(i);
            }
            
            // Add some common subnets
            const commonSubnets = [1, 2, 3, 10, 20, 50, 100, 150, 200, 250];
            subnetsToScan.push(...commonSubnets);
            
            // Remove duplicates and sort
            const uniqueSubnets = [...new Set(subnetsToScan)].sort((a, b) => a - b);
            
            for (const subnet of uniqueSubnets) {
                const subnetBase = `${networkParts[0]}.${networkParts[1]}.${subnet}`;
                
                // Common device IPs in each subnet
                const commonIPs = [
                    1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25,
                    50, 51, 52, 53, 54, 55, 100, 101, 102, 103, 104, 105, 150, 151, 
                    152, 153, 154, 155, 200, 201, 202, 203, 204, 205, 250, 251, 252, 253, 254
                ];
                
                for (const ip of commonIPs) {
                    ips.push(`${subnetBase}.${ip}`);
                }
            }
        } else {
            // For other large networks, use the existing smart sampling
            const ranges = [
                [1, 50], [50, 100], [100, 150], [150, 200], [200, 254]
            ];
            
            for (const [start, end] of ranges) {
                for (let i = start; i <= end; i += 2) { // Sample every 2nd IP
                    ips.push(`${base}.${i}`);
                }
            }
        }
        
        return ips.slice(0, sampleSize);
    }

    /**
     * Test KLVR device
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
     * Finish scan
     */
    finishScan(resolve, device) {
        this.activeScans--;
        this.completedScans++;
        
        if (device) {
            this.foundDevices.push(device);
            console.log(chalk.green(`🎯 FOUND: ${device.deviceName} at ${device.ip}`));
        }
        
        // Update progress every 100 scans
        if (this.completedScans % 100 === 0) {
            this.updateProgress();
        }
        
        resolve(device);
    }

    /**
     * Update progress
     */
    updateProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = this.completedScans / elapsed;
        const percent = ((this.completedScans / this.totalScans) * 100).toFixed(1);
        const eta = this.totalScans > this.completedScans ? (this.totalScans - this.completedScans) / rate : 0;
        
        process.stdout.write(`\r🔍 ${this.completedScans}/${this.totalScans} (${percent}%) | ${rate.toFixed(0)}/s | ETA: ${Math.ceil(eta)}s | Active: ${this.activeScans} | Found: ${this.foundDevices.length}`);
    }

    /**
     * Scan with throttling
     */
    async scanWithThrottle(ips) {
        return new Promise((resolve) => {
            let ipIndex = 0;
            const results = [];
            let completedScans = 0;
            
            const startNextScan = async () => {
                while (this.activeScans < this.maxConcurrentScans && ipIndex < ips.length) {
                    const ip = ips[ipIndex++];
                    
                    this.testKLVRDevice(ip).then(device => {
                        completedScans++;
                        if (device) results.push(device);
                        
                        if (completedScans === ips.length) {
                            resolve(results);
                        } else {
                            setImmediate(startNextScan);
                        }
                    });
                }
            };
            
            // Start initial batch
            startNextScan();
        });
    }

    /**
     * Comprehensive scan of all networks
     */
    async comprehensiveScan() {
        console.log(chalk.blue.bold('🔍 Comprehensive KLVR Scanner'));
        console.log(chalk.blue('=' .repeat(60)));
        
        const networks = this.getAllNetworkInterfaces();
        
        if (networks.length === 0) {
            console.log(chalk.red('❌ No network interfaces found'));
            return [];
        }

        console.log(chalk.yellow('📊 Comprehensive Scan Plan:'));
        let allIPs = [];
        
        for (const network of networks) {
            let ips;
            if (network.subnet.hostCount > 10000) {
                ips = this.generateSmartSample(network.subnet.network.split('.').map(Number), 32 - network.subnet.cidr, 5000);
                console.log(chalk.cyan(`   ${network.interface}: ${ips.length} smart-sampled addresses (${network.network})`));
            } else {
                ips = this.generateAllIPs(network.subnet.network, network.subnet.cidr);
                console.log(chalk.cyan(`   ${network.interface}: ${ips.length} addresses (${network.network}) - FULL SCAN`));
            }
            allIPs = allIPs.concat(ips);
        }
        
        this.totalScans = allIPs.length;
        console.log(chalk.green(`🚀 Total addresses to scan: ${this.totalScans.toLocaleString()}`));
        console.log(chalk.yellow(`⚡ Using ${this.maxConcurrentScans} concurrent connections`));
        console.log('');

        this.startTime = Date.now();
        await this.scanWithThrottle(allIPs);
        
        console.log(''); // New line after progress
        return this.foundDevices;
    }

    /**
     * Display comprehensive results
     */
    displayResults() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        
        console.log('');
        console.log(chalk.blue.bold('📊 Comprehensive Scan Results'));
        console.log(chalk.blue('=' .repeat(60)));
        console.log(chalk.gray(`Scan completed in ${elapsed.toFixed(1)} seconds`));
        console.log(chalk.gray(`Average rate: ${(this.completedScans / elapsed).toFixed(0)} scans/second`));
        console.log(chalk.gray(`Total addresses scanned: ${this.completedScans.toLocaleString()}`));
        console.log('');
        
        if (this.foundDevices.length === 0) {
            console.log(chalk.yellow('⚠️  No KLVR devices found in comprehensive scan'));
            console.log('');
            console.log(chalk.cyan('💡 This means:'));
            console.log(chalk.cyan('   • No KLVR devices are currently online'));
            console.log(chalk.cyan('   • Devices might be on different ports'));
            console.log(chalk.cyan('   • Devices might be in sleep mode'));
            console.log(chalk.cyan('   • Network segmentation might be blocking access'));
            return;
        }

        console.log(chalk.green(`🎯 Found ${this.foundDevices.length} KLVR device(s) across all networks:`));
        console.log('');
        
        // Group by network
        const devicesByNetwork = {};
        this.foundDevices.forEach(device => {
            const networkKey = device.ip.split('.').slice(0, 2).join('.');
            if (!devicesByNetwork[networkKey]) {
                devicesByNetwork[networkKey] = [];
            }
            devicesByNetwork[networkKey].push(device);
        });
        
        Object.entries(devicesByNetwork).forEach(([network, devices]) => {
            console.log(chalk.white.bold(`📡 Network ${network}.x.x:`));
            devices.forEach((device, index) => {
                console.log(chalk.white(`   ${index + 1}. ${device.deviceName}`));
                console.log(chalk.gray(`      🌐 ${device.ip}:${device.port}`));
                console.log(chalk.gray(`      📦 Firmware: ${device.firmwareVersion}`));
                console.log(chalk.gray(`      🔢 Serial: ${device.serialNumber}`));
                console.log(chalk.blue(`      🔗 ${device.url}`));
            });
            console.log('');
        });
        
        // Show connection commands
        console.log(chalk.blue.bold('🚀 Quick Connect Commands:'));
        this.foundDevices.forEach((device, index) => {
            console.log(chalk.cyan(`   ${index + 1}. klvr-tool device-info ${device.ip}`));
        });
        console.log('');
    }
}

// Main execution
async function main() {
    const scanner = new ComprehensiveKLVRScanner();
    
    try {
        await scanner.comprehensiveScan();
        scanner.displayResults();
        process.exit(0);
    } catch (error) {
        console.log('');
        console.log(chalk.red(`❌ Comprehensive scan failed: ${error.message}`));
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log(chalk.yellow('🛑 Comprehensive scan interrupted'));
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = ComprehensiveKLVRScanner;


