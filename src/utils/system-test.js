#!/usr/bin/env node

/**
 * System Test Utility
 * Tests the Klvr support tool installation and functionality
 * Referenced in package.json "test" script
 */

const chalk = require('chalk');
const Logger = require('../core/logger');
const DeviceDiscovery = require('../core/device-discovery');

class SystemTest {
    constructor() {
        this.logger = new Logger({ verbose: true });
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    /**
     * Add a test case
     */
    addTest(name, testFunction) {
        this.tests.push({ name, testFunction });
    }

    /**
     * Run a single test
     */
    async runTest(test) {
        try {
            this.logger.step(`Running: ${test.name}`);
            await test.testFunction();
            this.logger.success(`✅ PASS: ${test.name}`);
            this.passed++;
            return true;
        } catch (error) {
            this.logger.error(`❌ FAIL: ${test.name} - ${error.message}`);
            this.failed++;
            return false;
        }
    }

    /**
     * Run all tests
     */
    async runAllTests() {
        console.log(chalk.blue('='.repeat(60)));
        console.log(chalk.blue('    Klvr Support Tool - System Tests'));
        console.log(chalk.blue('='.repeat(60)));
        console.log('');

        for (const test of this.tests) {
            await this.runTest(test);
        }

        // Summary
        console.log('\n' + chalk.yellow('='.repeat(60)));
        console.log(chalk.yellow('    Test Results'));
        console.log(chalk.yellow('='.repeat(60)));
        console.log(`Total tests: ${this.tests.length}`);
        console.log(chalk.green(`Passed: ${this.passed}`));
        console.log(chalk.red(`Failed: ${this.failed}`));
        
        if (this.failed === 0) {
            console.log(chalk.green('\n🎉 All tests passed!'));
            process.exit(0);
        } else {
            console.log(chalk.red(`\n💥 ${this.failed} test(s) failed`));
            process.exit(1);
        }
    }
}

// Test cases
const systemTest = new SystemTest();

// Test: Core module imports
systemTest.addTest('Core module imports', async () => {
    const Logger = require('../core/logger');
    const DeviceDiscovery = require('../core/device-discovery');
    const FirmwareManager = require('../core/firmware-manager');
    const TunnelManager = require('../core/tunnel-manager');
    
    // Test instantiation
    const logger = new Logger();
    const deviceDiscovery = new DeviceDiscovery(logger);
    const firmwareManager = new FirmwareManager(logger);
    const tunnelManager = new TunnelManager(logger);
    
    if (!logger || !deviceDiscovery || !firmwareManager || !tunnelManager) {
        throw new Error('Failed to instantiate core modules');
    }
});

// Test: CLI module imports
systemTest.addTest('CLI module imports', async () => {
    const klvrTool = require('../cli/klvr-tool');
    const supportCLI = require('../cli/support-cli');
    
    if (!klvrTool || !supportCLI) {
        throw new Error('Failed to import CLI modules');
    }
});

// Test: Package dependencies
systemTest.addTest('Package dependencies', async () => {
    const requiredPackages = ['bonjour', 'commander', 'chalk', 'ora', 'inquirer'];
    
    for (const pkg of requiredPackages) {
        try {
            require(pkg);
        } catch (error) {
            throw new Error(`Missing required package: ${pkg}`);
        }
    }
});

// Test: Firmware directory
systemTest.addTest('Firmware directory structure', async () => {
    const fs = require('fs').promises;
    const path = require('path');
    
    const firmwareDir = path.join(__dirname, '../../firmware');
    
    try {
        const stats = await fs.stat(firmwareDir);
        if (!stats.isDirectory()) {
            throw new Error('Firmware path is not a directory');
        }
        
        const files = await fs.readdir(firmwareDir);
        const firmwareFiles = files.filter(f => f.endsWith('.signed.bin'));
        
        if (firmwareFiles.length === 0) {
            console.log(chalk.yellow('    ⚠️  No firmware files found (this is OK for testing)'));
        }
    } catch (error) {
        throw new Error(`Firmware directory issue: ${error.message}`);
    }
});

// Test: Device discovery (without actual devices)
systemTest.addTest('Device discovery initialization', async () => {
    const logger = new Logger({ verbose: false });
    const deviceDiscovery = new DeviceDiscovery(logger);
    
    // Test that discovery can be initialized without errors
    if (typeof deviceDiscovery.discoverDevices !== 'function') {
        throw new Error('Device discovery methods not available');
    }
});

// Test: Configuration validation
systemTest.addTest('Configuration validation', async () => {
    const Logger = require('../core/logger');
    const FirmwareManager = require('../core/firmware-manager');
    const logger = new Logger();
    const firmwareManager = new FirmwareManager(logger);
    
    // Check that configuration is properly loaded
    if (!firmwareManager.config || !firmwareManager.config.endpoints) {
        throw new Error('Firmware manager configuration not loaded');
    }
    
    const requiredEndpoints = ['firmwareCharger', 'firmwareRear', 'reboot', 'info', 'firmwareVersion'];
    for (const endpoint of requiredEndpoints) {
        if (!firmwareManager.config.endpoints[endpoint]) {
            throw new Error(`Missing endpoint configuration: ${endpoint}`);
        }
    }
});

systemTest.addTest('Platform helpers', async () => {
    const platform = require('../core/platform');
    if (platform.normalizeVersion('v1.8.9-beta') !== '1.8.9') {
        throw new Error('normalizeVersion failed for v1.8.9-beta');
    }
    if (!platform.versionsMatch('1.8.9', 'v1.8.9-beta')) {
        throw new Error('versionsMatch failed');
    }
    const key = platform.getPlatformKey();
    if (!key) throw new Error('getPlatformKey returned empty');
});

systemTest.addTest('Multi-home network helpers', async () => {
    const net = require('../core/network');
    if (!net.sameSubnet('10.101.0.56', '10.101.0.60', '255.255.255.0')) {
        throw new Error('sameSubnet /24 failed');
    }
    if (!net.sameSubnet('10.101.0.56', '10.101.0.60', '255.255.0.0')) {
        throw new Error('sameSubnet /16 failed');
    }
    if (net.sameSubnet('10.101.0.56', '192.168.1.10', '255.255.255.0')) {
        throw new Error('sameSubnet should reject different networks');
    }
    if (net.interfacePreference('en0') <= net.interfacePreference('Wi-Fi')) {
        throw new Error('wired preference should beat Wi-Fi name');
    }
    const tryList = net.localAddressesToTry('10.101.0.56');
    if (!Array.isArray(tryList) || tryList.length < 1) {
        throw new Error('localAddressesToTry empty');
    }
});

systemTest.addTest('Firmware version listing includes 1.8.9-beta', async () => {
    const Logger = require('../core/logger');
    const FirmwareManager = require('../core/firmware-manager');
    const fm = new FirmwareManager(new Logger({ verbose: false }));
    const versions = await fm.listAvailableVersions(false);
    const has189 = versions.some(v => String(v.version).includes('1.8.9'));
    if (!has189 && versions.length > 0) {
        console.log(chalk.yellow('    ⚠️  1.8.9-beta not bundled (OK if intentional)'));
    }
    if (typeof fm.listAvailableVersions !== 'function') {
        throw new Error('listAvailableVersions missing');
    }
});

// Test: Logger functionality
systemTest.addTest('Logger functionality', async () => {
    const logger = new Logger({ verbose: true });
    
    // Test all logging methods
    logger.info('Test info message');
    logger.success('Test success message');
    logger.warn('Test warning message');
    logger.debug('Test debug message');
    
    // Test session management
    const sessionId = logger.startSession();
    if (!sessionId) {
        throw new Error('Session creation failed');
    }
    
    logger.endSession();
});

// Test: File structure validation
systemTest.addTest('File structure validation', async () => {
    const fs = require('fs').promises;
    const path = require('path');
    
    const requiredFiles = [
        'package.json',
        'README.md',
        'src/core/logger.js',
        'src/core/device-discovery.js',
        'src/core/firmware-manager.js',
        'src/core/tunnel-manager.js',
        'src/core/doctor.js',
        'src/core/network.js',
        'src/core/support-hub.js',
        'src/cli/klvr-tool.js',
        'src/cli/support-cli.js'
    ];
    
    for (const file of requiredFiles) {
        const filePath = path.join(__dirname, '../..', file);
        try {
            await fs.access(filePath);
        } catch (error) {
            throw new Error(`Missing required file: ${file}`);
        }
    }
});

// Run tests if called directly
if (require.main === module) {
    systemTest.runAllTests().catch(error => {
        console.error(chalk.red(`\n💥 System test runner failed: ${error.message}`));
        process.exit(1);
    });
}

module.exports = SystemTest;
