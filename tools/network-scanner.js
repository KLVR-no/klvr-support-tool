#!/usr/bin/env node

const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const chalk = require('chalk');

/**
 * Comprehensive KLVR Device Network Scanner
 * Scans all network interfaces for KLVR Charger devices
 */
class KLVRNetworkScanner {
    constructor() {
        this.defaultPort = 8000;
        this.connectionTimeout = 3000;
        this.maxConcurrentScans = 50;
        this.foundDevices = [];
        this.scanProgress = {
            total: 0,
            completed: 0,
            found: 0
        };
    }

    /**
     * Get all network interfaces and their subnets
     */
    getNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const networks = [];

        console.log(chalk.blue('📡 Detected Network Interfaces:'));
        
        for (const [name, addresses] of Object.entries(interfaces)) {
            for (const addr of addresses) {
                // Skip loopback, internal, and IPv6 addresses
                if (addr.internal || addr.family !== 'IPv4') continue;
                
                const subnet = this.calculateSubnet(addr.address, addr.netmask);
                networks.push({
                    interface: name,
                    address: addr.address,
                    netmask: addr.netmask,
                    subnet: subnet,
                    network: `${subnet.network}/${subnet.cidr}`
                });
                
                console.log(chalk.cyan(`   ${name}: ${addr.address}/${subnet.cidr} (${subnet.network} - ${subnet.broadcast})`));
            }
        }
        
        console.log('');
        return networks;
    }

    /**
     * Calculate subnet information from IP and netmask
     */
    calculateSubnet(ip, netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        
        // Calculate network address
        const networkParts = ipParts.map((part, i) => part & maskParts[i]);
        
        // Calculate broadcast address
        const broadcastParts = networkParts.map((part, i) => part | (255 - maskParts[i]));
        
        // Calculate CIDR
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
     * Generate all IP addresses in a subnet
     */
    generateIPRange(network, cidr) {
        const networkParts = network.split('.').map(Number);
        const hostBits = 32 - cidr;
        const hostCount = Math.pow(2, hostBits);
        const ips = [];
        
        // Skip network and broadcast addresses
        for (let i = 1; i < hostCount - 1; i++) {
            const ip = [...networkParts];
            let carry = i;
            
            // Apply the host bits from right to left
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
     * Test if an IP address has a KLVR device
     */
    async testKLVRDevice(ip) {
        return new Promise((resolve) => {
            const options = {
                hostname: ip,
                port: this.defaultPort,
                path: '/api/v2/device/info',
                method: 'GET',
                timeout: this.connectionTimeout
            };

            const req = http.request(options, (res) => {
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
                            resolve(device);
                        } else {
                            resolve(null);
                        }
                    } catch (error) {
                        resolve(null);
                    }
                });
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });

            req.setTimeout(this.connectionTimeout);
            req.end();
        });
    }

    /**
     * Scan a batch of IP addresses concurrently
     */
    async scanBatch(ips) {
        const promises = ips.map(async (ip) => {
            const device = await this.testKLVRDevice(ip);
            this.scanProgress.completed++;
            
            if (device) {
                this.foundDevices.push(device);
                this.scanProgress.found++;
                console.log(chalk.green(`✅ Found KLVR device: ${device.deviceName} at ${device.ip}`));
            }
            
            // Update progress every 10 scans
            if (this.scanProgress.completed % 10 === 0) {
                this.updateProgress();
            }
            
            return device;
        });

        return Promise.all(promises);
    }

    /**
     * Update and display scan progress
     */
    updateProgress() {
        const percent = ((this.scanProgress.completed / this.scanProgress.total) * 100).toFixed(1);
        process.stdout.write(`\r🔍 Scanning... ${this.scanProgress.completed}/${this.scanProgress.total} (${percent}%) - Found: ${this.scanProgress.found} devices`);
    }

    /**
     * Scan all network interfaces for KLVR devices
     */
    async scanAllNetworks() {
        console.log(chalk.blue.bold('🔍 KLVR Network Scanner'));
        console.log(chalk.blue('=' .repeat(50)));
        
        const networks = this.getNetworkInterfaces();
        
        if (networks.length === 0) {
            console.log(chalk.red('❌ No network interfaces found'));
            return [];
        }

        console.log(chalk.yellow('📊 Scan Summary:'));
        
        // Calculate total IPs to scan
        let allIPs = [];
        for (const network of networks) {
            const ips = this.generateIPRange(network.subnet.network, network.subnet.cidr);
            allIPs = allIPs.concat(ips);
            console.log(chalk.cyan(`   ${network.interface}: ${ips.length} addresses (${network.network})`));
        }
        
        this.scanProgress.total = allIPs.length;
        console.log(chalk.yellow(`   Total addresses to scan: ${this.scanProgress.total}`));
        console.log('');

        // Scan in batches to avoid overwhelming the network
        console.log(chalk.blue('🚀 Starting network scan...'));
        const batchSize = this.maxConcurrentScans;
        
        for (let i = 0; i < allIPs.length; i += batchSize) {
            const batch = allIPs.slice(i, i + batchSize);
            await this.scanBatch(batch);
        }
        
        console.log(''); // New line after progress updates
        
        return this.foundDevices;
    }

    /**
     * Display scan results
     */
    displayResults() {
        console.log('');
        console.log(chalk.blue.bold('📋 Scan Results'));
        console.log(chalk.blue('=' .repeat(50)));
        
        if (this.foundDevices.length === 0) {
            console.log(chalk.yellow('⚠️  No KLVR devices found on the network'));
            console.log('');
            console.log(chalk.cyan('💡 Troubleshooting tips:'));
            console.log(chalk.cyan('   • Ensure KLVR devices are powered on'));
            console.log(chalk.cyan('   • Check devices are connected to the same network'));
            console.log(chalk.cyan('   • Verify devices are not in sleep mode'));
            console.log(chalk.cyan('   • Try running with sudo/administrator privileges'));
            return;
        }

        console.log(chalk.green(`✅ Found ${this.foundDevices.length} KLVR device(s):`));
        console.log('');
        
        this.foundDevices.forEach((device, index) => {
            console.log(chalk.white.bold(`${index + 1}. ${device.deviceName}`));
            console.log(chalk.gray(`   IP Address: ${device.ip}:${device.port}`));
            console.log(chalk.gray(`   Firmware: ${device.firmwareVersion}`));
            console.log(chalk.gray(`   Serial: ${device.serialNumber}`));
            console.log(chalk.gray(`   URL: ${device.url}`));
            console.log('');
        });
    }

    /**
     * Export results to JSON file
     */
    async exportResults(filename = 'klvr-devices.json') {
        const fs = require('fs').promises;
        const exportData = {
            scanDate: new Date().toISOString(),
            devicesFound: this.foundDevices.length,
            totalAddressesScanned: this.scanProgress.total,
            devices: this.foundDevices
        };
        
        try {
            await fs.writeFile(filename, JSON.stringify(exportData, null, 2));
            console.log(chalk.green(`📄 Results exported to: ${filename}`));
        } catch (error) {
            console.log(chalk.red(`❌ Failed to export results: ${error.message}`));
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const exportFile = args.includes('--export') ? args[args.indexOf('--export') + 1] : null;
    const showHelp = args.includes('--help') || args.includes('-h');
    
    if (showHelp) {
        console.log(chalk.blue.bold('KLVR Network Scanner'));
        console.log('');
        console.log('Usage: node network-scanner.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --export <file>  Export results to JSON file');
        console.log('  --help, -h       Show this help message');
        console.log('');
        console.log('Examples:');
        console.log('  node network-scanner.js');
        console.log('  node network-scanner.js --export devices.json');
        return;
    }

    const scanner = new KLVRNetworkScanner();
    
    try {
        const devices = await scanner.scanAllNetworks();
        scanner.displayResults();
        
        if (exportFile) {
            await scanner.exportResults(exportFile);
        }
        
        process.exit(0);
    } catch (error) {
        console.log('');
        console.log(chalk.red(`❌ Scan failed: ${error.message}`));
        process.exit(1);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('');
    console.log(chalk.yellow('🛑 Scan interrupted by user'));
    process.exit(0);
});

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = KLVRNetworkScanner;



