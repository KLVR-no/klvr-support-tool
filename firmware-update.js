const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const bonjour = require('bonjour')();

// Device discovery configuration
const DISCOVERY_CONFIG = {
    TIMEOUT: 3000,
    BONJOUR_SERVICE: 'klvrcharger'
};

// Configuration matching the app's exact settings
const CONFIG = {
    DEFAULT_PORT: 8000,
    FIRMWARE_PROCESSING_WAIT: 7000,  // 7 seconds - proven reliable in testing
    SEND_REBOOT_WAIT: 1500,         // 1.5 seconds - proven reliable in testing
    MAIN_BOARD_REBOOT_WAIT: 7000,   // 7 seconds - proven reliable in testing
    REAR_BOARD_REBOOT_WAIT: 20000,  // 20 seconds - needed for rear board
    ENDPOINTS: {
        FIRMWARE_CHARGER: '/api/v2/device/firmware_charger',
        FIRMWARE_REAR: '/api/v2/device/firmware_rear',
        REBOOT: '/api/v2/device/reboot',
        INFO: '/api/v2/device/info'
    }
};

async function findLatestFirmwareFiles() {
    const firmwareDir = path.join(__dirname, 'firmware');
    
    try {
        const files = await fs.readdir(firmwareDir);
        
        // Filter for signed binary files
        const mainFiles = files.filter(file => file.startsWith('main_') && file.endsWith('.signed.bin'));
        const rearFiles = files.filter(file => file.startsWith('rear_') && file.endsWith('.signed.bin'));
        
        if (mainFiles.length === 0 || rearFiles.length === 0) {
            throw new Error('Missing firmware files in firmware directory');
        }
        
        // Sort by modification time (newest first) or by filename
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
        
        const latestMainFile = path.join(firmwareDir, sortedMainFiles[0].file);
        const latestRearFile = path.join(firmwareDir, sortedRearFiles[0].file);
        
        console.log(`[FIRMWARE] Found latest main firmware: ${sortedMainFiles[0].file}`);
        console.log(`[FIRMWARE] Found latest rear firmware: ${sortedRearFiles[0].file}`);
        
        return {
            main: latestMainFile,
            rear: latestRearFile
        };
        
    } catch (error) {
        throw new Error(`Failed to find firmware files: ${error.message}`);
    }
}

async function discoverKLVRDevices() {
    console.log('[DISCOVERY] Searching for KLVR Charger Pro devices via Bonjour/mDNS...');
    
    return new Promise((resolve) => {
        const devices = [];
        const timeout = setTimeout(() => {
            console.log('[DISCOVERY] Discovery timeout reached');
            bonjour.destroy();
            resolve(devices);
        }, 10000); // 10 second timeout
        
        // Look for the klvrcharger service
        const browser = bonjour.find({ type: DISCOVERY_CONFIG.BONJOUR_SERVICE }, (service) => {
            // Prefer IPv4 address if available
            const ip = (service.addresses || []).find(addr => addr && addr.split('.').length === 4) || service.host;
            devices.push({
                ip: ip,
                deviceName: service.name,
                port: service.port
            });
            console.log(`[DISCOVERY] Found KLVR device: ${service.name} at ${ip}:${service.port}`);
        });
        
        // Wait for discovery to complete
        setTimeout(() => {
            clearTimeout(timeout);
            browser.stop();
            bonjour.destroy();
            resolve(devices);
        }, 5000); // 5 second discovery window
    });
}

async function testDeviceConnection(ip) {
    return new Promise((resolve) => {
        const options = {
            hostname: ip,
            port: CONFIG.DEFAULT_PORT,
            path: CONFIG.ENDPOINTS.INFO,
            method: 'GET',
            timeout: DISCOVERY_CONFIG.TIMEOUT
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    const deviceName = info.deviceName || info.name;
                    if (deviceName && deviceName.toLowerCase().includes('klvr')) {
                        resolve({
                            ip: ip,
                            deviceName: deviceName,
                            firmwareVersion: info.firmwareVersion,
                            serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown'
                        });
                    } else {
                        console.log(`[DISCOVERY] Device at ${ip} has name "${deviceName}" - not a KLVR device`);
                        resolve(null);
                    }
                } catch (error) {
                    console.log(`[DISCOVERY] Failed to parse response from ${ip}: ${error.message}`);
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

async function getDeviceInfo(deviceIp) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: deviceIp,
            port: CONFIG.DEFAULT_PORT,
            path: CONFIG.ENDPOINTS.INFO,
            method: 'GET'
        };

        console.log(`[FIRMWARE] Getting device info from ${deviceIp}...`);

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    console.log(`[FIRMWARE] Current firmware version: ${info.firmwareVersion}`);
                    resolve(info);
                } catch (error) {
                    reject(new Error('Failed to parse device info response'));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[FIRMWARE] Device info error:`, error);
            reject(error);
        });

        req.end();
    });
}

async function uploadFirmware(deviceIp, firmware, isMainBoard) {
    return new Promise((resolve, reject) => {
        const path = isMainBoard ? CONFIG.ENDPOINTS.FIRMWARE_CHARGER : CONFIG.ENDPOINTS.FIRMWARE_REAR;
        const boardType = isMainBoard ? 'main' : 'rear';
        
        const options = {
            hostname: deviceIp,
            port: CONFIG.DEFAULT_PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Length': firmware.length
            }
        };

        console.log(`[FIRMWARE] Uploading ${boardType} firmware to: ${deviceIp}, size: ${firmware.length} bytes`);

        const req = http.request(options, (res) => {
            console.log(`[FIRMWARE] Upload response status: ${res.statusCode}`);
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
                console.log(`[FIRMWARE] Upload response chunk: ${chunk.toString()}`);
            });
            
            res.on('end', () => {
                console.log(`[FIRMWARE] Upload complete: ${data}`);
                resolve({
                    ok: res.statusCode === 200,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    data: data
                });
            });
        });

        req.on('error', (error) => {
            console.error(`[FIRMWARE] Upload error:`, error);
            reject(error);
        });

        req.write(firmware);
        req.end();
    });
}

async function rebootDevice(deviceIp, board) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: deviceIp,
            port: CONFIG.DEFAULT_PORT,
            path: `${CONFIG.ENDPOINTS.REBOOT}?board=${board}`,
            method: 'POST',
            headers: {
                'Content-Length': 4  // Length of "main" or "rear" is always 4
            }
        };

        console.log(`[FIRMWARE] Rebooting ${board} board on device: ${deviceIp}`);

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode === 200,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    data: data
                });
            });
        });

        req.on('error', (error) => {
            console.error(`[FIRMWARE] Reboot error:`, error);
            reject(error);
        });

        // Send the board type as the body (like in the app)
        req.write(board);
        req.end();
    });
}

async function executeFirmwareUpdate(deviceIp, mainFirmwarePath, rearFirmwarePath) {
    try {
        // 1. Get device info first (like the app does)
        console.log('[FIRMWARE] Getting device info...');
        const deviceInfo = await getDeviceInfo(deviceIp);
        console.log(`[FIRMWARE] Current firmware version: ${deviceInfo.firmwareVersion}`);

        // 2. Read firmware files
        console.log('[FIRMWARE] Reading firmware files...');
        const mainFirmware = await fs.readFile(mainFirmwarePath);
        const rearFirmware = await fs.readFile(rearFirmwarePath);

        // 3. Update main board first (furthest from computer)
        console.log('[FIRMWARE] Starting main board update...');
        const mainResponse = await uploadFirmware(deviceIp, mainFirmware, true);
        if (!mainResponse.ok) {
            throw new Error(`Main board firmware upload failed: ${mainResponse.status}`);
        }

        // 4. Wait for main board firmware to be processed (7 seconds in app)
        console.log('[FIRMWARE] Waiting for main board firmware processing...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));

        // 5. Reboot main board
        console.log('[FIRMWARE] Rebooting main board...');
        const mainRebootResponse = await rebootDevice(deviceIp, 'main');
        if (!mainRebootResponse.ok) {
            throw new Error(`Main board reboot failed: ${mainRebootResponse.status}`);
        }

        // 6. Short wait for reboot message to propagate (1.5s in app)
        console.log('[FIRMWARE] Waiting for reboot message to propagate...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.SEND_REBOOT_WAIT));

        // 7. Immediately proceed with rear board update
        console.log('[FIRMWARE] Starting rear board update...');
        const rearResponse = await uploadFirmware(deviceIp, rearFirmware, false);
        if (!rearResponse.ok) {
            throw new Error(`Rear board firmware upload failed: ${rearResponse.status}`);
        }

        // 8. Wait for rear board firmware to be processed (7s in app)
        console.log('[FIRMWARE] Waiting for rear board firmware processing...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));

        // 9. Reboot rear board
        console.log('[FIRMWARE] Rebooting rear board...');
        const rearRebootResponse = await rebootDevice(deviceIp, 'rear');
        if (!rearRebootResponse.ok) {
            throw new Error(`Rear board reboot failed: ${rearRebootResponse.status}`);
        }

        // 10. Wait for rear board to fully reboot (20s in app)
        console.log('[FIRMWARE] Waiting for rear board to complete reboot...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.REAR_BOARD_REBOOT_WAIT));

        console.log('[FIRMWARE] Firmware update completed successfully!');
        
        // Try to get new version
        try {
            const newDeviceInfo = await getDeviceInfo(deviceIp);
            console.log(`[FIRMWARE] New firmware version: ${newDeviceInfo.firmwareVersion}`);
        } catch (error) {
            console.log('[FIRMWARE] Device still rebooting, cannot get new firmware version yet');
        }

    } catch (error) {
        console.error('[FIRMWARE] Update failed:', error.message);
        throw error;
    }
}

// Command line interface
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        
        if (args.length > 3) {
            console.error('Usage: node firmware-update.js [main-firmware.bin] [rear-firmware.bin] [target-ip]');
            console.error('Usage: node firmware-update.js [target-ip]');
            console.error('');
            console.error('Examples:');
            console.error('  node firmware-update.js                                                    # Auto-find firmware, discover devices');
            console.error('  node firmware-update.js 10.110.73.155                                     # Auto-find firmware, target specific IP');
            console.error('  node firmware-update.js main_v1.7.4.signed.bin rear_v1.7.4.signed.bin   # Specify firmware files, discover devices');
            console.error('  node firmware-update.js main_v1.7.4.signed.bin rear_v1.7.4.signed.bin 10.110.73.155  # Specify everything');
            process.exit(1);
        }

        let mainFirmwarePath, rearFirmwarePath, targetIp;
        
        // Parse arguments based on count
        if (args.length === 0) {
            // No arguments: auto-find firmware, discover devices
            const firmwareFiles = await findLatestFirmwareFiles();
            mainFirmwarePath = firmwareFiles.main;
            rearFirmwarePath = firmwareFiles.rear;
        } else if (args.length === 1) {
            // One argument: could be IP address or main firmware file
            const arg = args[0];
            if (arg.match(/^\d+\.\d+\.\d+\.\d+$/)) {
                // It's an IP address
                targetIp = arg;
                const firmwareFiles = await findLatestFirmwareFiles();
                mainFirmwarePath = firmwareFiles.main;
                rearFirmwarePath = firmwareFiles.rear;
            } else {
                console.error('Invalid argument. If specifying firmware files, you must specify both main and rear firmware files.');
                process.exit(1);
            }
        } else if (args.length === 2) {
            // Two arguments: main firmware and rear firmware
            mainFirmwarePath = args[0];
            rearFirmwarePath = args[1];
        } else if (args.length === 3) {
            // Three arguments: main firmware, rear firmware, and target IP
            mainFirmwarePath = args[0];
            rearFirmwarePath = args[1];
            targetIp = args[2];
        }

        try {
            // Validate firmware files exist
            await fs.access(mainFirmwarePath);
            await fs.access(rearFirmwarePath);
            
            console.log(`[FIRMWARE] Firmware files validated:`);
            console.log(`[FIRMWARE] Main firmware: ${path.basename(mainFirmwarePath)}`);
            console.log(`[FIRMWARE] Rear firmware: ${path.basename(rearFirmwarePath)}`);
            
            let devices = [];
            
            if (targetIp) {
                // Direct IP targeting
                console.log(`[FIRMWARE] Targeting specific device at IP: ${targetIp}`);
                
                // Test connection to the target IP
                const deviceInfo = await testDeviceConnection(targetIp);
                if (deviceInfo) {
                    devices.push(deviceInfo);
                    console.log(`[DISCOVERY] Successfully connected to device: ${deviceInfo.deviceName} at ${targetIp}`);
                } else {
                    console.error(`[DISCOVERY] Failed to connect to device at ${targetIp}`);
                    console.error('Make sure the device is powered on and accessible at this IP address');
                    process.exit(1);
                }
            } else {
                // Discover KLVR devices via Bonjour
                devices = await discoverKLVRDevices();
                
                if (devices.length === 0) {
                    console.error('[DISCOVERY] No KLVR Charger Pro devices found on the network');
                    console.error('Make sure devices are powered on and connected to the same network');
                    process.exit(1);
                }
                
                console.log(`[DISCOVERY] Found ${devices.length} KLVR Charger Pro device(s)`);
            }
            
            // Update all found devices
            for (const device of devices) {
                console.log(`\n[FIRMWARE] Starting update for device: ${device.deviceName} at ${device.ip}`);
                try {
                    await executeFirmwareUpdate(device.ip, mainFirmwarePath, rearFirmwarePath);
                    console.log(`[FIRMWARE] Successfully updated device: ${device.deviceName} at ${device.ip}`);
                } catch (error) {
                    console.error(`[FIRMWARE] Failed to update device ${device.deviceName} at ${device.ip}:`, error.message);
                }
            }
            
            console.log('\n[FIRMWARE] All update processes completed');
            process.exit(0);
            
        } catch (error) {
            console.error('[FIRMWARE] Error:', error.message);
            process.exit(1);
        }
    })();
}
