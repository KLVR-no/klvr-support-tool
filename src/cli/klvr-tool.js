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
  .option('--rear-only', 'Update only the rear board firmware')
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
      
      // Get available firmware versions for selection
      const availableVersions = await getAvailableFirmwareVersions(firmwareManager, options.rearOnly);
      
      if (availableVersions.length === 0) {
        logger.error('No firmware files found in firmware directory');
        process.exit(1);
      }
      
      // Let user select firmware version
      const versionMessage = options.rearOnly ? 
        'Select rear firmware version to install:' : 
        'Select firmware version to install:';
      
      const { selectedVersion } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedVersion',
          message: versionMessage,
          choices: availableVersions.map((version) => ({
            name: version.version,
            value: version,
            short: version.version
          }))
        }
      ]);
      
      // Show firmware details
      console.log('\n' + chalk.cyan('📋 Firmware Details:'));
      console.log(`   Version: ${chalk.white(selectedVersion.version)}`);
      if (!options.rearOnly) {
        console.log(`   Main: ${chalk.gray(selectedVersion.main.file)}`);
      }
      console.log(`   Rear: ${chalk.gray(selectedVersion.rear.file)}`);
      console.log(`   Modified: ${chalk.gray(selectedVersion.mtime.toLocaleString())}`);
      
      // Confirm update
      const updateType = options.rearOnly ? 'rear board only' : 'both boards';
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Install ${selectedVersion.version} firmware (${updateType}) on ${device.deviceName}?`,
          default: false
        }
      ]);
      
      if (!confirm) {
        logger.info('Firmware update cancelled by user');
        return;
      }
      
      // Update firmware with selected version
      const firmwareOptions = {
        ...options,
        rear: selectedVersion.rearPath
      };
      
      if (!options.rearOnly) {
        firmwareOptions.main = selectedVersion.mainPath;
      }
      
      await firmwareManager.updateDevice(device, firmwareOptions);
      
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
          { name: '🔄 Update Firmware (Both Boards)', value: 'firmware' },
          { name: '🔧 Update Rear Board Only', value: 'firmware-rear' },
          { name: '🌐 Start Remote Support Session', value: 'remote' },
          { name: '❌ Exit', value: 'exit' }
        ]
      }
    ]);
    
    switch (action) {
      case 'firmware':
        await program.parseAsync(['node', 'klvr-tool', 'firmware-update']);
        break;
      case 'firmware-rear':
        await program.parseAsync(['node', 'klvr-tool', 'firmware-update', '--rear-only']);
        break;
      case 'remote':
        await program.parseAsync(['node', 'klvr-tool', 'remote-support']);
        break;
      case 'exit':
        console.log('👋 Goodbye!');
        process.exit(0);
        break;
    }
  });

// Helper function to get available firmware versions
async function getAvailableFirmwareVersions(firmwareManager, rearOnly = false) {
  try {
    const firmwareDir = path.join(__dirname, '../../firmware');
    const fs = require('fs').promises;
    const files = await fs.readdir(firmwareDir);
    
    // Filter for signed binary files
    const mainFiles = files.filter(file => file.startsWith('main_') && file.endsWith('.signed.bin'));
    const rearFiles = files.filter(file => file.startsWith('rear_') && file.endsWith('.signed.bin'));
    
    if (rearOnly) {
      if (rearFiles.length === 0) {
        return [];
      }
    } else {
      if (mainFiles.length === 0 || rearFiles.length === 0) {
        return [];
      }
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
    
    if (rearOnly) {
      // For rear-only updates, create version objects from rear files only
      return sortedRearFiles.map(rearFile => {
        const version = extractFirmwareVersion(rearFile.file);
        return {
          version: version || 'Unknown',
          rear: rearFile,
          mtime: rearFile.mtime,
          rearPath: path.join(firmwareDir, rearFile.file)
        };
      });
    } else {
      // Find matched firmware pairs using the same logic as firmware manager
      const matchedPairs = findMatchedFirmwarePairs(sortedMainFiles, sortedRearFiles, firmwareDir);
      return matchedPairs;
    }
    
  } catch (error) {
    console.error(`Failed to get firmware versions: ${error.message}`);
    return [];
  }
}

// Helper function to find matched firmware pairs
function findMatchedFirmwarePairs(mainFiles, rearFiles, firmwareDir) {
  const pairs = [];
  
  for (const mainFile of mainFiles) {
    const version = extractFirmwareVersion(mainFile.file);
    if (!version) continue;
    
    const matchingRear = rearFiles.find(rearFile => {
      const rearVersion = extractFirmwareVersion(rearFile.file);
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

// Helper function to extract firmware version from filename
function extractFirmwareVersion(filename) {
  const match = filename.match(/_(v\d+\.\d+\.\d+(?:beta|alpha|rc)?(?:-[^.]+)?)\.signed\.bin$/);
  return match ? match[1] : null;
}

// Default to interactive mode if no command provided
if (process.argv.length === 2) {
  program.parseAsync(['node', 'klvr-tool', 'interactive']);
} else {
  program.parse();
}

module.exports = program;
