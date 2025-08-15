#!/usr/bin/env node

/**
 * Post-installation script
 * Runs after npm install to setup the KLVR support tool
 * Referenced in package.json "install" script
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class PostInstaller {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Main installation routine
     */
    async install() {
        console.log(chalk.blue('='.repeat(60)));
        console.log(chalk.blue('    KLVR Support Tool - Post Installation'));
        console.log(chalk.blue('='.repeat(60)));
        console.log('');

        try {
            await this.checkEnvironment();
            await this.setupDirectories();
            await this.validateInstallation();
            await this.showCompletionMessage();
        } catch (error) {
            console.error(chalk.red(`\n💥 Installation failed: ${error.message}`));
            process.exit(1);
        }
    }

    /**
     * Check system environment
     */
    async checkEnvironment() {
        console.log(chalk.cyan('🔍 Checking system environment...'));

        // Check Node.js version
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
        
        if (majorVersion < 14) {
            this.errors.push(`Node.js version ${nodeVersion} is not supported. Please upgrade to Node.js 14 or higher.`);
        } else {
            console.log(chalk.green(`   ✅ Node.js ${nodeVersion} is supported`));
        }

        // Check for Python (for battery monitor)
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec('python3 --version', (error, stdout) => {
                    if (error) {
                        this.warnings.push('Python3 not found. Battery monitoring will not be available.');
                        console.log(chalk.yellow(`   ⚠️  Python3 not found (battery monitoring disabled)`));
                    } else {
                        console.log(chalk.green(`   ✅ ${stdout.trim()} found`));
                    }
                    resolve();
                });
            });
        } catch (error) {
            this.warnings.push('Could not check Python installation');
        }

        // Check for git
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec('git --version', (error, stdout) => {
                    if (error) {
                        this.warnings.push('Git not found. Some features may be limited.');
                        console.log(chalk.yellow(`   ⚠️  Git not found`));
                    } else {
                        console.log(chalk.green(`   ✅ ${stdout.trim()} found`));
                    }
                    resolve();
                });
            });
        } catch (error) {
            // Git not critical for core functionality
        }

        if (this.errors.length > 0) {
            throw new Error(`Environment check failed:\n${this.errors.map(e => `  • ${e}`).join('\n')}`);
        }
    }

    /**
     * Setup required directories
     */
    async setupDirectories() {
        console.log(chalk.cyan('\n📁 Setting up directories...'));

        const directories = [
            'logs',
            'src/core',
            'src/cli',
            'src/utils',
            'scripts',
            'tools',
            'firmware'
        ];

        for (const dir of directories) {
            try {
                await fs.mkdir(dir, { recursive: true });
                console.log(chalk.green(`   ✅ ${dir}/`));
            } catch (error) {
                console.log(chalk.yellow(`   ⚠️  Could not create ${dir}/: ${error.message}`));
            }
        }
    }

    /**
     * Validate installation
     */
    async validateInstallation() {
        console.log(chalk.cyan('\n🔍 Validating installation...'));

        // Check package.json
        try {
            const packagePath = path.join(__dirname, '..', 'package.json');
            const packageData = await fs.readFile(packagePath, 'utf8');
            const pkg = JSON.parse(packageData);
            
            console.log(chalk.green(`   ✅ Package: ${pkg.name} v${pkg.version}`));
        } catch (error) {
            this.errors.push('Could not read package.json');
        }

        // Check core modules
        const coreModules = [
            'src/core/logger.js',
            'src/core/device-discovery.js',
            'src/core/firmware-manager.js',
            'src/core/tunnel-manager.js'
        ];

        for (const module of coreModules) {
            try {
                await fs.access(module);
                console.log(chalk.green(`   ✅ ${module}`));
            } catch (error) {
                this.errors.push(`Missing core module: ${module}`);
            }
        }

        // Check CLI modules
        const cliModules = [
            'src/cli/klvr-tool.js',
            'src/cli/end-user-cli.js',
            'src/cli/support-cli.js'
        ];

        for (const module of cliModules) {
            try {
                await fs.access(module);
                console.log(chalk.green(`   ✅ ${module}`));
            } catch (error) {
                this.errors.push(`Missing CLI module: ${module}`);
            }
        }

        // Test module imports
        try {
            const Logger = require('../src/core/logger');
            const logger = new Logger();
            console.log(chalk.green(`   ✅ Module imports working`));
        } catch (error) {
            this.errors.push(`Module import failed: ${error.message}`);
        }

        if (this.errors.length > 0) {
            throw new Error(`Validation failed:\n${this.errors.map(e => `  • ${e}`).join('\n')}`);
        }
    }

    /**
     * Show completion message
     */
    async showCompletionMessage() {
        console.log('\n' + chalk.green('='.repeat(60)));
        console.log(chalk.green('    INSTALLATION COMPLETED SUCCESSFULLY! 🎉'));
        console.log(chalk.green('='.repeat(60)));
        console.log('');
        
        console.log(chalk.cyan('📋 Available Commands:'));
        console.log('   npm start              - Start end-user interface');
        console.log('   npm run support        - Start support engineer interface');
        console.log('   npm run firmware-update - Quick firmware update');
        console.log('   npm run remote-support  - Start remote support session');
        console.log('   npm run battery-monitor - Monitor battery detection');
        console.log('   npm test               - Run system tests');
        console.log('');
        
        console.log(chalk.cyan('🚀 Quick Start:'));
        console.log('   klvr-tool              - Interactive mode (if globally installed)');
        console.log('   node src/cli/klvr-tool.js - Direct execution');
        console.log('');

        if (this.warnings.length > 0) {
            console.log(chalk.yellow('⚠️  Warnings:'));
            this.warnings.forEach(warning => {
                console.log(chalk.yellow(`   • ${warning}`));
            });
            console.log('');
        }

        console.log(chalk.blue('📖 Documentation: README.md'));
        console.log(chalk.blue('🐛 Issues: https://github.com/KLVR-no/klvr-support-tool/issues'));
        console.log(chalk.green('='.repeat(60)));
    }
}

// Run if called directly
if (require.main === module) {
    const installer = new PostInstaller();
    installer.install().catch(error => {
        console.error(chalk.red(`\n💥 Post-installation failed: ${error.message}`));
        process.exit(1);
    });
}

module.exports = PostInstaller;
