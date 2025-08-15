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
        
        // Confirm update
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Update firmware on ${device.deviceName}?`,
                default: false
            }
        ]);

        if (!confirm) {
            this.logger.info('Firmware update cancelled');
            return;
        }

        // Perform update
        await firmwareManager.updateDevice(device);
        this.logger.success('Firmware update completed successfully!');
    }

    async handleRemoteSupport() {
        console.log('\n' + chalk.green('='.repeat(60)));
        console.log(chalk.green('    Remote Support Session'));
        console.log(chalk.green('='.repeat(60)));
        
        const deviceDiscovery = new DeviceDiscovery(this.logger);
        const tunnelManager = new TunnelManager(this.logger);

        // Discover device
        const device = await deviceDiscovery.discoverAndSelect();
        
        // Create tunnel
        const tunnel = await tunnelManager.createTunnel(device);
        
        console.log('\n' + chalk.green('='.repeat(60)));
        console.log(chalk.green('🎉 REMOTE SUPPORT SESSION ACTIVE'));
        console.log(chalk.green('='.repeat(60)));
        console.log(`📍 Device: ${device.deviceName} at ${device.ip}`);
        console.log(`🌐 Tunnel URL: ${chalk.cyan(tunnel.url)}`);
        console.log(`⏰ Session started at ${new Date().toLocaleTimeString()}`);
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
