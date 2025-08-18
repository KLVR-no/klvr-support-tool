const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * Tunnel Manager
 * Handles creation and management of secure tunnels for remote support
 * Extracted and refactored from existing remote-support.js logic
 */
class TunnelManager {
    constructor(logger) {
        this.logger = logger;
        this.activeTunnels = new Map();
        this.cloudflaredConfig = {
            downloadUrls: {
                'darwin-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
                'darwin-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz',
                'linux-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
                'linux-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
                'win32-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
            }
        };
    }

    /**
     * Create a tunnel to a device
     */
    async createTunnel(device, options = {}) {
        const provider = options.tunnelProvider || 'cloudflare';
        
        if (provider === 'cloudflare') {
            // Check if we should use persistent tunnel
            if (options.persistent || options.customDomain) {
                return await this._createPersistentTunnel(device, options);
            } else {
                return await this._createCloudflaredTunnel(device, options);
            }
        } else {
            throw new Error(`Unsupported tunnel provider: ${provider}`);
        }
    }

    /**
     * Close a tunnel
     */
    async closeTunnel(tunnel) {
        try {
            if (tunnel.process && !tunnel.process.killed) {
                tunnel.process.kill();
                this.logger.info('Tunnel process terminated');
            }
            
            if (this.activeTunnels.has(tunnel.id)) {
                this.activeTunnels.delete(tunnel.id);
            }
            
            return true;
        } catch (error) {
            this.logger.warn(`Error closing tunnel: ${error.message}`);
            return false;
        }
    }

    /**
     * Create persistent Cloudflare tunnel with consistent URL
     */
    async _createPersistentTunnel(device, options = {}) {
        // Check if cloudflared is installed
        const hasCloudflared = await this._checkCloudflaredInstalled();
        if (!hasCloudflared) {
            this.logger.step('Installing cloudflared...');
            await this._installCloudflared();
        }

        const targetUrl = device.url || `http://${device.ip}:8000`;
        
        // Generate consistent tunnel name based on device
        const tunnelName = options.customDomain || 
            `klvr-${device.deviceName?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'device'}-${device.ip?.replace(/\./g, '-') || 'local'}`;
        
        this.logger.step(`Creating persistent tunnel: ${tunnelName}`);
        this.logger.debug(`Target URL: ${targetUrl}`);

        try {
            // First, try to create/get the tunnel
            await this._ensureTunnelExists(tunnelName);
            
            // Then run the tunnel
            return await this._runPersistentTunnel(tunnelName, targetUrl, device);
            
        } catch (error) {
            this.logger.warn(`Persistent tunnel failed, falling back to quick tunnel: ${error.message}`);
            return await this._createCloudflaredTunnel(device, options);
        }
    }

    /**
     * Ensure tunnel exists in Cloudflare
     */
    async _ensureTunnelExists(tunnelName) {
        this.logger.debug(`Checking if tunnel ${tunnelName} exists...`);
        
        try {
            // Try to create the tunnel (will fail if it already exists, which is fine)
            await this._execAsync(`cloudflared tunnel create ${tunnelName}`);
            this.logger.debug(`Created new tunnel: ${tunnelName}`);
        } catch (error) {
            // Tunnel might already exist, check if we can list it
            try {
                const result = await this._execAsync(`cloudflared tunnel list`);
                if (result.includes(tunnelName)) {
                    this.logger.debug(`Using existing tunnel: ${tunnelName}`);
                } else {
                    throw new Error(`Tunnel ${tunnelName} not found and could not be created`);
                }
            } catch (listError) {
                throw new Error(`Failed to verify tunnel existence: ${listError.message}`);
            }
        }
    }

    /**
     * Run persistent tunnel
     */
    async _runPersistentTunnel(tunnelName, targetUrl, device) {
        return new Promise((resolve, reject) => {
            this.logger.step(`Starting persistent tunnel: ${tunnelName}`);
            
            const tunnelProcess = spawn('cloudflared', [
                'tunnel',
                '--name', tunnelName,
                '--url', targetUrl,
                'run',
                tunnelName
            ]);

            let tunnelUrl = null;
            let startupComplete = false;
            const tunnelId = `persistent-${tunnelName}`;

            tunnelProcess.stdout.on('data', (data) => {
                const output = data.toString();
                this.logger.debug(`[PERSISTENT-TUNNEL] ${output.trim()}`);

                // Look for the tunnel URL - persistent tunnels show different format
                const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) ||
                                output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.cloudflareaccess\.com/);
                
                if (urlMatch && !tunnelUrl) {
                    tunnelUrl = urlMatch[0];
                    startupComplete = true;
                    
                    const tunnel = {
                        id: tunnelId,
                        name: tunnelName,
                        url: tunnelUrl,
                        process: tunnelProcess,
                        device: device,
                        provider: 'cloudflare',
                        persistent: true
                    };
                    
                    this.activeTunnels.set(tunnelId, tunnel);
                    resolve(tunnel);
                }
            });

            tunnelProcess.stderr.on('data', (data) => {
                const output = data.toString();
                this.logger.debug(`[PERSISTENT-TUNNEL] ${output.trim()}`);

                // Also check stderr for URL
                const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) ||
                                output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.cloudflareaccess\.com/);
                
                if (urlMatch && !tunnelUrl) {
                    tunnelUrl = urlMatch[0];
                    startupComplete = true;
                    
                    const tunnel = {
                        id: tunnelId,
                        name: tunnelName,
                        url: tunnelUrl,
                        process: tunnelProcess,
                        device: device,
                        provider: 'cloudflare',
                        persistent: true
                    };
                    
                    this.activeTunnels.set(tunnelId, tunnel);
                    resolve(tunnel);
                }
            });

            tunnelProcess.on('close', (code) => {
                if (!startupComplete) {
                    reject(new Error(`Persistent tunnel process exited with code ${code}`));
                }
            });

            tunnelProcess.on('error', (error) => {
                if (!startupComplete) {
                    reject(new Error(`Failed to start persistent tunnel: ${error.message}`));
                }
            });

            // Timeout after 45 seconds (persistent tunnels take longer)
            setTimeout(() => {
                if (!startupComplete) {
                    tunnelProcess.kill();
                    reject(new Error('Timeout waiting for persistent tunnel to start'));
                }
            }, 45000);
        });
    }

    /**
     * Create Cloudflare quick tunnel (original implementation)
     */
    async _createCloudflaredTunnel(device, options = {}) {
        // Check if cloudflared is installed
        const hasCloudflared = await this._checkCloudflaredInstalled();
        if (!hasCloudflared) {
            this.logger.step('Installing cloudflared...');
            await this._installCloudflared();
        }

        const targetUrl = device.url || `http://${device.ip}:8000`;
        this.logger.step(`Creating tunnel to ${targetUrl}...`);

        return new Promise((resolve, reject) => {
            const tunnelProcess = spawn('cloudflared', [
                'tunnel',
                '--url', targetUrl,
                '--no-autoupdate'
            ]);

            let tunnelUrl = null;
            let startupComplete = false;
            const tunnelId = `tunnel-${Date.now()}`;

            tunnelProcess.stdout.on('data', (data) => {
                const output = data.toString();
                this.logger.debug(`[TUNNEL] ${output.trim()}`);

                // Look for the tunnel URL
                const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (urlMatch && !tunnelUrl) {
                    tunnelUrl = urlMatch[0];
                    startupComplete = true;
                    
                    const tunnel = {
                        id: tunnelId,
                        url: tunnelUrl,
                        process: tunnelProcess,
                        device: device,
                        provider: 'cloudflare'
                    };
                    
                    this.activeTunnels.set(tunnelId, tunnel);
                    resolve(tunnel);
                }
            });

            tunnelProcess.stderr.on('data', (data) => {
                const output = data.toString();
                this.logger.debug(`[TUNNEL] ${output.trim()}`);

                // Also check stderr for URL (cloudflared sometimes logs there)
                const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (urlMatch && !tunnelUrl) {
                    tunnelUrl = urlMatch[0];
                    startupComplete = true;
                    
                    const tunnel = {
                        id: tunnelId,
                        url: tunnelUrl,
                        process: tunnelProcess,
                        device: device,
                        provider: 'cloudflare'
                    };
                    
                    this.activeTunnels.set(tunnelId, tunnel);
                    resolve(tunnel);
                }
            });

            tunnelProcess.on('close', (code) => {
                if (!startupComplete) {
                    reject(new Error(`Tunnel process exited with code ${code}`));
                }
            });

            tunnelProcess.on('error', (error) => {
                if (!startupComplete) {
                    reject(new Error(`Failed to start tunnel: ${error.message}`));
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!startupComplete) {
                    tunnelProcess.kill();
                    reject(new Error('Timeout waiting for tunnel to start'));
                }
            }, 30000);
        });
    }

    /**
     * Check if cloudflared is installed
     */
    async _checkCloudflaredInstalled() {
        return new Promise((resolve) => {
            exec('cloudflared --version', (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Install cloudflared
     */
    async _installCloudflared() {
        this.logger.step('Installing cloudflared...');
        
        try {
            const platform = this._getPlatform();
            const downloadUrl = this.cloudflaredConfig.downloadUrls[platform];
            
            if (!downloadUrl) {
                throw new Error(`No cloudflared binary available for ${platform}`);
            }
            
            this.logger.debug(`Downloading for ${platform}...`);
            
            // Create a temporary directory
            const tempDir = '/tmp/cloudflared-install';
            await fs.mkdir(tempDir, { recursive: true });
            
            // Download and install based on platform
            if (platform.startsWith('darwin')) {
                await this._installCloudflaredMacOS(downloadUrl, tempDir);
            } else if (platform.startsWith('linux')) {
                await this._installCloudflaredLinux(downloadUrl, tempDir);
            } else {
                throw new Error(`Unsupported platform: ${platform}`);
            }
            
            // Cleanup
            await fs.rm(tempDir, { recursive: true, force: true });
            
            this.logger.success('cloudflared installed successfully');
            
        } catch (error) {
            this.logger.error(`Failed to install cloudflared: ${error.message}`);
            this.logger.info('Please install cloudflared manually:');
            this.logger.info('  macOS: brew install cloudflared');
            this.logger.info('  Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
            throw error;
        }
    }

    /**
     * Install cloudflared on macOS
     */
    async _installCloudflaredMacOS(downloadUrl, tempDir) {
        await this._execAsync(`curl -L -o ${tempDir}/cloudflared.tgz ${downloadUrl}`);
        await this._execAsync(`tar -xzf ${tempDir}/cloudflared.tgz -C ${tempDir}`);
        await this._execAsync(`sudo mv ${tempDir}/cloudflared /usr/local/bin/cloudflared`);
        await this._execAsync(`sudo chmod +x /usr/local/bin/cloudflared`);
    }

    /**
     * Install cloudflared on Linux
     */
    async _installCloudflaredLinux(downloadUrl, tempDir) {
        await this._execAsync(`curl -L -o ${tempDir}/cloudflared ${downloadUrl}`);
        await this._execAsync(`sudo mv ${tempDir}/cloudflared /usr/local/bin/cloudflared`);
        await this._execAsync(`sudo chmod +x /usr/local/bin/cloudflared`);
    }

    /**
     * Get platform identifier
     */
    _getPlatform() {
        const platform = process.platform;
        const arch = process.arch;
        
        if (platform === 'darwin') {
            return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        } else if (platform === 'linux') {
            return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
        } else if (platform === 'win32') {
            return 'win32-x64';
        }
        
        throw new Error(`Unsupported platform: ${platform}-${arch}`);
    }

    /**
     * Execute command asynchronously
     */
    async _execAsync(command) {
        return new Promise((resolve, reject) => {
            const process = spawn('bash', ['-c', command]);
            let stdout = '';
            let stderr = '';
            
            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${command}\nStderr: ${stderr}`));
                }
            });
            
            process.on('error', reject);
        });
    }

    /**
     * Get all active tunnels
     */
    getActiveTunnels() {
        return Array.from(this.activeTunnels.values());
    }

    /**
     * Close all active tunnels
     */
    async closeAllTunnels() {
        const tunnels = this.getActiveTunnels();
        const closePromises = tunnels.map(tunnel => this.closeTunnel(tunnel));
        
        await Promise.all(closePromises);
        this.logger.info(`Closed ${tunnels.length} tunnel(s)`);
    }
}

module.exports = TunnelManager;
