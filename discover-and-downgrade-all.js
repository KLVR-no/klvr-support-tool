const bonjour = require('bonjour')();
const http = require('http');
const fs = require('fs').promises;
const path = require('path');

// Configuration matching the app's exact settings
const CONFIG = {
    DEFAULT_PORT: 8000,
    CONNECTION_TIMEOUT: 5000,
    DISCOVERY_TIMEOUT: 10000,
    FIRMWARE_PROCESSING_WAIT: 7000,
    SEND_REBOOT_WAIT: 1500,
    MAIN_BOARD_REBOOT_WAIT: 7000,
    REAR_BOARD_REBOOT_WAIT: 20000,
    ENDPOINTS: {
        FIRMWARE_CHARGER: '/api/v2/device/firmware_charger',
        FIRMWARE_REAR: '/api/v2/device/firmware_rear',
        REBOOT: '/api/v2/device/reboot',
        INFO: '/api/v2/device/info'
    }
};

const BONJOUR_SERVICE = 'klvrcharger';

async function findSpecificFirmwareFiles(version = '1.8.3') {
    const firmwareDir = path.join(__dirname, 'firmware');
    
    try {
        const files = await fs.readdir(firmwareDir);
        
        const mainFile = `main_v${version}.signed.bin`;
        const rearFile = `rear_v${version}.signed.bin`;
        
        if (!files.includes(mainFile)) {
            throw new Error(`Main firmware file not found: ${mainFile}`);
        }
        if (!files.includes(rearFile)) {
            throw new Error(`Rear firmware file not found: ${rearFile}`);
        }
        
        const mainPath = path.join(firmwareDir, mainFile);
        const rearPath = path.join(firmwareDir, rearFile);
        
        await fs.access(mainPath);
        await fs.access(rearPath);
        
        console.log(`[FIRMWARE] Found main firmware: ${mainFile}`);
        console.log(`[FIRMWARE] Found rear firmware: ${rearFile}`);
        
        return {
            main: mainPath,
            rear: rearPath,
            version: version
        };
        
    } catch (error) {
        throw new Error(`Failed to find firmware files for version ${version}: ${error.message}`);
    }
}

async function discoverDevicesViaBonjour() {
    console.log('[DISCOVERY] Discovering KLVR devices via Bonjour/mDNS...');
    
    return new Promise((resolve) => {
        const devices = [];
        let foundDevices = 0;
        
        const timeout = setTimeout(() => {
            console.log('[DISCOVERY] Discovery timeout reached');
            bonjour.destroy();
            resolve(devices);
        }, CONFIG.DISCOVERY_TIMEOUT);
        
        const browser = bonjour.find({ type: BONJOUR_SERVICE }, (service) => {
            // Prefer IPv4 address if available
            const ip = (service.addresses || []).find(addr => 
                addr && addr.split('.').length === 4
            ) || service.host;
            
            const device = {
                ip: ip,
                deviceName: service.name,
                port: service.port || CONFIG.DEFAULT_PORT,
                url: `http://${ip}:${service.port || CONFIG.DEFAULT_PORT}`
            };
            
            devices.push(device);
            foundDevices++;
            console.log(`[DISCOVERY] Found device ${foundDevices}: ${service.name} at ${ip}:${device.port}`);
        });
        
        // Wait for discovery to complete
        setTimeout(() => {
            clearTimeout(timeout);
            browser.stop();
            bonjour.destroy();
            
            if (devices.length > 0) {
                console.log(`[DISCOVERY] Discovery complete: Found ${devices.length} device(s) via Bonjour`);
            } else {
                console.log('[DISCOVERY] No devices found via Bonjour/mDNS');
            }
            
            resolve(devices);
        }, 8000); // 8 second discovery window
    });
}

async function getDeviceInfo(deviceIp) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: deviceIp,
            port: CONFIG.DEFAULT_PORT,
            path: CONFIG.ENDPOINTS.INFO,
            method: 'GET',
            timeout: CONFIG.CONNECTION_TIMEOUT
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    resolve({
                        ip: deviceIp,
                        deviceName: info.deviceName || info.name,
                        firmwareVersion: info.firmwareVersion,
                        serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown'
                    });
                } catch (error) {
                    reject(new Error('Failed to parse device info response'));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection timeout'));
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
                'Content-Length': 4
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

        req.write(board);
        req.end();
    });
}

async function executeFirmwareUpdate(deviceIp, mainFirmwarePath, rearFirmwarePath, targetVersion) {
    try {
        console.log('[FIRMWARE] Getting device info...');
        const deviceInfo = await getDeviceInfo(deviceIp);
        console.log(`[FIRMWARE] Current firmware version: ${deviceInfo.firmwareVersion}`);
        console.log(`[FIRMWARE] Target firmware version: ${targetVersion}`);

        console.log('[FIRMWARE] Reading firmware files...');
        const mainFirmware = await fs.readFile(mainFirmwarePath);
        const rearFirmware = await fs.readFile(rearFirmwarePath);

        console.log('[FIRMWARE] Starting main board update...');
        const mainResponse = await uploadFirmware(deviceIp, mainFirmware, true);
        if (!mainResponse.ok) {
            throw new Error(`Main board firmware upload failed: ${mainResponse.status}`);
        }

        console.log('[FIRMWARE] Waiting for main board firmware processing...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));

        console.log('[FIRMWARE] Rebooting main board...');
        const mainRebootResponse = await rebootDevice(deviceIp, 'main');
        if (!mainRebootResponse.ok) {
            throw new Error(`Main board reboot failed: ${mainRebootResponse.status}`);
        }

        console.log('[FIRMWARE] Waiting for reboot message to propagate...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.SEND_REBOOT_WAIT));

        console.log('[FIRMWARE] Starting rear board update...');
        const rearResponse = await uploadFirmware(deviceIp, rearFirmware, false);
        if (!rearResponse.ok) {
            throw new Error(`Rear board firmware upload failed: ${rearResponse.status}`);
        }

        console.log('[FIRMWARE] Waiting for rear board firmware processing...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));

        console.log('[FIRMWARE] Rebooting rear board...');
        const rearRebootResponse = await rebootDevice(deviceIp, 'rear');
        if (!rearRebootResponse.ok) {
            throw new Error(`Rear board reboot failed: ${rearRebootResponse.status}`);
        }

        console.log('[FIRMWARE] Waiting for rear board to complete reboot...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.REAR_BOARD_REBOOT_WAIT));

        console.log(`[FIRMWARE] Firmware downgrade to ${targetVersion} completed successfully!`);
        
        try {
            const newDeviceInfo = await getDeviceInfo(deviceIp);
            console.log(`[FIRMWARE] New firmware version: ${newDeviceInfo.firmwareVersion}`);
            return { success: true, newVersion: newDeviceInfo.firmwareVersion };
        } catch (error) {
            console.log('[FIRMWARE] Device still rebooting, cannot get new firmware version yet');
            return { success: true, newVersion: 'Unknown (rebooting)' };
        }

    } catch (error) {
        console.error('[FIRMWARE] Update failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function discoverAndDowngradeAll() {
    const targetVersion = '1.8.3';

    try {
        console.log('🔍 KLVR Device Discovery and Firmware Downgrader');
        console.log('=' .repeat(60));
        console.log(`[FIRMWARE] Target version: ${targetVersion}`);
        
        // Step 1: Discover devices via Bonjour
        const discoveredDevices = await discoverDevicesViaBonjour();
        
        if (discoveredDevices.length === 0) {
            console.log('[DISCOVERY] No devices found via Bonjour. They may not be advertising mDNS.');
            console.log('[DISCOVERY] Please ensure all chargers are powered on and on the same network.');
            return;
        }

        // Step 2: Get detailed info for each discovered device
        console.log(`\n[DISCOVERY] Getting detailed information for ${discoveredDevices.length} device(s)...`);
        const devices = [];
        
        for (const device of discoveredDevices) {
            try {
                const info = await getDeviceInfo(device.ip);
                devices.push({
                    ...device,
                    ...info
                });
                console.log(`[DISCOVERY] ✅ ${info.deviceName} at ${device.ip} (v${info.firmwareVersion})`);
            } catch (error) {
                console.log(`[DISCOVERY] ❌ Failed to get info from ${device.ip}: ${error.message}`);
            }
        }

        if (devices.length === 0) {
            console.log('[DISCOVERY] No devices could be queried for information.');
            return;
        }

        // Step 3: Display found devices
        console.log('\n📋 Found KLVR Devices:');
        console.log('=' .repeat(60));
        devices.forEach((device, index) => {
            console.log(`${index + 1}. ${device.deviceName} at ${device.ip}`);
            console.log(`   Firmware: v${device.firmwareVersion}`);
            console.log(`   Serial: ${device.serialNumber}`);
            console.log('');
        });

        // Step 4: Check which devices need downgrading
        const devicesToDowngrade = devices.filter(device => 
            device.firmwareVersion !== targetVersion
        );
        
        const alreadyCorrectVersion = devices.filter(device => 
            device.firmwareVersion === targetVersion
        );

        console.log(`[FIRMWARE] Devices already on ${targetVersion}: ${alreadyCorrectVersion.length}`);
        console.log(`[FIRMWARE] Devices needing downgrade: ${devicesToDowngrade.length}`);

        if (devicesToDowngrade.length === 0) {
            console.log(`[FIRMWARE] All devices are already running version ${targetVersion}!`);
            return;
        }

        // Step 5: Find firmware files
        console.log(`\n[FIRMWARE] Looking for firmware version ${targetVersion}...`);
        const firmwareFiles = await findSpecificFirmwareFiles(targetVersion);

        // Step 6: Execute downgrades
        console.log(`\n🔧 Starting firmware downgrades...`);
        console.log('=' .repeat(60));
        
        const results = [];
        for (const device of devicesToDowngrade) {
            console.log(`\n[${'='.repeat(50)}]`);
            console.log(`[FIRMWARE] Processing: ${device.deviceName} at ${device.ip}`);
            console.log(`[FIRMWARE] Current version: ${device.firmwareVersion} → Target: ${targetVersion}`);
            console.log(`[${'='.repeat(50)}]`);
            
            const result = await executeFirmwareUpdate(device.ip, firmwareFiles.main, firmwareFiles.rear, targetVersion);
            results.push({
                ...device,
                ...result
            });
            
            if (result.success) {
                console.log(`[FIRMWARE] ✅ Successfully downgraded ${device.deviceName} at ${device.ip}`);
            } else {
                console.log(`[FIRMWARE] ❌ Failed to downgrade ${device.deviceName} at ${device.ip}: ${result.error}`);
            }
            
            // Wait between devices
            if (devicesToDowngrade.indexOf(device) < devicesToDowngrade.length - 1) {
                console.log(`[FIRMWARE] Waiting 5 seconds before next device...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Step 7: Final summary
        console.log(`\n📊 FINAL SUMMARY`);
        console.log('=' .repeat(60));
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        console.log(`Total devices discovered: ${devices.length}`);
        console.log(`Devices processed: ${results.length}`);
        console.log(`Successful downgrades: ${successful.length}`);
        console.log(`Failed downgrades: ${failed.length}`);
        console.log(`Already correct version: ${alreadyCorrectVersion.length}`);
        
        if (successful.length > 0) {
            console.log(`\n✅ Successful downgrades:`);
            successful.forEach(device => {
                console.log(`  - ${device.deviceName} at ${device.ip} → v${device.newVersion}`);
            });
        }
        
        if (failed.length > 0) {
            console.log(`\n❌ Failed downgrades:`);
            failed.forEach(device => {
                console.log(`  - ${device.deviceName} at ${device.ip}: ${device.error}`);
            });
        }

        console.log(`\n🎉 Discovery and downgrade operation completed!`);
        
    } catch (error) {
        console.error('[ERROR]', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    discoverAndDowngradeAll();
}

module.exports = { discoverAndDowngradeAll };
