const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// Import device discovery from main script
const { discoverKLVRDevices, testDeviceConnection } = require('./firmware-update.js');

// Configuration
const CLOUDFLARED_CONFIG = {
    DOWNLOAD_URLS: {
        'darwin-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
        'darwin-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz',
        'linux-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
        'linux-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
        'win32-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    }
};

// Helper function to create readline interface
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

// Helper function to prompt user for input
function promptUser(question) {
    const rl = createReadlineInterface();
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// Function to check if cloudflared is installed
async function checkCloudflaredInstalled() {
    return new Promise((resolve) => {
        exec('cloudflared --version', (error) => {
            resolve(!error);
        });
    });
}

// Function to get platform identifier
function getPlatform() {
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

// Function to install cloudflared
async function installCloudflared() {
    console.log('📦 Installing cloudflared...');
    
    try {
        const platform = getPlatform();
        const downloadUrl = CLOUDFLARED_CONFIG.DOWNLOAD_URLS[platform];
        
        if (!downloadUrl) {
            throw new Error(`No cloudflared binary available for ${platform}`);
        }
        
        console.log(`   Downloading for ${platform}...`);
        
        // Create a temporary directory
        const tempDir = '/tmp/cloudflared-install';
        await fs.mkdir(tempDir, { recursive: true });
        
        // Download and install based on platform
        if (platform.startsWith('darwin')) {
            // macOS - download and extract tar.gz
            await new Promise((resolve, reject) => {
                const curl = spawn('curl', ['-L', '-o', `${tempDir}/cloudflared.tgz`, downloadUrl]);
                curl.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Download failed with code ${code}`));
                });
            });
            
            // Extract
            await new Promise((resolve, reject) => {
                const tar = spawn('tar', ['-xzf', `${tempDir}/cloudflared.tgz`, '-C', tempDir]);
                tar.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Extraction failed with code ${code}`));
                });
            });
            
            // Move to /usr/local/bin
            await new Promise((resolve, reject) => {
                const mv = spawn('sudo', ['mv', `${tempDir}/cloudflared`, '/usr/local/bin/cloudflared']);
                mv.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Installation failed with code ${code}`));
                });
            });
            
            // Make executable
            await new Promise((resolve, reject) => {
                const chmod = spawn('sudo', ['chmod', '+x', '/usr/local/bin/cloudflared']);
                chmod.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`chmod failed with code ${code}`));
                });
            });
            
        } else if (platform.startsWith('linux')) {
            // Linux - download binary directly
            await new Promise((resolve, reject) => {
                const curl = spawn('curl', ['-L', '-o', `${tempDir}/cloudflared`, downloadUrl]);
                curl.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Download failed with code ${code}`));
                });
            });
            
            // Move to /usr/local/bin
            await new Promise((resolve, reject) => {
                const mv = spawn('sudo', ['mv', `${tempDir}/cloudflared`, '/usr/local/bin/cloudflared']);
                mv.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Installation failed with code ${code}`));
                });
            });
            
            // Make executable
            await new Promise((resolve, reject) => {
                const chmod = spawn('sudo', ['chmod', '+x', '/usr/local/bin/cloudflared']);
                chmod.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`chmod failed with code ${code}`));
                });
            });
        }
        
        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
        
        console.log('✅ cloudflared installed successfully');
        
    } catch (error) {
        console.error('❌ Failed to install cloudflared:', error.message);
        console.log('\nPlease install cloudflared manually:');
        console.log('  macOS: brew install cloudflared');
        console.log('  Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
        throw error;
    }
}

// Function to create tunnel
async function createTunnel(targetIp) {
    return new Promise((resolve, reject) => {
        console.log(`🌐 Creating tunnel to ${targetIp}:8000...`);
        
        const tunnelProcess = spawn('cloudflared', [
            'tunnel',
            '--url', `http://${targetIp}:8000`,
            '--no-autoupdate'
        ]);
        
        let tunnelUrl = null;
        let startupComplete = false;
        
        tunnelProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[TUNNEL] ${output.trim()}`);
            
            // Look for the tunnel URL
            const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !tunnelUrl) {
                tunnelUrl = urlMatch[0];
                startupComplete = true;
                resolve({ process: tunnelProcess, url: tunnelUrl });
            }
        });
        
        tunnelProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.log(`[TUNNEL] ${output.trim()}`);
            
            // Also check stderr for URL (cloudflared sometimes logs there)
            const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !tunnelUrl) {
                tunnelUrl = urlMatch[0];
                startupComplete = true;
                resolve({ process: tunnelProcess, url: tunnelUrl });
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

// Main remote support session function
async function startRemoteSupportSession() {
    console.log('='.repeat(60));
    console.log('    KLVR Remote Support Session');
    console.log('='.repeat(60));
    console.log('🌐 Setting up secure tunnel for remote access...');
    console.log('');
    
    try {
        // Check and install cloudflared if needed
        const hasCloudflared = await checkCloudflaredInstalled();
        if (!hasCloudflared) {
            console.log('⚠️  cloudflared not found - installing automatically...');
            await installCloudflared();
        } else {
            console.log('✅ cloudflared found');
        }
        
        // Discover or get target device
        console.log('\n🔍 Discovering KLVR devices...');
        const devices = await discoverKLVRDevices();
        
        let targetDevice = null;
        
        if (devices.length === 0) {
            console.log('❌ No KLVR devices found via auto-discovery');
            const manualIp = await promptUser('Enter device IP address manually: ');
            
            console.log(`🔗 Testing connection to ${manualIp}...`);
            const deviceInfo = await testDeviceConnection(manualIp);
            if (deviceInfo) {
                targetDevice = { ip: manualIp, deviceName: deviceInfo.deviceName };
            } else {
                throw new Error(`Cannot connect to device at ${manualIp}`);
            }
        } else if (devices.length === 1) {
            targetDevice = devices[0];
            console.log(`✅ Found device: ${targetDevice.deviceName} at ${targetDevice.ip}`);
        } else {
            console.log('\nMultiple devices found:');
            devices.forEach((device, index) => {
                console.log(`  ${index + 1}. ${device.deviceName} at ${device.ip}`);
            });
            
            const choice = await promptUser(`Select device (1-${devices.length}): `);
            const index = parseInt(choice) - 1;
            
            if (index >= 0 && index < devices.length) {
                targetDevice = devices[index];
            } else {
                throw new Error('Invalid device selection');
            }
        }
        
        // Create tunnel
        console.log(`\n🚀 Creating tunnel to ${targetDevice.deviceName} (${targetDevice.ip})...`);
        const tunnel = await createTunnel(targetDevice.ip);
        
        // Display session info
        console.log('\n' + '='.repeat(60));
        console.log('🎉 REMOTE SUPPORT SESSION ACTIVE');
        console.log('='.repeat(60));
        console.log(`📍 Device: ${targetDevice.deviceName} at ${targetDevice.ip}`);
        console.log(`🌐 Tunnel URL: ${tunnel.url}`);
        console.log(`⏰ Session started at ${new Date().toLocaleTimeString()}`);
        console.log('');
        console.log('🔗 Share this URL with KLVR support:');
        console.log(`   ${tunnel.url}`);
        console.log('');
        console.log('💡 Support can now use:');
        console.log(`   node firmware-update.js ${tunnel.url}`);
        console.log(`   python3 monitor_detection.py ${tunnel.url} aa`);
        console.log('');
        console.log('⚠️  Keep this terminal open during the support session');
        console.log('   Press Ctrl+C to end the session...');
        console.log('='.repeat(60));
        
        // Handle shutdown gracefully
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Ending remote support session...');
            tunnel.process.kill();
            console.log('✅ Tunnel closed');
            console.log('👋 Remote support session ended');
            process.exit(0);
        });
        
        // Keep the process alive
        return new Promise(() => {
            // This promise never resolves, keeping the tunnel alive
        });
        
    } catch (error) {
        console.error('\n❌ Failed to start remote support session:', error.message);
        process.exit(1);
    }
}

// Export for use in main script
module.exports = {
    startRemoteSupportSession,
    checkCloudflaredInstalled,
    installCloudflared,
    createTunnel
};

// If run directly
if (require.main === module) {
    startRemoteSupportSession();
}
