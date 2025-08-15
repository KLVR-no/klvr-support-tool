#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const path = require('path');

// Import core modules
const DeviceDiscovery = require('../core/device-discovery');
const FirmwareManager = require('../core/firmware-manager');
const TunnelManager = require('../core/tunnel-manager');
const Logger = require('../core/logger');

const program = new Command();

// CLI Configuration
program
  .name('klvr-tool')
  .description('KLVR Charger Pro - Professional firmware updater and support tools')
  .version('2.0.0');

// Global options
program
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--log-file <path>', 'Save logs to file')
  .option('--session-id <id>', 'Session ID for support tracking');

// Firmware Update Command
program
  .command('firmware-update [target]')
  .description('Update firmware on KLVR device')
  .option('-f, --firmware-dir <path>', 'Firmware directory path', './firmware')
  .option('--main <file>', 'Specific main firmware file')
  .option('--rear <file>', 'Specific rear firmware file')
  .option('--force', 'Force update even if same version')
  .action(async (target, options) => {
    const logger = new Logger(options);
    logger.info('🔄 Starting firmware update...');
    
    try {
      const firmwareManager = new FirmwareManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      
      // Discover or connect to target
      const device = target ? 
        await deviceDiscovery.connectToTarget(target) :
        await deviceDiscovery.discoverAndSelect();
      
      // Update firmware
      await firmwareManager.updateDevice(device, options);
      
      logger.success('✅ Firmware update completed successfully!');
      
    } catch (error) {
      logger.error('❌ Firmware update failed:', error.message);
      process.exit(1);
    }
  });

// Battery Monitor Command
program
  .command('battery-monitor [target]')
  .description('Monitor battery detection in real-time')
  .option('-t, --test-type <type>', 'Test type: aa, aaa, or both', 'both')
  .option('-d, --duration <minutes>', 'Monitor duration in minutes', '0')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '500')
  .option('--export <format>', 'Export format: json, csv, txt', 'txt')
  .action(async (target, options) => {
    const logger = new Logger(options);
    logger.info('🔍 Starting battery detection monitor...');
    
    try {
      const { spawn } = require('child_process');
      const deviceDiscovery = new DeviceDiscovery(logger);
      
      // Get target URL
      const device = target ? 
        await deviceDiscovery.connectToTarget(target) :
        await deviceDiscovery.discoverAndSelect();
      
      const targetUrl = device.url || `http://${device.ip}:8000`;
      
      // Launch Python monitor
      const args = [
        path.join(__dirname, '../../tools/battery-monitor.py'),
        targetUrl,
        options.testType
      ];
      
      if (options.duration !== '0') {
        args.push('--duration', options.duration);
      }
      
      const monitor = spawn('python3', args, { stdio: 'inherit' });
      
      process.on('SIGINT', () => {
        monitor.kill();
        logger.info('🛑 Monitor stopped by user');
        process.exit(0);
      });
      
    } catch (error) {
      logger.error('❌ Battery monitor failed:', error.message);
      process.exit(1);
    }
  });

// Remote Support Command
program
  .command('remote-support')
  .description('Start remote support session with tunnel')
  .option('--tunnel-provider <provider>', 'Tunnel provider: cloudflare, ngrok', 'cloudflare')
  .option('--custom-domain <domain>', 'Use custom domain for tunnel')
  .action(async (options) => {
    const logger = new Logger(options);
    logger.info('🌐 Starting remote support session...');
    
    try {
      const tunnelManager = new TunnelManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      
      // Discover device
      const device = await deviceDiscovery.discoverAndSelect();
      
      // Create tunnel
      const tunnel = await tunnelManager.createTunnel(device, options);
      
      logger.info('🎉 Remote support session active!');
      logger.info(`🔗 Tunnel URL: ${chalk.green(tunnel.url)}`);
      logger.info('📋 Share this URL with KLVR support');
      logger.info('⚠️  Keep this terminal open during support session');
      logger.info('📝 Press Ctrl+C to end session');
      
      // Keep alive
      process.on('SIGINT', async () => {
        logger.info('🛑 Ending remote support session...');
        await tunnelManager.closeTunnel(tunnel);
        logger.success('✅ Session ended');
        process.exit(0);
      });
      
      // Keep process alive
      await new Promise(() => {});
      
    } catch (error) {
      logger.error('❌ Remote support session failed:', error.message);
      process.exit(1);
    }
  });

// Device Info Command
program
  .command('device-info [target]')
  .description('Get device information and status')
  .option('--format <format>', 'Output format: json, table, yaml', 'table')
  .action(async (target, options) => {
    const logger = new Logger(options);
    
    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = target ? 
        await deviceDiscovery.connectToTarget(target) :
        await deviceDiscovery.discoverAndSelect();
      
      const info = await deviceDiscovery.getDetailedInfo(device);
      
      if (options.format === 'json') {
        console.log(JSON.stringify(info, null, 2));
      } else if (options.format === 'table') {
        console.table(info);
      } else {
        logger.info('📊 Device Information:');
        Object.entries(info).forEach(([key, value]) => {
          logger.info(`   ${key}: ${value}`);
        });
      }
      
    } catch (error) {
      logger.error('❌ Failed to get device info:', error.message);
      process.exit(1);
    }
  });

// Interactive End-User Mode
program
  .command('interactive')
  .description('Start interactive mode for end users')
  .action(async () => {
    console.log(chalk.blue('='.repeat(60)));
    console.log(chalk.blue('    KLVR Charger Pro Tools'));
    console.log(chalk.blue('='.repeat(60)));
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🔄 Update Firmware', value: 'firmware' },
          { name: '🌐 Start Remote Support Session', value: 'remote' },
          { name: '🔍 Check Device Status', value: 'info' },
          { name: '🔋 Monitor Battery Detection', value: 'monitor' }
        ]
      }
    ]);
    
    switch (action) {
      case 'firmware':
        await program.parseAsync(['node', 'klvr-tool', 'firmware-update']);
        break;
      case 'remote':
        await program.parseAsync(['node', 'klvr-tool', 'remote-support']);
        break;
      case 'info':
        await program.parseAsync(['node', 'klvr-tool', 'device-info']);
        break;
      case 'monitor':
        await program.parseAsync(['node', 'klvr-tool', 'battery-monitor']);
        break;
    }
  });

// Default to interactive mode if no command provided
if (process.argv.length === 2) {
  program.parseAsync(['node', 'klvr-tool', 'interactive']);
} else {
  program.parse();
}

module.exports = program;
