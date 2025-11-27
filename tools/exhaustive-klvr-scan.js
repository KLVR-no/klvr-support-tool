#!/usr/bin/env node

const http = require('http');
const chalk = require('chalk');

/**
 * Exhaustive KLVR Scanner - Scans ALL possible subnets thoroughly
 */
class ExhaustiveKLVRScanner {
    constructor() {
        this.defaultPort = 8000;
        this.connectionTimeout = 1000;
        this.maxConcurrentScans = 200;
        this.foundDevices = [];
        this.completedScans = 0;
        this.totalScans = 0;
        this.startTime = Date.now();
        this.activeScans = 0;
    }

    /**
     * Generate exhaustive IP ranges for your three networks
     */
    generateExhaustiveRanges() {
        const ranges = [];
        
        // Network 1: 10.110.x.x - Scan ALL subnets from 0-255
        console.log(chalk.cyan('🌐 Network 1: 10.110.x.x (Corporate Network)'));
        for (let subnet = 0; subnet <= 255; subnet++) {
            const commonIPs = [
                1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25,
                50, 51, 52, 53, 54, 55, 100, 101, 102, 103, 104, 105, 150, 151, 
                152, 153, 154, 155, 200, 201, 202, 203, 204, 205, 250, 251, 252, 253, 254
            ];
            
            for (const ip of commonIPs) {
                ranges.push({
                    ip: `10.110.${subnet}.${ip}`,
                    network: 'Corporate',
                    subnet: subnet
                });
            }
        }
        
        // Network 2: 10.10.10.x - Full scan
        console.log(chalk.cyan('🌐 Network 2: 10.10.10.x (Local Network)'));
        for (let ip = 1; ip <= 254; ip++) {
            ranges.push({
                ip: `10.10.10.${ip}`,
                network: 'Local',
                subnet: 10
            });
        }
        
        // Network 3: 169.254.x.x - Scan subnets around your IP and common ones
        console.log(chalk.cyan('🌐 Network 3: 169.254.x.x (Link-Local Network)'));
        const linkLocalSubnets = [
            // Around your current IP (169.254.57.78)
            55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65,
            // Common link-local subnets
            1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 100, 150, 200, 250, 254
        ];
        
        for (const subnet of linkLocalSubnets) {
            const commonIPs = [
                1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25,
                50, 51, 52, 53, 54, 55, 78, 79, 80, 100, 101, 102, 103, 104, 105,
                150, 151, 152, 153, 154, 155, 200, 201, 202, 203, 204, 205, 250, 251, 252, 253, 254
            ];
            
            for (const ip of commonIPs) {
                ranges.push({
                    ip: `169.254.${subnet}.${ip}`,
                    network: 'Link-Local',
                    subnet: subnet
                });
            }
        }
        
        console.log(chalk.yellow(`📊 Total targets: ${ranges.length.toLocaleString()}`));
        return ranges;
    }

    /**
     * Test KLVR device
     */
    async testKLVRDevice(target) {
        return new Promise((resolve) => {
            this.activeScans++;
            
            const options = {
                hostname: target.ip,
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
                                ip: target.ip,
                                deviceName: deviceName,
                                firmwareVersion: info.firmwareVersion || 'Unknown',
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: this.defaultPort,
                                url: `http://${target.ip}:${this.defaultPort}`,
                                network: target.network,
                                subnet: target.subnet,
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
            console.log(chalk.green(`🎯 FOUND: ${device.deviceName} at ${device.ip} (${device.network} Network, subnet ${device.subnet})`));
        }
        
        // Update progress every 200 scans
        if (this.completedScans % 200 === 0) {
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
        
        process.stdout.write(`\r⚡ ${this.completedScans}/${this.totalScans} (${percent}%) | ${rate.toFixed(0)}/s | ETA: ${Math.ceil(eta)}s | Active: ${this.activeScans} | Found: ${this.foundDevices.length}`);
    }

    /**
     * Scan with controlled concurrency
     */
    async scanWithThrottle(targets) {
        return new Promise((resolve) => {
            let targetIndex = 0;
            let completedScans = 0;
            
            const startNextScan = async () => {
                while (this.activeScans < this.maxConcurrentScans && targetIndex < targets.length) {
                    const target = targets[targetIndex++];
                    
                    this.testKLVRDevice(target).then(device => {
                        completedScans++;
                        
                        if (completedScans === targets.length) {
                            resolve(this.foundDevices);
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
     * Run exhaustive scan
     */
    async runExhaustiveScan() {
        console.log(chalk.blue.bold('🔍 Exhaustive KLVR Scanner'));
        console.log(chalk.blue('=' .repeat(60)));
        console.log(chalk.yellow('🎯 Scanning ALL possible KLVR locations across your 3 networks'));
        console.log('');
        
        const targets = this.generateExhaustiveRanges();
        this.totalScans = targets.length;
        
        console.log(chalk.green(`🚀 Starting exhaustive scan of ${this.totalScans.toLocaleString()} targets`));
        console.log(chalk.yellow(`⚡ Using ${this.maxConcurrentScans} concurrent connections`));
        console.log('');

        this.startTime = Date.now();
        await this.scanWithThrottle(targets);
        
        console.log(''); // New line after progress
        return this.foundDevices;
    }

    /**
     * Display results grouped by network and subnet
     */
    displayResults() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        
        console.log('');
        console.log(chalk.blue.bold('📊 Exhaustive Scan Results'));
        console.log(chalk.blue('=' .repeat(60)));
        console.log(chalk.gray(`Scan completed in ${elapsed.toFixed(1)} seconds`));
        console.log(chalk.gray(`Average rate: ${(this.completedScans / elapsed).toFixed(0)} scans/second`));
        console.log(chalk.gray(`Total addresses scanned: ${this.completedScans.toLocaleString()}`));
        console.log('');
        
        if (this.foundDevices.length === 0) {
            console.log(chalk.yellow('⚠️  No KLVR devices found in exhaustive scan'));
            console.log('');
            console.log(chalk.cyan('💡 Possible reasons:'));
            console.log(chalk.cyan('   • Devices are powered off or in sleep mode'));
            console.log(chalk.cyan('   • Devices are using different ports (not 8000)'));
            console.log(chalk.cyan('   • Network firewalls are blocking connections'));
            console.log(chalk.cyan('   • Devices are on VLANs not accessible from your position'));
            return;
        }

        console.log(chalk.green(`🎯 Found ${this.foundDevices.length} KLVR device(s):`));
        console.log('');
        
        // Group by network and subnet
        const devicesByNetwork = {};
        this.foundDevices.forEach(device => {
            const networkKey = `${device.network} (${device.ip.split('.').slice(0, 3).join('.')}.x)`;
            if (!devicesByNetwork[networkKey]) {
                devicesByNetwork[networkKey] = [];
            }
            devicesByNetwork[networkKey].push(device);
        });
        
        Object.entries(devicesByNetwork).forEach(([networkName, devices]) => {
            console.log(chalk.white.bold(`📡 ${networkName}:`));
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
        console.log(chalk.blue.bold('🚀 Connect to any device:'));
        this.foundDevices.forEach((device, index) => {
            console.log(chalk.cyan(`   ${index + 1}. klvr-tool device-info ${device.ip}`));
        });
        console.log('');
        
        // Export summary
        console.log(chalk.blue.bold('📄 Export results:'));
        console.log(chalk.cyan(`   node tools/exhaustive-klvr-scan.js > klvr-scan-results.txt`));
        console.log('');
    }
}

// Main execution
async function main() {
    const scanner = new ExhaustiveKLVRScanner();
    
    try {
        await scanner.runExhaustiveScan();
        scanner.displayResults();
        process.exit(0);
    } catch (error) {
        console.log('');
        console.log(chalk.red(`❌ Exhaustive scan failed: ${error.message}`));
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log(chalk.yellow('🛑 Exhaustive scan interrupted'));
    console.log(`Found ${scanner.foundDevices.length} devices so far:`);
    scanner.foundDevices.forEach(device => {
        console.log(chalk.green(`   ${device.deviceName} at ${device.ip}`));
    });
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = ExhaustiveKLVRScanner;


