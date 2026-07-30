#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const path = require('path');
const { spawn } = require('child_process');

const DeviceDiscovery = require('../core/device-discovery');
const FirmwareManager = require('../core/firmware-manager');
const TunnelManager = require('../core/tunnel-manager');
const Logger = require('../core/logger');
const {
  findPython,
  loadActiveTarget,
  saveActiveTarget,
  clearActiveTarget
} = require('../core/platform');

const program = new Command();

program
  .name('klvr-tool')
  .description('Klvr Charger Pro - Professional firmware updater and support tools')
  .version('2.1.0');

program
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--log-file <path>', 'Save logs to file')
  .option('--session-id <id>', 'Session ID for support tracking');

async function resolveDevice(target, logger, deviceDiscovery) {
  if (target) {
    const device = await deviceDiscovery.connectToTarget(target);
    await saveActiveTarget(target);
    return device;
  }

  const saved = await loadActiveTarget();
  if (saved) {
    logger.info(`Using saved target: ${saved}`);
    try {
      return await deviceDiscovery.connectToTarget(saved);
    } catch (err) {
      logger.warn(`Saved target unreachable (${err.message}); clearing and rediscovering.`);
      await clearActiveTarget();
    }
  }

  return deviceDiscovery.discoverAndSelect();
}

program
  .command('use-target <target>')
  .description('Save an IP or tunnel URL for subsequent commands')
  .action(async (target) => {
    const logger = new Logger(program.opts());
    const discovery = new DeviceDiscovery(logger);
    try {
      const device = await discovery.connectToTarget(target);
      await saveActiveTarget(target);
      logger.success(`Saved target: ${target}`);
      logger.info(`Device: ${device.deviceName} (${device.ip || device.url})`);
    } catch (error) {
      logger.error(`Could not reach target: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('clear-target')
  .description('Clear the saved IP / tunnel URL')
  .action(async () => {
    await clearActiveTarget();
    console.log('Cleared saved target.');
  });

program
  .command('firmware-update [target]')
  .description('Update firmware on Klvr device (LAN IP or remote tunnel URL)')
  .option('-f, --firmware-dir <path>', 'Firmware directory path')
  .option('--main <file>', 'Specific main firmware file')
  .option('--rear <file>', 'Specific rear firmware file')
  .option('--version <version>', 'Firmware version to install (e.g. 1.8.9-beta or v1.8.9-beta)')
  .option('--rear-only', 'Update only the rear board firmware')
  .option('--force', 'Force update even if same version')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (target, options) => {
    const logger = new Logger({ ...program.opts(), ...options });
    logger.info('Starting firmware update...');

    try {
      const firmwareManager = new FirmwareManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = await resolveDevice(target, logger, deviceDiscovery);

      const firmwareDir = options.firmwareDir
        || path.join(__dirname, '../../firmware');

      let selected = null;
      if (options.main && options.rear) {
        selected = {
          version: path.basename(options.main),
          mainPath: options.main,
          rearPath: options.rear
        };
      } else if (options.version) {
        const files = await firmwareManager.findAndSelectFirmwareFiles({
          firmwareDir,
          version: options.version,
          rearOnly: options.rearOnly
        });
        selected = {
          version: options.version.startsWith('v') ? options.version : `v${options.version}`,
          mainPath: files.main,
          rearPath: files.rear
        };
      } else {
        const availableVersions = await firmwareManager.listAvailableVersions(options.rearOnly);
        if (availableVersions.length === 0) {
          logger.error('No firmware files found in firmware directory');
          process.exit(1);
        }

        const { selectedVersion } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedVersion',
            message: options.rearOnly
              ? 'Select rear firmware version to install:'
              : 'Select firmware version to install:',
            choices: availableVersions.map((version) => ({
              name: version.version,
              value: version,
              short: version.version
            }))
          }
        ]);
        selected = selectedVersion;
      }

      let currentVersion = 'unknown';
      try {
        const versions = await firmwareManager._getFirmwareVersions(device);
        currentVersion = `rear=${versions.firmwareRear} main=${versions.firmwareMain}`;
      } catch (_) {
        // preflight will retry
      }

      console.log('');
      console.log(chalk.cyan('Firmware update summary:'));
      console.log(`   Device:          ${chalk.white(device.deviceName)} (${device.ip || device.url})`);
      console.log(`   Current:         ${chalk.yellow(currentVersion)}`);
      console.log(`   Install:         ${chalk.green(selected.version)}`);
      console.log(`   Path:            ${device.url && String(device.url).startsWith('https') ? chalk.magenta('REMOTE TUNNEL') : chalk.gray('LAN')}`);
      if (options.rearOnly) {
        console.log(`   Scope:           ${chalk.gray('rear board only')}`);
      }
      console.log('');

      if (!options.yes) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Install ${selected.version} on ${device.deviceName}?`,
            default: false
          }
        ]);
        if (!confirm) {
          logger.info('Firmware update cancelled by user');
          return;
        }
      }

      const firmwareOptions = {
        firmwareDir,
        force: !!options.force,
        rearOnly: !!options.rearOnly,
        rear: selected.rearPath,
        main: selected.mainPath
      };

      const result = await firmwareManager.updateDevice(device, firmwareOptions);

      if (result.skipped) {
        logger.success(`Already on ${result.newVersion} — nothing to do.`);
      } else if (result.confirmed) {
        logger.success(`Firmware update confirmed: ${result.oldVersion} → ${result.newVersion}`);
      } else {
        logger.success('Firmware update completed.');
      }
    } catch (error) {
      if (error.message === 'Cancelled by user') {
        console.log('\nUpdate cancelled.');
        process.exit(0);
      }
      console.log('');
      logger.error(`Firmware update failed: ${error.message}`);
      console.log('');
      console.log('  If you need help, contact Klvr support at stian@klvr.no');
      process.exit(1);
    }
  });

program
  .command('battery-monitor [target]')
  .description('Monitor battery detection in real-time')
  .option('-t, --test-type <type>', 'Test type: aa, aaa, or both', 'both')
  .option('-d, --duration <minutes>', 'Monitor duration in minutes', '0')
  .action(async (target, options) => {
    const logger = new Logger(program.opts());
    logger.info('Starting battery detection monitor...');

    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = await resolveDevice(target, logger, deviceDiscovery);
      const targetUrl = device.url || `http://${device.ip}:8000`;

      const py = await findPython();
      const args = [
        ...py.prefixArgs,
        path.join(__dirname, '../../tools/battery-monitor.py'),
        targetUrl,
        options.testType
      ];
      if (options.duration !== '0') {
        args.push('--duration', options.duration);
      }

      const monitor = spawn(py.command, args, { stdio: 'inherit', windowsHide: true });
      process.on('SIGINT', () => {
        monitor.kill();
        logger.info('Monitor stopped by user');
        process.exit(0);
      });
    } catch (error) {
      logger.error(`Battery monitor failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('remote-support')
  .description('Start remote support session with tunnel (customer side)')
  .option('--tunnel-provider <provider>', 'Tunnel provider: cloudflare', 'cloudflare')
  .action(async (options) => {
    const logger = new Logger(program.opts());
    logger.info('Starting remote support session...');

    try {
      const tunnelManager = new TunnelManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = await deviceDiscovery.discoverAndSelect();
      const tunnel = await tunnelManager.createTunnel(device, options);

      console.log('');
      logger.success('Remote support session active!');
      console.log('');
      console.log(chalk.green('  Share this URL with Klvr support:'));
      console.log(chalk.bold.white(`  ${tunnel.url}`));
      console.log('');
      console.log(chalk.cyan('  Support can then run:'));
      console.log(`    klvr-tool use-target ${tunnel.url}`);
      console.log('    klvr-tool device-info');
      console.log('    klvr-tool firmware-update --version 1.8.9-beta -y');
      console.log('');
      console.log(chalk.yellow('  Keep this terminal open. Press Ctrl+C to end the session.'));
      console.log('');

      process.on('SIGINT', async () => {
        logger.info('Ending remote support session...');
        await tunnelManager.closeTunnel(tunnel);
        logger.success('Session ended');
        process.exit(0);
      });

      await new Promise(() => {});
    } catch (error) {
      if (error.message === 'Cancelled by user') {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.log('');
      logger.error(`Remote support session failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('device-info [target]')
  .description('Get device information and status')
  .option('--format <format>', 'Output format: json, table', 'table')
  .action(async (target, options) => {
    const logger = new Logger(program.opts());
    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      const device = await resolveDevice(target, logger, deviceDiscovery);
      const info = await deviceDiscovery.getDetailedInfo(device);

      if (options.format === 'json') {
        console.log(JSON.stringify(info, null, 2));
      } else {
        console.log('');
        Object.entries(info).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
        console.log('');
      }
    } catch (error) {
      if (error.message === 'Cancelled by user') {
        process.exit(0);
      }
      logger.error(`Could not get device info: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('interactive')
  .description('Start interactive mode')
  .action(async () => {
    console.log(chalk.blue('='.repeat(60)));
    console.log(chalk.blue('    Klvr Charger Pro Tools'));
    console.log(chalk.blue('='.repeat(60)));

    const saved = await loadActiveTarget();
    if (saved) {
      console.log(chalk.gray(`  Saved target: ${saved}`));
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Update Firmware (Both Boards)', value: 'firmware' },
          { name: 'Update Rear Board Only', value: 'firmware-rear' },
          { name: 'Start Remote Support Session (customer)', value: 'remote' },
          { name: 'Connect to Tunnel / IP (supporter)', value: 'use-target' },
          { name: 'Device Info', value: 'info' },
          { name: 'Exit', value: 'exit' }
        ]
      }
    ]);

    switch (action) {
      case 'firmware':
        await program.parseAsync(['node', 'klvr-tool', 'firmware-update'], { from: 'user' });
        break;
      case 'firmware-rear':
        await program.parseAsync(['node', 'klvr-tool', 'firmware-update', '--rear-only'], { from: 'user' });
        break;
      case 'remote':
        await program.parseAsync(['node', 'klvr-tool', 'remote-support'], { from: 'user' });
        break;
      case 'use-target': {
        const { url } = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: 'IP or tunnel URL:'
          }
        ]);
        await program.parseAsync(['node', 'klvr-tool', 'use-target', url.trim()], { from: 'user' });
        break;
      }
      case 'info':
        await program.parseAsync(['node', 'klvr-tool', 'device-info'], { from: 'user' });
        break;
      case 'exit':
        console.log('Goodbye!');
        process.exit(0);
        break;
    }
  });

if (require.main === module) {
  if (process.argv.length === 2) {
    program.parseAsync(['node', 'klvr-tool', 'interactive'], { from: 'user' });
  } else {
    program.parse();
  }
}

module.exports = program;
