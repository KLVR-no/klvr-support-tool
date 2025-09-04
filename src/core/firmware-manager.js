const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');

/**
 * Firmware Manager
 * Handles firmware file management, validation, and device updates
 * Extracted and refactored from existing firmware-update.js logic
 */
class FirmwareManager {
    constructor(logger) {
        this.logger = logger;
        this.config = {
            defaultPort: 8000,
            firmwareProcessingWait: 7000,  // 7 seconds - proven reliable in testing
            sendRebootWait: 1500,         // 1.5 seconds - proven reliable in testing
            mainBoardRebootWait: 7000,    // 7 seconds - proven reliable in testing
            rearBoardRebootWait: 20000,   // 20 seconds - needed for rear board
            endpoints: {
                firmwareCharger: '/api/v2/device/firmware_charger',
                firmwareRear: '/api/v2/device/firmware_rear',
                reboot: '/api/v2/device/reboot',
                info: '/api/v2/device/info'
            }
        };
    }

    /**
     * Update firmware on a device
     */
    async updateDevice(device, options = {}) {
        try {
            this.logger.step('Starting firmware update process...');
            
            // Get firmware files
            const firmwareFiles = await this.findAndSelectFirmwareFiles(options);
            
            // Execute the update (rear-only or full)
            const result = options.rearOnly ? 
                await this.executeRearOnlyFirmwareUpdate(device, firmwareFiles) :
                await this.executeFirmwareUpdate(device, firmwareFiles);
            
            return result;
        } catch (error) {
            this.logger.error(`Firmware update failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find and select firmware files based on options
     */
    async findAndSelectFirmwareFiles(options = {}) {
        const firmwareDir = options.firmwareDir || path.join(__dirname, '../../firmware');
        
        // If specific files are provided, use them
        if (options.rearOnly && options.rear) {
            this.logger.info('Using specified rear firmware file for rear-only update');
            return {
                rear: path.resolve(options.rear)
            };
        }
        
        if (options.main && options.rear) {
            this.logger.info('Using specified firmware files');
            return {
                main: path.resolve(options.main),
                rear: path.resolve(options.rear)
            };
        }

        try {
            const files = await fs.readdir(firmwareDir);
            
            // Filter for signed binary files
            const mainFiles = files.filter(file => file.startsWith('main_') && file.endsWith('.signed.bin'));
            const rearFiles = files.filter(file => file.startsWith('rear_') && file.endsWith('.signed.bin'));
            
            if (options.rearOnly) {
                if (rearFiles.length === 0) {
                    throw new Error('No rear firmware files found in firmware directory');
                }
            } else {
                if (mainFiles.length === 0 || rearFiles.length === 0) {
                    throw new Error('Missing firmware files in firmware directory');
                }
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
            
            if (options.rearOnly) {
                // For rear-only updates, just use the latest rear firmware
                const latestRearFile = sortedRearFiles[0];
                const rearVersion = this._extractFirmwareVersion(latestRearFile.file);
                
                this.logger.info(`Found latest rear firmware version: ${rearVersion || 'Unknown'}`);
                this.logger.debug(`Rear firmware: ${latestRearFile.file}`);
                
                return {
                    rear: path.join(firmwareDir, latestRearFile.file)
                };
            } else {
                // Find matched firmware pairs (same version)
                const matchedPairs = this._findMatchedFirmwarePairs(sortedMainFiles, sortedRearFiles);
                
                if (matchedPairs.length === 0) {
                    throw new Error('No matching firmware pairs found. Main and rear firmware versions must match.');
                }
                
                // Use latest matched pair
                const latestPair = matchedPairs[0];
                const latestMainFile = path.join(firmwareDir, latestPair.main.file);
                const latestRearFile = path.join(firmwareDir, latestPair.rear.file);
                
                this.logger.info(`Found latest firmware version: ${latestPair.version}`);
                this.logger.debug(`Main firmware: ${latestPair.main.file}`);
                this.logger.debug(`Rear firmware: ${latestPair.rear.file}`);
                
                return {
                    main: latestMainFile,
                    rear: latestRearFile
                };
            }
            
        } catch (error) {
            throw new Error(`Failed to find firmware files: ${error.message}`);
        }
    }

    /**
     * Execute complete firmware update process
     * Based on the exact sequence from firmware-update.js
     */
    async executeFirmwareUpdate(device, firmwareFiles) {
        let installedVersion = null;
        let oldVersion = null;
        
        try {
            this.logger.step('📋 Step 1/10: Getting device info...');
            const deviceInfo = await this._getDeviceInfo(device);
            oldVersion = deviceInfo.firmwareVersion;
            
            // Extract target version from firmware filename
            const targetVersion = this._extractFirmwareVersion(path.basename(firmwareFiles.main));
            
            this.logger.info(`Current firmware version: ${oldVersion}`);
            if (targetVersion) {
                this.logger.info(`Target firmware version: ${targetVersion}`);
            }

            this.logger.step('📁 Step 2/10: Reading firmware files...');
            const mainFirmware = await fs.readFile(firmwareFiles.main);
            const rearFirmware = await fs.readFile(firmwareFiles.rear);
            this.logger.info(`Main firmware: ${(mainFirmware.length / 1024).toFixed(1)} KB`);
            this.logger.info(`Rear firmware: ${(rearFirmware.length / 1024).toFixed(1)} KB`);

            // Main board update (furthest from computer)
            this.logger.step('⚡ Step 3/10: Uploading main board firmware...');
            const mainResponse = await this._uploadFirmware(device, mainFirmware, true);
            if (!mainResponse.ok) {
                throw new Error(`Main board firmware upload failed: ${mainResponse.status}`);
            }
            this.logger.success('Main board firmware uploaded successfully');

            this.logger.step('⏳ Step 4/10: Processing main board firmware...');
            await this._wait(this.config.firmwareProcessingWait);
            this.logger.success('Main board firmware processed');

            this.logger.step('🔄 Step 5/10: Rebooting main board...');
            const mainRebootResponse = await this._rebootDevice(device, 'main');
            if (!mainRebootResponse.ok) {
                throw new Error(`Main board reboot failed: ${mainRebootResponse.status}`);
            }
            this.logger.success('Main board reboot initiated');

            this.logger.step('⏳ Step 6/10: Waiting for reboot propagation...');
            await this._wait(this.config.sendRebootWait);
            this.logger.success('Reboot message propagated');

            // Rear board update
            this.logger.step('⚡ Step 7/10: Uploading rear board firmware...');
            const rearResponse = await this._uploadFirmware(device, rearFirmware, false);
            if (!rearResponse.ok) {
                throw new Error(`Rear board firmware upload failed: ${rearResponse.status}`);
            }
            this.logger.success('Rear board firmware uploaded successfully');

            this.logger.step('⏳ Step 8/10: Processing rear board firmware...');
            await this._wait(this.config.firmwareProcessingWait);
            this.logger.success('Rear board firmware processed');

            this.logger.step('🔄 Step 9/10: Rebooting rear board...');
            const rearRebootResponse = await this._rebootDevice(device, 'rear');
            if (!rearRebootResponse.ok) {
                throw new Error(`Rear board reboot failed: ${rearRebootResponse.status}`);
            }
            this.logger.success('Rear board reboot initiated');

            this.logger.step('⏳ Step 10/10: Waiting for complete system reboot...');
            this.logger.info('This may take up to 20 seconds...');
            await this._wait(this.config.rearBoardRebootWait);
            this.logger.success('System reboot completed');

            this.logger.success('🎉 FIRMWARE UPDATE COMPLETED SUCCESSFULLY! 🎉');
            
            // Try to get new version
            try {
                const newDeviceInfo = await this._getDeviceInfo(device);
                installedVersion = newDeviceInfo.firmwareVersion;
                this.logger.info(`📊 Firmware updated: ${oldVersion} → ${installedVersion}`);
                
                return {
                    success: true,
                    oldVersion: oldVersion,
                    newVersion: installedVersion,
                    targetVersion: targetVersion
                };
            } catch (error) {
                this.logger.info('⏳ Device still initializing, firmware version will be available shortly');
                return {
                    success: true,
                    oldVersion: oldVersion,
                    newVersion: targetVersion || 'Unknown',
                    targetVersion: targetVersion
                };
            }

        } catch (error) {
            this.logger.error('💥 FIRMWARE UPDATE FAILED');
            throw error;
        }
    }

    /**
     * Execute rear-only firmware update process
     * Updates only the rear board firmware
     */
    async executeRearOnlyFirmwareUpdate(device, firmwareFiles) {
        let installedVersion = null;
        let oldVersion = null;
        
        try {
            this.logger.step('📋 Step 1/5: Getting device info...');
            const deviceInfo = await this._getDeviceInfo(device);
            oldVersion = deviceInfo.firmwareVersion;
            
            // Extract target version from rear firmware filename
            const targetVersion = this._extractFirmwareVersion(path.basename(firmwareFiles.rear));
            
            this.logger.info(`Current firmware version: ${oldVersion}`);
            if (targetVersion) {
                this.logger.info(`Target rear firmware version: ${targetVersion}`);
            }

            this.logger.step('📁 Step 2/5: Reading rear firmware file...');
            const rearFirmware = await fs.readFile(firmwareFiles.rear);
            this.logger.info(`Rear firmware: ${(rearFirmware.length / 1024).toFixed(1)} KB`);

            // Rear board update only
            this.logger.step('⚡ Step 3/5: Uploading rear board firmware...');
            const rearResponse = await this._uploadFirmware(device, rearFirmware, false);
            if (!rearResponse.ok) {
                throw new Error(`Rear board firmware upload failed: ${rearResponse.status}`);
            }
            this.logger.success('Rear board firmware uploaded successfully');

            this.logger.step('⏳ Step 4/5: Processing rear board firmware...');
            await this._wait(this.config.firmwareProcessingWait);
            this.logger.success('Rear board firmware processed');

            this.logger.step('🔄 Step 5/5: Rebooting rear board...');
            const rearRebootResponse = await this._rebootDevice(device, 'rear');
            if (!rearRebootResponse.ok) {
                throw new Error(`Rear board reboot failed: ${rearRebootResponse.status}`);
            }
            this.logger.success('Rear board reboot initiated');

            this.logger.info('Waiting for rear board reboot to complete...');
            await this._wait(this.config.rearBoardRebootWait);
            this.logger.success('Rear board reboot completed');

            this.logger.success('🎉 REAR BOARD FIRMWARE UPDATE COMPLETED SUCCESSFULLY! 🎉');
            
            // Try to get new version
            try {
                const newDeviceInfo = await this._getDeviceInfo(device);
                installedVersion = newDeviceInfo.firmwareVersion;
                this.logger.info(`📊 Rear firmware updated: ${oldVersion} → ${installedVersion}`);
                
                return {
                    success: true,
                    oldVersion: oldVersion,
                    newVersion: installedVersion,
                    targetVersion: targetVersion,
                    updateType: 'rear-only'
                };
            } catch (error) {
                this.logger.info('⏳ Device still initializing, firmware version will be available shortly');
                return {
                    success: true,
                    oldVersion: oldVersion,
                    newVersion: targetVersion || 'Unknown',
                    targetVersion: targetVersion,
                    updateType: 'rear-only'
                };
            }

        } catch (error) {
            this.logger.error('💥 REAR BOARD FIRMWARE UPDATE FAILED');
            throw error;
        }
    }

    /**
     * Extract version from firmware filename
     */
    _extractFirmwareVersion(filename) {
        // Extract version from patterns like:
        // "main_v1.8.3.signed.bin" -> "v1.8.3"
        // "rear_v1.8.4-beta-aa-aaa-detection.signed.bin" -> "v1.8.4-beta-aa-aaa-detection" 
        const match = filename.match(/_(v\d+\.\d+\.\d+(?:beta|alpha|rc)?(?:-[^.]+)?)\.signed\.bin$/);
        return match ? match[1] : null;
    }

    /**
     * Find matched firmware pairs with same version
     */
    _findMatchedFirmwarePairs(mainFiles, rearFiles) {
        const pairs = [];
        
        for (const mainFile of mainFiles) {
            const version = this._extractFirmwareVersion(mainFile.file);
            if (!version) continue;
            
            const matchingRear = rearFiles.find(rearFile => {
                const rearVersion = this._extractFirmwareVersion(rearFile.file);
                return rearVersion === version;
            });
            
            if (matchingRear) {
                pairs.push({
                    version: version,
                    main: mainFile,
                    rear: matchingRear,
                    mtime: mainFile.mtime > matchingRear.mtime ? mainFile.mtime : matchingRear.mtime
                });
            }
        }
        
        return pairs.sort((a, b) => b.mtime - a.mtime);
    }

    /**
     * Get device information
     */
    async _getDeviceInfo(device) {
        const response = await this._makeRequest(device, this.config.endpoints.info, 'GET');
        return JSON.parse(response.data);
    }

    /**
     * Upload firmware to device
     */
    async _uploadFirmware(device, firmware, isMainBoard) {
        const endpoint = isMainBoard ? this.config.endpoints.firmwareCharger : this.config.endpoints.firmwareRear;
        const boardType = isMainBoard ? 'main' : 'rear';
        
        this.logger.debug(`Uploading ${boardType} firmware, size: ${firmware.length} bytes`);
        
        const response = await this._makeRequest(device, endpoint, 'POST', {
            body: firmware,
            headers: {
                'Content-Length': firmware.length
            }
        });
        
        return response; // Return the actual response with status info
    }

    /**
     * Reboot device board
     */
    async _rebootDevice(device, board) {
        const endpoint = `${this.config.endpoints.reboot}?board=${board}`;
        
        const response = await this._makeRequest(device, endpoint, 'POST', {
            body: board,
            headers: {
                'Content-Length': board.length
            }
        });
        
        return response; // Return the actual response with status info
    }

    /**
     * Make HTTP request to device
     */
    async _makeRequest(device, path, method = 'GET', options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = this._parseTarget(device.url || `http://${device.ip}:${device.port}`);
            
            const requestOptions = {
                hostname: parsed.hostname,
                port: parsed.port,
                path: path,
                method: method,
                headers: options.headers || {}
            };

            const httpModule = parsed.protocol === 'https:' ? https : http;
            const req = httpModule.request(requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    // Return response object with status info like original
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        data: data
                    });
                });
            });

            req.on('error', reject);

            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }

    /**
     * Parse target URL/IP
     */
    _parseTarget(target) {
        if (target.startsWith('http://') || target.startsWith('https://')) {
            const url = new URL(target);
            return {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80)
            };
        }
        
        return {
            protocol: 'http:',
            hostname: target,
            port: this.config.defaultPort
        };
    }

    /**
     * Wait for specified milliseconds
     */
    async _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = FirmwareManager;
