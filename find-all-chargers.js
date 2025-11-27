const bonjour = require('bonjour')();
const http = require('http');

const CONFIG = {
    DEFAULT_PORT: 8000,
    CONNECTION_TIMEOUT: 5000,
    DISCOVERY_TIMEOUT: 10000
};

const BONJOUR_SERVICE = 'klvrcharger';

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
            path: '/api/v2/device/info',
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

async function findAllChargers() {
    try {
        console.log('🔍 KLVR Charger Network Discovery');
        console.log('=' .repeat(60));
        
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
        console.log('\n📋 Found KLVR Chargers:');
        console.log('=' .repeat(60));
        devices.forEach((device, index) => {
            console.log(`\n${index + 1}. ${device.deviceName}`);
            console.log(`   IP Address:     ${device.ip}`);
            console.log(`   Firmware:       v${device.firmwareVersion}`);
            console.log(`   Serial Number:  ${device.serialNumber}`);
            console.log(`   URL:            ${device.url}`);
        });

        console.log(`\n📊 Summary:`);
        console.log(`Total chargers found: ${devices.length}`);
        
        if (devices.length > 0) {
            const versions = [...new Set(devices.map(d => d.firmwareVersion))];
            console.log(`Firmware versions: ${versions.join(', ')}`);
        }

        console.log(`\n✅ Discovery completed!`);
        
    } catch (error) {
        console.error('[ERROR]', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    findAllChargers();
}

module.exports = { findAllChargers, discoverDevicesViaBonjour, getDeviceInfo };
