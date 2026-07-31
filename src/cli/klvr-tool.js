#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const path = require('path');
const { spawn } = require('child_process');

const DeviceDiscovery = require('../core/device-discovery');
const FirmwareManager = require('../core/firmware-manager');
const TunnelManager = require('../core/tunnel-manager');
const Doctor = require('../core/doctor');
const SupportHub = require('../core/support-hub');
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
  // Keep -V for tool version; --version is reserved for firmware-update target FW.
  .version('2.4.0', '-V, --klvr-tool-version', 'output the support-tool version');

program
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--log-file <path>', 'Save logs to file')
  .option('--session-id <id>', 'Session ID for support tracking');

function isTunnelUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim());
}

/**
 * @param {'local'|'support'|'auto'} mode
 *   local  — customer: ignore saved tunnels; LAN discover/IP only
 *   support — Klvr: prefer saved tunnel; prompt for tunnel if none
 *   auto   — use any saved target; else local discover
 */
async function resolveDevice(target, logger, deviceDiscovery, mode = 'auto') {
  if (target) {
    if (mode === 'local' && isTunnelUrl(target)) {
      throw new Error('Local update cannot use a tunnel URL. Use "Connect to Customer Tunnel" (supporter) instead.');
    }
    const device = await deviceDiscovery.connectToTarget(target);
    await saveActiveTarget(target);
    return device;
  }

  const saved = await loadActiveTarget();
  if (saved) {
    if (mode === 'local' && isTunnelUrl(saved)) {
      logger.info('Ignoring saved remote tunnel for local customer update.');
    } else {
      logger.info(`Using saved target: ${saved}`);
      try {
        return await deviceDiscovery.connectToTarget(saved);
      } catch (err) {
        logger.warn(`Saved target unreachable (${err.message}); clearing and rediscovering.`);
        await clearActiveTarget();
      }
    }
  }

  if (mode === 'support') {
    return deviceDiscovery.discoverAndSelect({ mode: 'support' });
  }

  return deviceDiscovery.discoverAndSelect({ mode: 'local' });
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
  .description('Update firmware on Klvr device (LAN for customers; tunnel URL for support)')
  .option('-f, --firmware-dir <path>', 'Firmware directory path')
  .option('--main <file>', 'Specific main firmware file')
  .option('--rear <file>', 'Specific rear firmware file')
  .option('--version <version>', 'Firmware version to install (e.g. 1.8.92-beta or v1.8.92-beta)')
  .option('--rear-only', 'Update only the rear board firmware')
  .option('--force', 'Force update even if same version')
  .option('--local', 'Customer local update: LAN only (no Cloudflare tunnel)')
  .option('--remote', 'Supporter remote update: use saved/pasted tunnel URL')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (target, options) => {
    const logger = new Logger({ ...program.opts(), ...options });
    logger.info('Starting firmware update...');

    try {
      const firmwareManager = new FirmwareManager(logger);
      const deviceDiscovery = new DeviceDiscovery(logger);
      const mode = options.local
        ? 'local'
        : ((options.remote || isTunnelUrl(target)) ? 'support' : 'auto');
      const device = await resolveDevice(target, logger, deviceDiscovery, mode);

      if (device.isSupportHub && device.hubReady === false) {
        logger.error('Support hub is connected, but no charger is reachable on the customer network yet.');
        logger.info('Run: klvr-tool diagnose  (pulls customer network diagnostics)');
        logger.info('Ask customer to check cable / Wi‑Fi / static IP, then retry firmware-update.');
        process.exit(1);
      }

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
  .description('Customer: one remote support entry (diagnostics + discovery + charger tunnel)')
  .option('--tunnel-provider <provider>', 'Tunnel provider: cloudflare', 'cloudflare')
  .option('--ip <address>', 'Optional charger IP hint for diagnostics/discovery')
  .action(async (options) => {
    const logger = new Logger(program.opts());
    logger.info('Starting remote support session (works even if charger is not found yet)...');

    try {
      const hintIps = options.ip
        ? String(options.ip).split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const hub = new SupportHub(logger, { hintIps });
      const local = await hub.start();
      logger.success(`Support hub listening on ${local.url}`);

      const tunnelManager = new TunnelManager(logger);
      const tunnel = await tunnelManager.createTunnel({
        url: local.url,
        deviceName: 'klvr-support-hub',
        ip: 'hub'
      }, { ...options, reuseSession: false });

      console.log('');
      logger.success('Remote support session active!');
      console.log('');
      console.log(chalk.green('  Share this ONE URL with Klvr support:'));
      console.log(chalk.bold.white(`  ${tunnel.url}`));
      console.log('');
      console.log(chalk.gray('  Support can diagnose your network, find the charger, and update firmware.'));
      console.log('');
      console.log(chalk.cyan('  Support commands:'));
      console.log(`    klvr-tool diagnose ${tunnel.url}`);
      console.log(`    klvr-tool use-target ${tunnel.url}`);
      console.log('    klvr-tool firmware-update --remote --version 1.8.92-beta -y');
      console.log('');
      console.log(chalk.yellow('  Keep this terminal open. Press Ctrl+C to end the session.'));
      console.log('');

      // Local snapshot for the customer terminal
      try {
        const status = hub.getStatus();
        if (status.charger) {
          logger.success(`Charger already found: ${status.charger.deviceName} @ ${status.charger.ip}`);
        } else {
          logger.warn('No charger found yet — that is OK. Support can still see your network diagnostics.');
        }
      } catch (_) {
        // ignore
      }

      process.on('SIGINT', async () => {
        logger.info('Ending remote support session...');
        await tunnelManager.closeTunnel(tunnel);
        await hub.stop();
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
  .command('doctor')
  .description('Check local network interfaces + optional charger IP reachability')
  .option('--ip <address>', 'Charger IP to ping/probe (repeatable via comma list)')
  .option('--json', 'Print JSON instead of text')
  .action(async (options) => {
    const logger = new Logger(program.opts());
    const doctor = new Doctor(logger);
    let targets = [];
    if (options.ip) {
      targets = String(options.ip).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      const { ip } = await inquirer.prompt([
        {
          type: 'input',
          name: 'ip',
          message: 'Charger IP to test (blank to skip ping/HTTP):',
          default: ''
        }
      ]);
      if (ip && ip.trim()) targets = [ip.trim()];
    }

    const report = await doctor.run({ targets });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('');
      console.log(doctor.formatText(report));
    }
  });

program
  .command('remote-doctor')
  .description('Alias of remote-support (kept for compatibility)')
  .option('--ip <address>', 'Optional charger IP hint')
  .action(async (options) => {
    const args = ['remote-support'];
    if (options.ip) args.push('--ip', options.ip);
    await program.parseAsync(args, { from: 'user' });
  });

program
  .command('diagnose [target]')
  .description('Supporter: fetch hub diagnostics / discover charger from customer tunnel')
  .action(async (target) => {
    const logger = new Logger(program.opts());
    const doctor = new Doctor(logger);
    const discovery = new DeviceDiscovery(logger);

    let url = target;
    if (!url) {
      const saved = await loadActiveTarget();
      if (saved && isTunnelUrl(saved)) {
        url = saved;
        logger.info(`Using saved target: ${url}`);
      } else {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: 'Customer tunnel URL:',
            validate: (v) => (/^https:\/\//i.test((v || '').trim())
              ? true
              : 'Enter the full https:// tunnel URL')
          }
        ]);
        url = answers.url.trim();
      }
    }

    const base = url.replace(/\/$/, '');

    try {
      // Prefer support hub
      try {
        const statusRaw = await discovery._httpGetRaw(`${base}/api/status`, 15000);
        const status = JSON.parse(statusRaw);
        if (status.kind === 'klvr-support-hub') {
          console.log('');
          console.log(chalk.cyan('Support hub status:'));
          console.log(`  Multi-homed: ${status.multiHomed ? 'YES' : 'no'}`);
          console.log(`  Firmware ready: ${status.readyForFirmware ? 'YES' : 'no'}`);
          if (status.charger) {
            console.log(`  Charger: ${status.charger.deviceName} @ ${status.charger.ip} via ${status.charger.localAddress || 'default'}`);
          } else {
            console.log('  Charger: not found yet');
          }
          console.log('');
          console.log('Interfaces:');
          for (const iface of status.interfaces || []) {
            console.log(`  ${iface.name}: ${iface.address}/${iface.cidr}`);
          }

          logger.info('Refreshing discovery on customer side...');
          try {
            const disc = JSON.parse(await discovery._httpGetRaw(`${base}/api/discover`, 30000));
            console.log('');
            console.log(`Discover: ${(disc.devices || []).length} device(s)`);
            for (const d of disc.devices || []) {
              console.log(`  • ${d.deviceName} @ ${d.ip}${d.localAddress ? ` via ${d.localAddress}` : ''}`);
            }
          } catch (err) {
            logger.warn(`Discover failed: ${err.message}`);
          }

          const diag = JSON.parse(await discovery._httpGetRaw(`${base}/api/diagnostics`, 45000));
          console.log('');
          console.log(doctor.formatText(diag));
          await saveActiveTarget(base);
          return;
        }
      } catch (_) {
        // not a hub — fall through
      }

      const result = await doctor.fetchRemote(base);
      console.log('');
      if (result.type === 'doctor') {
        console.log(doctor.formatText(result.report));
        await saveActiveTarget(base);
      } else {
        console.log(chalk.cyan('Direct charger tunnel:'));
        console.log(`  Device: ${result.info.deviceName || result.info.name || 'Klvr'}`);
        console.log(`  Info:   ${JSON.stringify(result.info, null, 2)}`);
      }
    } catch (error) {
      logger.error(`Diagnose failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('device-info [target]')
  .description('Get device information and status')
  .option('--format <format>', 'Output format: json, table', 'table')
  .option('--local', 'LAN only (ignore saved tunnel)')
  .option('--remote', 'Prefer saved / pasted tunnel URL')
  .action(async (target, options) => {
    const logger = new Logger(program.opts());
    try {
      const deviceDiscovery = new DeviceDiscovery(logger);
      const mode = options.local
        ? 'local'
        : ((options.remote || isTunnelUrl(target)) ? 'support' : 'auto');
      const device = await resolveDevice(target, logger, deviceDiscovery, mode);
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

    const choices = [
      new inquirer.Separator('── Customer ──'),
      { name: 'Update Firmware', value: 'firmware' },
      { name: 'Start Remote Support Session', value: 'remote' },
      new inquirer.Separator('── Klvr Support ──'),
      { name: 'Fetch Remote Diagnostics', value: 'diagnose' },
      { name: 'Connect to Customer Tunnel', value: 'use-target' },
      { name: 'Update Firmware on Connected Target', value: 'firmware-remote' },
      { name: 'Device Info', value: 'info' },
      { name: 'Exit', value: 'exit' }
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices
      }
    ]);

    switch (action) {
      case 'firmware':
        await program.parseAsync(['firmware-update', '--local'], { from: 'user' });
        break;
      case 'firmware-remote':
        await program.parseAsync(['firmware-update', '--remote'], { from: 'user' });
        break;
      case 'diagnose':
        await program.parseAsync(['diagnose'], { from: 'user' });
        break;
      case 'remote':
        await program.parseAsync(['remote-support'], { from: 'user' });
        break;
      case 'use-target': {
        const { url } = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: 'Paste customer tunnel URL:',
            validate: (v) => (/^https:\/\//i.test((v || '').trim())
              ? true
              : 'Enter the full https://….trycloudflare.com URL from the customer')
          }
        ]);
        await program.parseAsync(['use-target', url.trim()], { from: 'user' });
        const { next } = await inquirer.prompt([
          {
            type: 'list',
            name: 'next',
            message: 'Next step:',
            choices: [
              { name: 'Fetch diagnostics / discover charger', value: 'diagnose' },
              { name: 'Update firmware', value: 'firmware' },
              { name: 'Device info', value: 'info' },
              { name: 'Done', value: 'done' }
            ]
          }
        ]);
        if (next === 'diagnose') {
          await program.parseAsync(['diagnose'], { from: 'user' });
        } else if (next === 'firmware') {
          await program.parseAsync(['firmware-update', '--remote'], { from: 'user' });
        } else if (next === 'info') {
          await program.parseAsync(['device-info', '--remote'], { from: 'user' });
        }
        break;
      }
      case 'info':
        await program.parseAsync(['device-info'], { from: 'user' });
        break;
      case 'exit':
        console.log('Goodbye!');
        process.exit(0);
        break;
    }
  });

if (require.main === module) {
  if (process.argv.length === 2) {
    program.parseAsync(['interactive'], { from: 'user' });
  } else {
    program.parse();
  }
}

module.exports = program;
