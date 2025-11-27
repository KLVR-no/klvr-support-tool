#!/usr/bin/env node

const http = require('http');
const chalk = require('chalk');

/**
 * Targeted KLVR Scanner - Scans specific IP ranges likely to have KLVR devices
 */
class TargetedKLVRScanner {
    constructor() {
        this.defaultPort = 8000;
        this.connectionTimeout = 1500;
        this.maxConcurrentScans = 100;
        this.foundDevices = [];
        this.completedScans = 0;
        this.totalScans = 0;
        this.startTime = Date.now();
    }

    /**
     * Generate targeted IP ranges based on your networks
     */
    generateTargetedRanges() {
        const ranges = [];
        
        // Your three networks with smart targeting
        const networks = [
            {
                name: "Corporate Network",
                base: "10.110",
                subnets: [
                    "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", // Around your IP
                    "100", "101", "102", "103", "104", "105", // Common device ranges
                    "150", "151", "152", "153", "154", "155", // Mid ranges
                    "200", "201", "202", "203", "204", "205"  // High ranges
                ]
            },
            {
                name: "Local Network", 
                base: "10.10.10",
                subnets: [""] // Already scanned, but include for completeness
            },
            {
                name: "Link-Local Network",
                base: "169.254",
                subnets: [
                    "57", "58", "59", "60", "61", // Around your IP
                    "1", "2", "3", "4", "5",      // Low ranges
                    "100", "101", "102", "103",   // Common ranges
                    "200", "201", "202", "203"    // High ranges
                ]
            }
        ];

        for (const network of networks) {
            for (const subnet of network.subnets) {
                const baseIP = subnet ? `${network.base}.${subnet}` : network.base;
                
                // Common device IP endings
                const commonEndings = [
                    1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25,
                    50, 51, 52, 53, 54, 55, 100, 101, 102, 103, 104, 105,
                    150, 151, 152, 153, 154, 155, 200, 201, 202, 203, 204, 205,
                    250, 251, 252, 253, 254
                ];
                
                for (const ending of commonEndings) {
                    ranges.push({
                        ip: `${baseIP}.${ending}`,
                        network: network.name,
                        priority: this.calculatePriority(baseIP, ending)
                    });
                }
            }
        }
        
        // Sort by priority (higher priority first)
        return ranges.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Calculate priority for IP (higher = scan first)
     */
    calculatePriority(baseIP, ending) {
        let priority = 0;
        
        // Prioritize ranges around your current IPs
        if (baseIP.includes("10.110.65") || baseIP.includes("10.10.10") || baseIP.includes("169.254.57")) {
            priority += 100;
        }
        
        // Prioritize common device ranges
        if (ending >= 100 && ending <= 200) priority += 50;
        if (ending >= 50 && ending <= 99) priority += 40;
        if (ending >= 10 && ending <= 49) priority += 30;
        if (ending >= 200 && ending <= 254) priority += 20;
        
        // Prioritize specific common KLVR IPs
        const commonKLVREndings = [155, 100, 101, 102, 150, 151, 200, 201];
        if (commonKLVREndings.includes(ending)) priority += 75;
        
        return priority;
    }

    /**
     * Test KLVR device with enhanced detection
     */
    async testKLVRDevice(targetInfo) {
        return new Promise((resolve) => {
            const options = {
                hostname: targetInfo.ip,
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
                                ip: targetInfo.ip,
                                deviceName: deviceName,
                                firmwareVersion: info.firmwareVersion || 'Unknown',
                                serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                                port: this.defaultPort,
                                url: `http://${targetInfo.ip}:${this.defaultPort}`,
                                network: targetInfo.network,
                                priority: targetInfo.priority,
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
     * Finish scan and update progress
     */
    finishScan(resolve, device) {
        this.completedScans++;
        
        if (device) {
            this.foundDevices.push(device);
            console.log(chalk.green(`🎯 FOUND: ${device.deviceName} at ${device.ip} (${device.network})`));
        }
        
        // Update progress every 25 scans
        if (this.completedScans % 25 === 0) {
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
        
        process.stdout.write(`\r🎯 ${this.completedScans}/${this.totalScans} (${percent}%) | ${rate.toFixed(1)}/s | ETA: ${eta.toFixed(0)}s | Found: ${this.foundDevices.length}`);
    }

    /**
     * Scan with controlled concurrency
     */
    async scanTargets(targets) {
        return new Promise((resolve) => {
            let targetIndex = 0;
            let activeScans = 0;
            const results = [];
            
            const startNextScan = async () => {
                if (targetIndex >= targets.length && activeScans === 0) {
                    resolve(results);
                    return;
                }
                
                if (targetIndex >= targets.length || activeScans >= this.maxConcurrentScans) {
                    return;
                }
                
                const target = targets[targetIndex++];
                activeScans++;
                
                const device = await this.testKLVRDevice(target);
                activeScans--;
                
                if (device) results.push(device);
                
                // Start next scan
                setImmediate(startNextScan);
            };
            
            // Start initial batch
            for (let i = 0; i < this.maxConcurrentScans && i < targets.length; i++) {
                startNextScan();
            }
        });
    }

    /**
     * Run targeted scan
     */
    async runTargetedScan() {
        console.log(chalk.blue.bold('🎯 Targeted KLVR Scanner'));
        console.log(chalk.blue('=' .repeat(50)));
        
        const targets = this.generateTargetedRanges();
        this.totalScans = targets.length;
        
        console.log(chalk.cyan(`🔍 Scanning ${targets.length} high-priority targets across your 3 networks`));
        console.log(chalk.yellow('📊 Priority targeting:'));
        console.log(chalk.yellow('   • IPs around your current addresses'));
        console.log(chalk.yellow('   • Common KLVR device ranges (100-200)'));
        console.log(chalk.yellow('   • Typical network device IPs'));
        console.log('');

        this.startTime = Date.now();
        await this.scanTargets(targets);
        
        console.log(''); // New line after progress
        return this.foundDevices;
    }

    /**
     * Display results
     */
    displayResults() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        
        console.log('');
        console.log(chalk.blue.bold('🎯 Targeted Scan Results'));
        console.log(chalk.blue('=' .repeat(50)));
        console.log(chalk.gray(`Completed in ${elapsed.toFixed(1)} seconds`));
        console.log(chalk.gray(`Scan rate: ${(this.completedScans / elapsed).toFixed(1)} targets/second`));
        console.log('');
        
        if (this.foundDevices.length === 0) {
            console.log(chalk.yellow('⚠️  No KLVR devices found in targeted scan'));
            console.log('');
            console.log(chalk.cyan('💡 Next steps:'));
            console.log(chalk.cyan('   • Try the full network scanner: node tools/network-scanner.js'));
            console.log(chalk.cyan('   • Check if devices are on different subnets'));
            console.log(chalk.cyan('   • Verify devices are powered and connected'));
            console.log(chalk.cyan('   • Use Bonjour discovery: node src/cli/klvr-tool.js device-info'));
            return;
        }

        console.log(chalk.green(`🎯 Found ${this.foundDevices.length} KLVR device(s):`));
        console.log('');
        
        this.foundDevices.forEach((device, index) => {
            console.log(chalk.white.bold(`${index + 1}. ${device.deviceName}`));
            console.log(chalk.gray(`   🌐 ${device.ip}:${device.port} (${device.network})`));
            console.log(chalk.gray(`   📦 Firmware: ${device.firmwareVersion}`));
            console.log(chalk.gray(`   🔢 Serial: ${device.serialNumber}`));
            console.log(chalk.blue(`   🔗 ${device.url}`));
            console.log(chalk.gray(`   ⭐ Priority: ${device.priority}`));
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
    const scanner = new TargetedKLVRScanner();
    
    try {
        await scanner.runTargetedScan();
        scanner.displayResults();
        process.exit(0);
    } catch (error) {
        console.log('');
        console.log(chalk.red(`❌ Targeted scan failed: ${error.message}`));
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log(chalk.yellow('🛑 Targeted scan interrupted'));
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = TargetedKLVRScanner;



