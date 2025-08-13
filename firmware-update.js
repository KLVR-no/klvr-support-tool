const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
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

// Helper function to prompt user for IP address
async function promptForIpAddress() {
    console.log('\n' + '='.repeat(60));
    console.log('    Device Target Selection');
    console.log('='.repeat(60));
    console.log('Please specify the target device IP address:');
    console.log('');
    console.log('  Examples: 10.110.73.155, 192.168.1.100');
    console.log('  Leave empty to auto-discover devices via Bonjour/mDNS');
    console.log('');
    console.log('-'.repeat(60));
    
    const ip = await promptUser('Target IP address (or press Enter for auto-discovery): ');
    
    if (ip === '') {
        return null; // Auto-discovery
    }
    
    // Validate IP format
    if (!ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        console.error('❌ Invalid IP address format. Please use format: xxx.xxx.xxx.xxx');
        return await promptForIpAddress(); // Retry
    }
    
    console.log(`✅ Target IP: ${ip}`);
    return ip;
}

// Helper function to extract version from firmware filename
function extractFirmwareVersion(filename) {
    // Extract version from patterns like "main_v1.8.3.signed.bin" or "rear_v1.8.4-beta-aa-aaa-detection.signed.bin"
    const match = filename.match(/_(v\d+\.\d+\.\d+(?:-[^.]+)?)/);
    return match ? match[1] : null;
}

// Helper function to find matched firmware pairs
function findMatchedFirmwarePairs(mainFiles, rearFiles) {
    const pairs = [];
    
    // Group by version
    for (const mainFile of mainFiles) {
        const version = extractFirmwareVersion(mainFile.file);
        if (!version) continue;
        
        // Find matching rear firmware with same version
        const matchingRear = rearFiles.find(rearFile => {
            const rearVersion = extractFirmwareVersion(rearFile.file);
            return rearVersion === version;
        });
        
        if (matchingRear) {
            pairs.push({
                version: version,
                main: mainFile,
                rear: matchingRear,
                // Use the newer modification time of the two files for sorting
                mtime: mainFile.mtime > matchingRear.mtime ? mainFile.mtime : matchingRear.mtime
            });
        }
    }
    
    // Sort by modification time (newest first)
    return pairs.sort((a, b) => b.mtime - a.mtime);
}

// Helper function to select firmware version when multiple matched pairs exist
async function selectFirmwareVersion(matchedPairs, firmwareDir) {
    if (matchedPairs.length === 1) {
        // Only one version available, use it
        const pair = matchedPairs[0];
        return {
            main: path.join(firmwareDir, pair.main.file),
            rear: path.join(firmwareDir, pair.rear.file)
        };
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('    Firmware Version Selection');
    console.log('='.repeat(60));
    console.log('Multiple firmware versions found. Please select one:');
    console.log('');
    
    matchedPairs.forEach((pair, index) => {
        const date = pair.mtime.toLocaleDateString();
        const time = pair.mtime.toLocaleTimeString();
        const isLatest = index === 0 ? ' (LATEST)' : '';
        
        console.log(`  ${index + 1}. ${pair.version}${isLatest}`);
        console.log(`     └── Modified: ${date} ${time}`);
        console.log(`     └── Main: ${pair.main.file}`);
        console.log(`     └── Rear: ${pair.rear.file}`);
        console.log('');
    });
    
    console.log('-'.repeat(60));
    
    let selectedIndex;
    while (true) {
        const input = await promptUser(`Select firmware version (1-${matchedPairs.length}, or press Enter for latest): `);
        if (input === '') {
            selectedIndex = 0; // Latest (first in sorted array)
            break;
        }
        const index = parseInt(input) - 1;
        if (index >= 0 && index < matchedPairs.length) {
            selectedIndex = index;
            break;
        }
        console.error(`❌ Please enter a number between 1 and ${matchedPairs.length}`);
    }
    
    const selectedPair = matchedPairs[selectedIndex];
    const selectedMain = path.join(firmwareDir, selectedPair.main.file);
    const selectedRear = path.join(firmwareDir, selectedPair.rear.file);
    
    console.log(`\n✅ Selected firmware version: ${selectedPair.version}`);
    console.log(`   Main: ${selectedPair.main.file}`);
    console.log(`   Rear: ${selectedPair.rear.file}`);
    
    return {
        main: selectedMain,
        rear: selectedRear
    };
}

async function findAndSelectFirmwareFiles(interactive = true) {
    const firmwareDir = path.join(__dirname, 'firmware');
    
    try {
        const files = await fs.readdir(firmwareDir);
        
        // Filter for signed binary files
        const mainFiles = files.filter(file => file.startsWith('main_') && file.endsWith('.signed.bin'));
        const rearFiles = files.filter(file => file.startsWith('rear_') && file.endsWith('.signed.bin'));
        
        if (mainFiles.length === 0 || rearFiles.length === 0) {
            throw new Error('Missing firmware files in firmware directory');
        }
        
        // Sort by modification time (newest first) and add stats
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
        
        // Find matched firmware pairs (same version)
        const matchedPairs = findMatchedFirmwarePairs(sortedMainFiles, sortedRearFiles);
        
        if (matchedPairs.length === 0) {
            throw new Error('No matching firmware pairs found. Main and rear firmware versions must match.');
        }
        
        // If interactive mode and multiple matched pairs exist, let user select
        if (interactive && matchedPairs.length > 1) {
            return await selectFirmwareVersion(matchedPairs, firmwareDir);
        }
        
        // Otherwise use latest matched pair
        const latestPair = matchedPairs[0];
        const latestMainFile = path.join(firmwareDir, latestPair.main.file);
        const latestRearFile = path.join(firmwareDir, latestPair.rear.file);
        
        console.log(`[FIRMWARE] Found latest firmware version: ${latestPair.version}`);
        console.log(`[FIRMWARE] Main firmware: ${latestPair.main.file}`);
        console.log(`[FIRMWARE] Rear firmware: ${latestPair.rear.file}`);
        
        return {
            main: latestMainFile,
            rear: latestRearFile
        };
        
    } catch (error) {
        throw new Error(`Failed to find firmware files: ${error.message}`);
    }
}

// Legacy function for backward compatibility
async function findLatestFirmwareFiles() {
    return await findAndSelectFirmwareFiles(false);
}

async function discoverKLVRDevices() {
    console.log('\n' + '='.repeat(60));
    console.log('    Auto-Discovery');
    console.log('='.repeat(60));
    console.log('🔍 Searching for KLVR Charger Pro devices via Bonjour/mDNS...');
    console.log('');
    
    return new Promise((resolve) => {
        const devices = [];
        let foundDevices = 0;
        
        const timeout = setTimeout(() => {
            console.log('⏱️  Discovery timeout reached');
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
            foundDevices++;
            console.log(`✅ Found device ${foundDevices}: ${service.name} at ${ip}:${service.port}`);
        });
        
        // Wait for discovery to complete
        setTimeout(() => {
            clearTimeout(timeout);
            browser.stop();
            bonjour.destroy();
            
            if (devices.length > 0) {
                console.log(`\n🎯 Discovery complete: Found ${devices.length} device(s)`);
            } else {
                console.log('\n❌ No devices found');
            }
            console.log('-'.repeat(60));
            
            resolve(devices);
        }, 5000); // 5 second discovery window
    });
}

async function testDeviceConnection(ip) {
    console.log(`🔗 Testing connection to ${ip}...`);
    
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
                        console.log(`✅ Connected to ${deviceName} (firmware: ${info.firmwareVersion})`);
                        resolve({
                            ip: ip,
                            deviceName: deviceName,
                            firmwareVersion: info.firmwareVersion,
                            serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown'
                        });
                    } else {
                        console.log(`❌ Device at ${ip} has name "${deviceName}" - not a KLVR device`);
                        resolve(null);
                    }
                } catch (error) {
                    console.log(`❌ Failed to parse response from ${ip}: ${error.message}`);
                    resolve(null);
                }
            });
        });

        req.on('error', () => {
            console.log(`❌ Connection failed to ${ip}`);
            resolve(null);
        });
        req.on('timeout', () => {
            console.log(`⏱️  Connection timeout to ${ip}`);
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
    let installedVersion = null;
    let oldVersion = null;
    
    try {
        console.log('\n' + '='.repeat(60));
        console.log('    Firmware Update Progress');
        console.log('='.repeat(60));
        
        // Extract target version from firmware filename
        const targetVersion = extractFirmwareVersion(path.basename(mainFirmwarePath));
        
        // 1. Get device info first (like the app does)
        console.log('📋 Step 1/10: Getting device info...');
        const deviceInfo = await getDeviceInfo(deviceIp);
        oldVersion = deviceInfo.firmwareVersion;
        console.log(`   Current firmware version: ${oldVersion}`);
        if (targetVersion) {
            console.log(`   Target firmware version: ${targetVersion}`);
        }

        // 2. Read firmware files
        console.log('\n📁 Step 2/10: Reading firmware files...');
        const mainFirmware = await fs.readFile(mainFirmwarePath);
        const rearFirmware = await fs.readFile(rearFirmwarePath);
        console.log(`   Main firmware: ${(mainFirmware.length / 1024).toFixed(1)} KB`);
        console.log(`   Rear firmware: ${(rearFirmware.length / 1024).toFixed(1)} KB`);

        // 3. Update main board first (furthest from computer)
        console.log('\n⚡ Step 3/10: Uploading main board firmware...');
        const mainResponse = await uploadFirmware(deviceIp, mainFirmware, true);
        if (!mainResponse.ok) {
            throw new Error(`Main board firmware upload failed: ${mainResponse.status}`);
        }
        console.log('   ✅ Main board firmware uploaded successfully');

        // 4. Wait for main board firmware to be processed (7 seconds in app)
        console.log('\n⏳ Step 4/10: Processing main board firmware...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));
        console.log('   ✅ Main board firmware processed');

        // 5. Reboot main board
        console.log('\n🔄 Step 5/10: Rebooting main board...');
        const mainRebootResponse = await rebootDevice(deviceIp, 'main');
        if (!mainRebootResponse.ok) {
            throw new Error(`Main board reboot failed: ${mainRebootResponse.status}`);
        }
        console.log('   ✅ Main board reboot initiated');

        // 6. Short wait for reboot message to propagate (1.5s in app)
        console.log('\n⏳ Step 6/10: Waiting for reboot propagation...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.SEND_REBOOT_WAIT));
        console.log('   ✅ Reboot message propagated');

        // 7. Immediately proceed with rear board update
        console.log('\n⚡ Step 7/10: Uploading rear board firmware...');
        const rearResponse = await uploadFirmware(deviceIp, rearFirmware, false);
        if (!rearResponse.ok) {
            throw new Error(`Rear board firmware upload failed: ${rearResponse.status}`);
        }
        console.log('   ✅ Rear board firmware uploaded successfully');

        // 8. Wait for rear board firmware to be processed (7s in app)
        console.log('\n⏳ Step 8/10: Processing rear board firmware...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.FIRMWARE_PROCESSING_WAIT));
        console.log('   ✅ Rear board firmware processed');

        // 9. Reboot rear board
        console.log('\n🔄 Step 9/10: Rebooting rear board...');
        const rearRebootResponse = await rebootDevice(deviceIp, 'rear');
        if (!rearRebootResponse.ok) {
            throw new Error(`Rear board reboot failed: ${rearRebootResponse.status}`);
        }
        console.log('   ✅ Rear board reboot initiated');

        // 10. Wait for rear board to fully reboot (20s in app)
        console.log('\n⏳ Step 10/10: Waiting for complete system reboot...');
        console.log('   This may take up to 20 seconds...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.REAR_BOARD_REBOOT_WAIT));
        console.log('   ✅ System reboot completed');

        console.log('\n' + '='.repeat(60));
        console.log('🎉 FIRMWARE UPDATE COMPLETED SUCCESSFULLY! 🎉');
        console.log('='.repeat(60));
        
        // Try to get new version
        try {
            const newDeviceInfo = await getDeviceInfo(deviceIp);
            installedVersion = newDeviceInfo.firmwareVersion;
            console.log(`📊 Firmware updated: ${oldVersion} → ${installedVersion}`);
            
            // Return update info for summary
            return {
                success: true,
                oldVersion: oldVersion,
                newVersion: installedVersion,
                targetVersion: targetVersion
            };
        } catch (error) {
            console.log('⏳ Device still initializing, firmware version will be available shortly');
            // Return update info even if we can't verify the new version yet
            return {
                success: true,
                oldVersion: oldVersion,
                newVersion: targetVersion || 'Unknown',
                targetVersion: targetVersion
            };
        }

    } catch (error) {
        console.log('\n' + '='.repeat(60));
        console.log('❌ FIRMWARE UPDATE FAILED');
        console.log('='.repeat(60));
        console.error(`💥 Error: ${error.message}`);
        throw error;
    }
}

// Command line interface
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        
        // Check for help flag or too many arguments
        if (args.includes('--help') || args.includes('-h') || args.length > 3) {
            console.log('KLVR Firmware Updater - Interactive Mode');
            console.log('');
            console.log('Usage: node firmware-update.js [options]');
            console.log('');
            console.log('Interactive Mode (Recommended):');
            console.log('  node firmware-update.js                    # Interactive prompts for IP and firmware selection');
            console.log('');
            console.log('Non-Interactive Mode:');
            console.log('  node firmware-update.js [target-ip]                                     # Auto-find firmware, target specific IP');
            console.log('  node firmware-update.js [main-firmware.bin] [rear-firmware.bin]        # Specify firmware files, discover devices');
            console.log('  node firmware-update.js [main-firmware.bin] [rear-firmware.bin] [ip]   # Specify everything');
            console.log('');
            console.log('Options:');
            console.log('  --help, -h    Show this help message');
            process.exit(0);
        }

        let mainFirmwarePath, rearFirmwarePath, targetIp;
        let interactiveMode = args.length === 0;
        
        try {
            if (interactiveMode) {
                // Interactive mode: prompt for everything
                console.log('='.repeat(60));
                console.log('    KLVR Firmware Updater - Interactive Mode');
                console.log('='.repeat(60));
                
                // Prompt for IP address
                targetIp = await promptForIpAddress();
                
                // Select firmware files interactively
                const firmwareFiles = await findAndSelectFirmwareFiles(true);
                mainFirmwarePath = firmwareFiles.main;
                rearFirmwarePath = firmwareFiles.rear;
                
            } else {
                // Non-interactive mode: parse arguments
                if (args.length === 1) {
                    // One argument: could be IP address
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
            }

            // Validate firmware files exist
            await fs.access(mainFirmwarePath);
            await fs.access(rearFirmwarePath);
            
            console.log('\n' + '='.repeat(60));
            console.log('    Firmware Validation');
            console.log('='.repeat(60));
            console.log('📋 Firmware files validated successfully:');
            console.log('');
            console.log(`  📦 Main firmware: ${path.basename(mainFirmwarePath)}`);
            console.log(`  📦 Rear firmware: ${path.basename(rearFirmwarePath)}`);
            console.log('-'.repeat(60));
            
            let devices = [];
            
            if (targetIp) {
                // Direct IP targeting
                console.log('\n' + '='.repeat(60));
                console.log('    Direct Connection');
                console.log('='.repeat(60));
                console.log(`🎯 Targeting specific device at IP: ${targetIp}`);
                console.log('');
                
                // Test connection to the target IP
                const deviceInfo = await testDeviceConnection(targetIp);
                if (deviceInfo) {
                    devices.push(deviceInfo);
                    console.log(`\n🎉 Connection successful!`);
                    console.log('-'.repeat(60));
                } else {
                    console.log('\n' + '='.repeat(60));
                    console.log('❌ CONNECTION FAILED');
                    console.log('='.repeat(60));
                    console.error('Failed to connect to device at the specified IP address.');
                    console.error('Please check:');
                    console.error('  • Device is powered on');
                    console.error('  • IP address is correct');
                    console.error('  • Network connectivity');
                    process.exit(1);
                }
            } else {
                // Discover KLVR devices via Bonjour
                devices = await discoverKLVRDevices();
                
                if (devices.length === 0) {
                    console.log('\n' + '='.repeat(60));
                    console.log('❌ NO DEVICES FOUND');
                    console.log('='.repeat(60));
                    console.error('No KLVR Charger Pro devices found on the network.');
                    console.error('Please check:');
                    console.error('  • Devices are powered on');
                    console.error('  • Connected to the same network');
                    console.error('  • Bonjour/mDNS is enabled');
                    process.exit(1);
                }
            }
            
            // Confirm before proceeding
            if (interactiveMode) {
                console.log('\n' + '='.repeat(60));
                console.log('    Update Confirmation');
                console.log('='.repeat(60));
                console.log('Ready to update the following:');
                console.log('');
                console.log(`  📦 Main firmware: ${path.basename(mainFirmwarePath)}`);
                console.log(`  📦 Rear firmware: ${path.basename(rearFirmwarePath)}`);
                console.log(`  🎯 Target device(s): ${devices.map(d => `${d.deviceName} (${d.ip})`).join(', ')}`);
                console.log('');
                console.log('⚠️  WARNING: This will update the firmware on your device(s).');
                console.log('   Make sure the device is connected and powered on.');
                console.log('');
                console.log('-'.repeat(60));
                
                const confirm = await promptUser('Proceed with firmware update? (y/N): ');
                if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
                    console.log('❌ Firmware update cancelled by user');
                    process.exit(0);
                }
                console.log('✅ Starting firmware update...');
            }
            
            // Update all found devices
            let successCount = 0;
            let failCount = 0;
            const updateResults = [];
            
            for (const device of devices) {
                console.log(`\n${'='.repeat(60)}`);
                console.log(`    Updating Device: ${device.deviceName}`);
                console.log(`${'='.repeat(60)}`);
                console.log(`🎯 Target: ${device.deviceName} at ${device.ip}`);
                
                try {
                    const result = await executeFirmwareUpdate(device.ip, mainFirmwarePath, rearFirmwarePath);
                    successCount++;
                    updateResults.push({
                        device: device,
                        success: true,
                        ...result
                    });
                    console.log(`\n✅ Successfully updated: ${device.deviceName}`);
                } catch (error) {
                    failCount++;
                    updateResults.push({
                        device: device,
                        success: false,
                        error: error.message
                    });
                    console.log(`\n❌ Failed to update: ${device.deviceName}`);
                    console.error(`   Error: ${error.message}`);
                }
            }
            
            // Final summary with dynamic firmware version information
            console.log('\n' + '='.repeat(60));
            console.log('    FINAL SUMMARY');
            console.log('='.repeat(60));
            console.log(`🎯 Total devices processed: ${devices.length}`);
            console.log(`✅ Successful updates: ${successCount}`);
            console.log(`❌ Failed updates: ${failCount}`);
            
            // Show firmware version details for successful updates
            if (successCount > 0) {
                console.log('\n📊 Firmware Update Details:');
                const successfulUpdates = updateResults.filter(r => r.success);
                
                successfulUpdates.forEach(result => {
                    const versionInfo = result.oldVersion && result.newVersion 
                        ? `${result.oldVersion} → ${result.newVersion}`
                        : result.newVersion || 'Updated';
                    console.log(`   • ${result.device.deviceName}: ${versionInfo}`);
                });
                
                // Get the target version for the summary message
                const targetVersion = successfulUpdates[0]?.targetVersion || successfulUpdates[0]?.newVersion;
                
                if (failCount === 0) {
                    console.log('\n🎉 ALL FIRMWARE UPDATES COMPLETED SUCCESSFULLY! 🎉');
                    if (targetVersion) {
                        console.log(`\nYour KLVR device${devices.length > 1 ? 's are' : ' is'} now running firmware ${targetVersion}.`);
                    } else {
                        console.log(`\nYour KLVR device${devices.length > 1 ? 's are' : ' is'} now running the updated firmware.`);
                    }
                } else {
                    console.log('\n⚠️  PARTIAL SUCCESS - Some devices updated successfully');
                    if (targetVersion) {
                        console.log(`${successCount} device${successCount > 1 ? 's' : ''} successfully updated to firmware ${targetVersion}.`);
                    }
                    console.log('Please check the failed devices and retry if needed.');
                }
            } else {
                console.log('\n❌ ALL UPDATES FAILED');
                console.log('Please check device connectivity and try again.');
            }
            
            console.log('='.repeat(60));
            process.exit(failCount > 0 ? 1 : 0);
            
        } catch (error) {
            console.error('[FIRMWARE] Error:', error.message);
            process.exit(1);
        }
    })();
}
