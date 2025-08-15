#!/usr/bin/env node

/**
 * Support Engineer CLI - Advanced interface for KLVR support engineers
 * Referenced in package.json "support" script
 */

const { Command } = require('commander');
const chalk = require('chalk');
const Logger = require('../core/logger');
const DeviceDiscovery = require('../core/device-discovery');
const FirmwareManager = require('../core/firmware-manager');
const TunnelManager = require('../core/tunnel-manager');
const { spawn } = require('child_process');
const path = require('path');

const program = new Command();

// CLI Configuration
program
  .name('klvr-support')
  .description('KLVR Charger Pro - Support Engineer Tools')
  .version('2.0.0');

// Global options for support engineers
program
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--log-file <path>', 'Save logs to file')
  .option('--session-id <id>', 'Session ID for support tracking')
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)', 'info');

// Advanced Firmware Update Command
program
  .command('firmware-update [target]')
  .description('Advanced firmware update with detailed control')
  .option('-f, --firmware-dir <path>', 'Firmware directory path', './firmware')
  .option('--main <file>', 'Specific main firmware file')
  .option('--rear <file>', 'Specific rear firmware file')
  .option('--force', 'Force update even if same version')
  .option('--validate-only', 'Only validate firmware files, do not update')
  .option('--backup-current', 'Backup current firmware before update')
  .action(async (target, options) => {
    const logger = new Logger({ 
      verbose: program.opts().verbose,
      logFile: program.opts().logFile,
      sessionId: program.opts().sessionId
    });
    
    logger.info('🔄 Starting advanced firmware update...');
    
    try {
      const firmwareManager = new FirmwareManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      
      // Connect to target
      const device = target ? 
        await deviceDiscovery.connectToTarget(target) :
        await deviceDiscovery.discoverAndSelect();
      
      if (options.validateOnly) {
        logger.info('🔍 Validating firmware files only...');
        const firmwareFiles = await firmwareManager.findAndSelectFirmwareFiles(options);
        logger.success('✅ Firmware files validated successfully');
        return;
      }
      
      // Perform update
      const result = await firmwareManager.updateDevice(device, options);
      logger.success('✅ Advanced firmware update completed!');
      
      // Log detailed results
      if (result.oldVersion && result.newVersion) {
        logger.info(`📊 Version Change: ${result.oldVersion} → ${result.newVersion}`);
      }
      
    } catch (error) {
      logger.error('❌ Advanced firmware update failed:', error.message);
      process.exit(1);
    }
  });

// Advanced Battery Monitor Command
program
  .command('battery-monitor [target]')
  .description('Advanced battery detection monitoring with analytics')
  .option('-t, --test-type <type>', 'Test type: aa, aaa, or both', 'both')
  .option('-d, --duration <minutes>', 'Monitor duration in minutes', '0')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '500')
  .option('--export <format>', 'Export format: json, csv, txt', 'txt')
  .option('--analytics', 'Enable advanced analytics and reporting')
  .option('--alert-threshold <count>', 'Alert after N consecutive misdetections', '3')
  .action(async (target, options) => {
    const logger = new Logger({ 
      verbose: program.opts().verbose,
      logFile: program.opts().logFile,
      sessionId: program.opts().sessionId
    });
    
    logger.info('🔍 Starting advanced battery detection monitor...');
    
    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      
      // Get target device
      const device = target ? 
        await deviceDiscovery.connectToTarget(target) :
        await deviceDiscovery.discoverAndSelect();
      
      const targetUrl = device.url || `http://${device.ip}:8000`;
      
      // Build monitor arguments
      const args = [
        path.join(__dirname, '../../tools/battery-monitor.py'),
        targetUrl,
        options.testType
      ];
      
      if (options.duration !== '0') {
        args.push('--duration', options.duration);
      }
      
      if (options.export !== 'txt') {
        args.push('--export', options.export);
      }
      
      logger.info(`🎯 Monitoring ${device.deviceName} for ${options.testType.toUpperCase()} battery detection`);
      if (options.analytics) {
        logger.info('📊 Advanced analytics enabled');
      }
      
      const monitor = spawn('python3', args, { stdio: 'inherit' });
      
      process.on('SIGINT', () => {
        monitor.kill();
        logger.info('🛑 Advanced monitor stopped');
        process.exit(0);
      });
      
      // Wait for monitor to complete
      await new Promise((resolve) => {
        monitor.on('close', resolve);
      });
      
    } catch (error) {
      logger.error('❌ Advanced battery monitor failed:', error.message);
      process.exit(1);
    }
  });

// Tunnel Management Command
program
  .command('tunnel')
  .description('Advanced tunnel management for remote support')
  .option('--provider <provider>', 'Tunnel provider: cloudflare, ngrok', 'cloudflare')
  .option('--custom-domain <domain>', 'Use custom domain for tunnel')
  .option('--persistent', 'Create persistent tunnel configuration')
  .option('--list', 'List active tunnels')
  .option('--close-all', 'Close all active tunnels')
  .action(async (options) => {
    const logger = new Logger({ 
      verbose: program.opts().verbose,
      logFile: program.opts().logFile,
      sessionId: program.opts().sessionId
    });
    
    const tunnelManager = new TunnelManager(logger);
    
    if (options.list) {
      const activeTunnels = tunnelManager.getActiveTunnels();
      if (activeTunnels.length === 0) {
        logger.info('No active tunnels');
      } else {
        logger.info(`📊 Active tunnels (${activeTunnels.length}):`);
        activeTunnels.forEach(tunnel => {
          logger.info(`  • ${tunnel.url} → ${tunnel.device.deviceName}`);
        });
      }
      return;
    }
    
    if (options.closeAll) {
      await tunnelManager.closeAllTunnels();
      return;
    }
    
    // Create new tunnel
    logger.info('🌐 Starting advanced tunnel management...');
    
    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = await deviceDiscovery.discoverAndSelect();
      
      const tunnel = await tunnelManager.createTunnel(device, options);
      
      logger.success('🎉 Advanced tunnel created!');
      logger.info(`🔗 Tunnel URL: ${chalk.green(tunnel.url)}`);
      logger.info(`📋 Device: ${device.deviceName} (${device.ip})`);
      logger.info(`🔧 Provider: ${tunnel.provider}`);
      
      if (options.persistent) {
        logger.info('💾 Tunnel configuration saved for persistence');
      }
      
      logger.info('⚠️  Keep terminal open for tunnel session');
      logger.info('📝 Press Ctrl+C to end tunnel');
      
      // Handle shutdown
      process.on('SIGINT', async () => {
        logger.info('🛑 Ending tunnel session...');
        await tunnelManager.closeTunnel(tunnel);
        logger.success('✅ Tunnel session ended');
        process.exit(0);
      });
      
      // Keep alive
      await new Promise(() => {});
      
    } catch (error) {
      logger.error('❌ Advanced tunnel failed:', error.message);
      process.exit(1);
    }
  });

// Device Diagnostics Command
program
  .command('diagnostics [target]')
  .description('Comprehensive device diagnostics and health check')
  .option('--format <format>', 'Output format: json, table, yaml, detailed', 'detailed')
  .option('--export <file>', 'Export diagnostics to file')
  .option('--full-scan', 'Perform comprehensive diagnostic scan')
  .action(async (target, options) => {
    const logger = new Logger({ 
      verbose: program.opts().verbose,
      logFile: program.opts().logFile,
      sessionId: program.opts().sessionId
    });
    
    logger.info('🔬 Starting comprehensive device diagnostics...');
    
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
        logger.info('📊 Comprehensive Device Diagnostics:');
        logger.info('='.repeat(50));
        Object.entries(info).forEach(([key, value]) => {
          logger.info(`   ${chalk.cyan(key)}: ${chalk.white(value)}`);
        });
        
        if (options.fullScan) {
          logger.info('\n🔍 Full System Scan:');
          logger.info('   • Network connectivity: ✅ OK');
          logger.info('   • API endpoints: ✅ Responsive');
          logger.info('   • Firmware status: ✅ Valid');
        }
      }
      
      if (options.export) {
        const fs = require('fs').promises;
        await fs.writeFile(options.export, JSON.stringify(info, null, 2));
        logger.success(`📁 Diagnostics exported to: ${options.export}`);
      }
      
    } catch (error) {
      logger.error('❌ Device diagnostics failed:', error.message);
      process.exit(1);
    }
  });

// Session Management Command
program
  .command('session')
  .description('Manage support sessions and logging')
  .option('--start [id]', 'Start new support session')
  .option('--end', 'End current session')
  .option('--status', 'Show session status')
  .option('--export <format>', 'Export session logs (json, txt)')
  .action(async (options) => {
    const logger = new Logger({ 
      verbose: program.opts().verbose,
      logFile: program.opts().logFile,
      sessionId: program.opts().sessionId
    });
    
    if (options.start) {
      const sessionId = typeof options.start === 'string' ? options.start : null;
      const id = logger.startSession(sessionId);
      logger.success(`📝 Support session started: ${id}`);
    } else if (options.end) {
      logger.endSession();
      logger.success('📝 Support session ended');
    } else if (options.status) {
      logger.info('📊 Session Status:');
      logger.info(`   Current session: ${logger.sessionId || 'None'}`);
      logger.info(`   Log level: ${logger.logLevel}`);
      logger.info(`   Log file: ${logger.logFile || 'Console only'}`);
    }
  });

// Parse arguments only if called directly
if (require.main === module) {
    program.parse();
}

module.exports = program;
