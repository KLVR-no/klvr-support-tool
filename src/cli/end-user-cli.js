#!/usr/bin/env node

/**
 * End User CLI - Simplified interface for end users
 * Referenced in package.json "start" script
 */

const chalk = require('chalk');
const inquirer = require('inquirer');
const Logger = require('../core/logger');
const DeviceDiscovery = require('../core/device-discovery');
const FirmwareManager = require('../core/firmware-manager');
const TunnelManager = require('../core/tunnel-manager');
const { spawn } = require('child_process');
const path = require('path');

class EndUserCLI {
    constructor() {
        this.logger = new Logger({ verbose: false });
    }

    async start() {
        console.log(chalk.blue('='.repeat(60)));
        console.log(chalk.blue('    KLVR Charger Pro - End User Tools'));
        console.log(chalk.blue('='.repeat(60)));
        console.log('');

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { 
                        name: '🔄 Update Firmware', 
                        value: 'firmware',
                        short: 'Update firmware on your KLVR device'
                    },
                    { 
                        name: '🌐 Start Remote Support Session', 
                        value: 'remote',
                        short: 'Allow KLVR support to access your device remotely'
                    },
                    { 
                        name: '🔗 Start Persistent Remote Support (Same URL)', 
                        value: 'persistent-remote',
                        short: 'Create consistent URL that stays the same each time'
                    },
                    { 
                        name: '🔍 Check Device Status', 
                        value: 'info',
                        short: 'View information about your KLVR device'
                    },
                    { 
                        name: '🔋 Monitor Battery Detection', 
                        value: 'monitor',
                        short: 'Test battery detection functionality'
                    },
                    {
                        name: '❌ Exit',
                        value: 'exit'
                    }
                ]
            }
        ]);

        try {
            switch (action) {
                case 'firmware':
                    await this.handleFirmwareUpdate();
                    break;
                case 'remote':
                    await this.handleRemoteSupport();
                    break;
                case 'persistent-remote':
                    await this.handleRemoteSupport({ persistent: true });
                    break;
                case 'info':
                    await this.handleDeviceInfo();
                    break;
                case 'monitor':
                    await this.handleBatteryMonitor();
                    break;
                case 'exit':
                    console.log('👋 Goodbye!');
                    process.exit(0);
                    break;
            }
        } catch (error) {
            this.logger.error(`Operation failed: ${error.message}`);
            this.logger.info('Please try again or contact support if the issue persists.');
            process.exit(1);
        }
    }

    async handleFirmwareUpdate() {
        console.log('\n' + chalk.yellow('='.repeat(60)));
        console.log(chalk.yellow('    Firmware Update'));
        console.log(chalk.yellow('='.repeat(60)));
        
        const deviceDiscovery = new DeviceDiscovery(this.logger);
        const firmwareManager = new FirmwareManager(this.logger);

        // Discover device
        const device = await deviceDiscovery.discoverAndSelect();
        
        // Get available firmware versions
        const availableVersions = await this._getAvailableFirmwareVersions(firmwareManager);
        
        if (availableVersions.length === 0) {
            this.logger.error('No firmware files found in firmware directory');
            return;
        }
        
        // Let user select firmware version
        const { selectedVersion } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedVersion',
                message: 'Select firmware version to install:',
                choices: availableVersions.map((version, index) => ({
                    name: `${version.version} ${index === 0 ? chalk.green('(Latest)') : ''}`,
                    value: version,
                    short: version.version
                }))
            }
        ]);
        
        // Show firmware details
        console.log('\n' + chalk.cyan('📋 Firmware Details:'));
        console.log(`   Version: ${chalk.white(selectedVersion.version)}`);
        console.log(`   Main: ${chalk.gray(selectedVersion.main.file)}`);
        console.log(`   Rear: ${chalk.gray(selectedVersion.rear.file)}`);
        console.log(`   Modified: ${chalk.gray(selectedVersion.mtime.toLocaleString())}`);
        
        // Confirm update
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Install ${selectedVersion.version} firmware on ${device.deviceName}?`,
                default: false
            }
        ]);

        if (!confirm) {
            this.logger.info('Firmware update cancelled');
            return;
        }

        // Perform update with selected version
        const firmwareFiles = {
            main: selectedVersion.mainPath,
            rear: selectedVersion.rearPath
        };
        
        await firmwareManager.executeFirmwareUpdate(device, firmwareFiles);
        this.logger.success('Firmware update completed successfully!');
    }

    /**
     * Get available firmware versions for user selection
     */
    async _getAvailableFirmwareVersions(firmwareManager) {
        try {
            const firmwareDir = path.join(__dirname, '../../firmware');
            const fs = require('fs').promises;
            const files = await fs.readdir(firmwareDir);
            
            // Filter for signed binary files
            const mainFiles = files.filter(file => file.startsWith('main_') && file.endsWith('.signed.bin'));
            const rearFiles = files.filter(file => file.startsWith('rear_') && file.endsWith('.signed.bin'));
            
            if (mainFiles.length === 0 || rearFiles.length === 0) {
                return [];
            }
            
            // Sort by modification time and add stats
            const sortFiles = async (fileList) => {
                const filesWithStats = await Promise.all(
                    fileList.map(async (file) => {
                        const filePath = path.join(firmwareDir, file);
                        const stats = await fs.stat(filePath);
                        return { file, mtime: stats.mtime };
                    })
                );
                return filesWithStats.sort((a, b) => b.mtime - a.mtime);
            };
            
            const sortedMainFiles = await sortFiles(mainFiles);
            const sortedRearFiles = await sortFiles(rearFiles);
            
            // Find matched firmware pairs using the same logic as firmware manager
            const matchedPairs = this._findMatchedFirmwarePairs(sortedMainFiles, sortedRearFiles, firmwareDir);
            
            return matchedPairs;
            
        } catch (error) {
            this.logger.error(`Failed to get firmware versions: ${error.message}`);
            return [];
        }
    }

    /**
     * Find matched firmware pairs (same logic as firmware manager)
     */
    _findMatchedFirmwarePairs(mainFiles, rearFiles, firmwareDir) {
        const pairs = [];
        
        for (const mainFile of mainFiles) {
            const version = this._extractFirmwareVersion(mainFile.file);
            if (!version) continue;
            
            const matchingRear = rearFiles.find(rearFile => {
                const rearVersion = this._extractFirmwareVersion(rearFile.file);
                return rearVersion === version;
            });
            
            if (matchingRear) {
                pairs.push({
                    version: version,
                    main: mainFile,
                    rear: matchingRear,
                    mtime: mainFile.mtime > matchingRear.mtime ? mainFile.mtime : matchingRear.mtime,
                    mainPath: path.join(firmwareDir, mainFile.file),
                    rearPath: path.join(firmwareDir, matchingRear.file)
                });
            }
        }
        
        return pairs.sort((a, b) => b.mtime - a.mtime);
    }

    /**
     * Extract version from firmware filename (same logic as firmware manager)
     */
    _extractFirmwareVersion(filename) {
        const match = filename.match(/_(v\d+\.\d+\.\d+(?:beta|alpha|rc)?(?:-[^.]+)?)\.signed\.bin$/);
        return match ? match[1] : null;
    }

    async handleRemoteSupport(options = {}) {
        // Enable session reuse by default for consistent URLs
        const useSessionReuse = options.reuseSession !== false;
        const sessionType = options.persistent ? 'Persistent Remote Support Session' : 'Remote Support Session';
        const sessionIcon = options.persistent ? '🔗' : '🌐';
        
        console.log('\n' + chalk.green('='.repeat(60)));
        console.log(chalk.green(`    ${sessionType}`));
        console.log(chalk.green('='.repeat(60)));
        
        if (useSessionReuse) {
            console.log(chalk.blue('🔄 Checking for previous tunnel sessions...'));
            console.log(chalk.yellow('   Note: Each session creates a new URL (Cloudflare limitation)'));
            console.log(chalk.blue('   💡 For consistent URLs, contact support about persistent tunnels'));
            console.log('');
        }
        
        if (options.persistent) {
            console.log(chalk.yellow('📌 Attempting to create a consistent URL...'));
            console.log(chalk.yellow('   Note: True persistent tunnels require Cloudflare account setup.'));
            console.log(chalk.yellow('   For now, we\'ll create a secure quick tunnel with session tracking.'));
            console.log('');
        }
        
        const deviceDiscovery = new DeviceDiscovery(this.logger);
        const tunnelManager = new TunnelManager(this.logger);

        // Discover device
        const device = await deviceDiscovery.discoverAndSelect();
        
        // Create tunnel with session reuse enabled by default
        const tunnelOptions = {
            ...options,
            reuseSession: useSessionReuse
        };
        const tunnel = await tunnelManager.createTunnel(device, tunnelOptions);
        
        console.log('\n' + chalk.green('='.repeat(60)));
        console.log(chalk.green(`🎉 ${sessionType.toUpperCase()} ACTIVE`));
        console.log(chalk.green('='.repeat(60)));
        console.log(`📍 Device: ${device.deviceName} at ${device.ip}`);
        console.log(`${sessionIcon} Tunnel URL: ${chalk.cyan(tunnel.url)}`);
        console.log(`⏰ Session started at ${new Date().toLocaleTimeString()}`);
        
        if (options.persistent) {
            if (tunnel.sessionInfo && !tunnel.sessionInfo.persistent) {
                console.log(chalk.yellow('📝 Session Tracking Enabled'));
                console.log(chalk.yellow('   This URL is for this specific support session.'));
                console.log(chalk.yellow('   💡 Tip: Save this URL to reuse during the same support case!'));
            } else if (tunnel.persistent) {
                console.log(`🔗 Tunnel Name: ${chalk.magenta(tunnel.name)}`);
                console.log(chalk.green('✨ This URL will be the same every time you start a persistent session!'));
            }
        }
        
        console.log('');
        console.log(chalk.yellow('🔗 Share this URL with KLVR support:'));
        console.log(`   ${chalk.cyan.bold(tunnel.url)}`);
        console.log('');
        console.log(chalk.red('⚠️  Keep this terminal open during the support session'));
        console.log(chalk.red('   Press Ctrl+C to end the session...'));
        console.log(chalk.green('='.repeat(60)));
        
        // Handle shutdown gracefully
        process.on('SIGINT', async () => {
            console.log('\n\n🛑 Ending remote support session...');
            await tunnelManager.closeTunnel(tunnel);
            console.log('✅ Tunnel closed');
            console.log('👋 Remote support session ended');
            process.exit(0);
        });
        
        // Keep the process alive
        await new Promise(() => {});
    }

    async handleDeviceInfo() {
        console.log('\n' + chalk.cyan('='.repeat(60)));
        console.log(chalk.cyan('    Device Information'));
        console.log(chalk.cyan('='.repeat(60)));
        
        const deviceDiscovery = new DeviceDiscovery(this.logger);
        
        // Discover device
        const device = await deviceDiscovery.discoverAndSelect();
        
        // Get detailed info
        const info = await deviceDiscovery.getDetailedInfo(device);
        
        console.log('\n📊 Device Information:');
        console.table(info);
    }

    async handleBatteryMonitor() {
        console.log('\n' + chalk.magenta('='.repeat(60)));
        console.log(chalk.magenta('    Battery Detection Monitor'));
        console.log(chalk.magenta('='.repeat(60)));
        
        const deviceDiscovery = new DeviceDiscovery(this.logger);
        
        // Discover device
        const device = await deviceDiscovery.discoverAndSelect();
        
        // Get test type
        const { testType } = await inquirer.prompt([
            {
                type: 'list',
                name: 'testType',
                message: 'What type of batteries are you testing?',
                choices: [
                    { name: 'AA batteries', value: 'aa' },
                    { name: 'AAA batteries', value: 'aaa' },
                    { name: 'Both types (general monitoring)', value: 'both' }
                ]
            }
        ]);
        
        const targetUrl = device.url || `http://${device.ip}:8000`;
        
        // Launch Python monitor
        console.log(`\n🔍 Starting battery detection monitor for ${testType.toUpperCase()} batteries...`);
        console.log('Press Ctrl+C to stop monitoring\n');
        
        const monitor = spawn('python3', [
            path.join(__dirname, '../../tools/battery-monitor.py'),
            targetUrl,
            testType
        ], { stdio: 'inherit' });
        
        process.on('SIGINT', () => {
            monitor.kill();
            console.log('\n🛑 Monitor stopped');
            process.exit(0);
        });
        
        // Wait for monitor to finish
        await new Promise((resolve) => {
            monitor.on('close', resolve);
        });
    }
}

// Run if called directly
if (require.main === module) {
    const cli = new EndUserCLI();
    cli.start().catch(error => {
        console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
        process.exit(1);
    });
}

module.exports = EndUserCLI;
