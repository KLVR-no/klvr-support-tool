#!/usr/bin/env node

/**
 * System Test Utility
 * Tests the KLVR support tool installation and functionality
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
        console.log(chalk.blue('    KLVR Support Tool - System Tests'));
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
    
    const requiredEndpoints = ['firmwareCharger', 'firmwareRear', 'reboot', 'info'];
    for (const endpoint of requiredEndpoints) {
        if (!firmwareManager.config.endpoints[endpoint]) {
            throw new Error(`Missing endpoint configuration: ${endpoint}`);
        }
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
