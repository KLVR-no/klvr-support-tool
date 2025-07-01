const http = require('http');
const fs = require('fs').promises;

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
    const args = process.argv.slice(2);
    if (args.length !== 3) {
        console.error('Usage: node firmware-update.js <device-ip> <main-firmware.bin> <rear-firmware.bin>');
        process.exit(1);
    }

    const [deviceIp, mainFirmwarePath, rearFirmwarePath] = args;

    // Validate files exist
    Promise.all([
        fs.access(mainFirmwarePath),
        fs.access(rearFirmwarePath)
    ]).then(() => {
        console.log(`[FIRMWARE] Starting update process for device: ${deviceIp}`);
        console.log(`[FIRMWARE] Main firmware: ${mainFirmwarePath}`);
        console.log(`[FIRMWARE] Rear firmware: ${rearFirmwarePath}`);
        
        executeFirmwareUpdate(deviceIp, mainFirmwarePath, rearFirmwarePath)
            .then(() => {
                console.log('[FIRMWARE] Update process completed');
                process.exit(0);
            })
            .catch((error) => {
                console.error('[FIRMWARE] Update process failed:', error.message);
                process.exit(1);
            });
    }).catch((error) => {
        console.error('[FIRMWARE] Error accessing firmware files:', error.message);
        process.exit(1);
    });
}
