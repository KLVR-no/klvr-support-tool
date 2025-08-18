const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Tunnel Manager
 * Handles creation and management of secure tunnels for remote support
 * Extracted and refactored from existing remote-support.js logic
 */
class TunnelManager {
    constructor(logger) {
        this.logger = logger;
        this.activeTunnels = new Map();
        this.sessionDir = path.join(os.homedir(), '.klvr-support');
        this.sessionFile = path.join(this.sessionDir, 'tunnel-sessions.json');
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
            // Check for existing session first
            const existingSession = await this._getExistingSession(device);
            if (existingSession && options.reuseSession !== false) {
                this.logger.info('🔄 Found existing tunnel session');
                this.logger.success(`📋 Reusing tunnel URL: ${existingSession.url}`);
                this.logger.info('💡 This is the same URL as before - share it with support!');
                
                // Verify the tunnel is still working
                if (await this._verifyTunnelActive(existingSession.url)) {
                    return existingSession;
                } else {
                    this.logger.warn('⚠️  Previous tunnel appears inactive, creating new one...');
                    await this._removeSession(device);
                }
            }
            
            // Check if we should use persistent tunnel
            if (options.persistent || options.customDomain) {
                return await this._createPersistentTunnel(device, options);
            } else {
                const tunnel = await this._createCloudflaredTunnel(device, options);
                // Save session for reuse
                if (tunnel) {
                    await this._saveSession(device, tunnel);
                }
                return tunnel;
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
     * Get existing tunnel session for a device
     */
    async _getExistingSession(device) {
        try {
            await fs.mkdir(this.sessionDir, { recursive: true });
            const sessionData = await fs.readFile(this.sessionFile, 'utf8');
            const sessions = JSON.parse(sessionData);
            
            const deviceKey = this._getDeviceKey(device);
            const session = sessions[deviceKey];
            
            if (session && this._isSessionValid(session)) {
                return session;
            }
        } catch (error) {
            // File doesn't exist or is invalid, that's ok
        }
        return null;
    }

    /**
     * Save tunnel session for a device
     */
    async _saveSession(device, tunnel) {
        try {
            await fs.mkdir(this.sessionDir, { recursive: true });
            
            let sessions = {};
            try {
                const sessionData = await fs.readFile(this.sessionFile, 'utf8');
                sessions = JSON.parse(sessionData);
            } catch (error) {
                // File doesn't exist, start with empty sessions
            }
            
            const deviceKey = this._getDeviceKey(device);
            sessions[deviceKey] = {
                url: tunnel.url,
                deviceName: device.deviceName || device.name,
                deviceIP: device.ip,
                created: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
                tunnelId: tunnel.id
            };
            
            await fs.writeFile(this.sessionFile, JSON.stringify(sessions, null, 2));
            this.logger.debug(`Session saved for device: ${deviceKey}`);
        } catch (error) {
            this.logger.warn(`Failed to save session: ${error.message}`);
        }
    }

    /**
     * Remove session for a device
     */
    async _removeSession(device) {
        try {
            const sessionData = await fs.readFile(this.sessionFile, 'utf8');
            const sessions = JSON.parse(sessionData);
            
            const deviceKey = this._getDeviceKey(device);
            delete sessions[deviceKey];
            
            await fs.writeFile(this.sessionFile, JSON.stringify(sessions, null, 2));
            this.logger.debug(`Session removed for device: ${deviceKey}`);
        } catch (error) {
            // File doesn't exist or other error, that's ok
        }
    }

    /**
     * Generate a unique key for a device
     */
    _getDeviceKey(device) {
        // Use IP as primary identifier, fallback to name
        return device.ip || device.deviceName || device.name || 'unknown';
    }

    /**
     * Check if a session is still valid (not too old)
     */
    _isSessionValid(session) {
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const created = new Date(session.created);
        const now = new Date();
        return (now - created) < maxAge;
    }

    /**
     * Verify if a tunnel URL is still active
     */
    async _verifyTunnelActive(url) {
        try {
            // Try to make a simple request to the tunnel
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            await execAsync(`curl -s --max-time 5 "${url}/api/v2/device/info" > /dev/null`);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Create persistent Cloudflare tunnel with consistent URL
     * Uses a simpler approach that doesn't require authentication
     */
    async _createPersistentTunnel(device, options = {}) {
        this.logger.warn('⚠️  Persistent tunnels require Cloudflare account setup.');
        this.logger.info('📝 For now, using quick tunnel with session info for consistency.');
        this.logger.info('💡 Quick tunnels are still secure and work great for support sessions!');
        
        // For now, fall back to quick tunnel but add session tracking
        const tunnel = await this._createCloudflaredTunnel(device, options);
        
        // Add session info to help with consistency
        if (tunnel) {
            tunnel.sessionInfo = {
                deviceName: device.deviceName,
                deviceIP: device.ip,
                timestamp: new Date().toISOString(),
                persistent: false // Mark as not truly persistent
            };
            
            this.logger.info(`📋 Session Info: ${device.deviceName} at ${device.ip}`);
            this.logger.info('💾 Save this URL for this support session!');
        }
        
        return tunnel;
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
