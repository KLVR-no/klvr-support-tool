const bonjour = require('bonjour')();
const http = require('http');

const CONFIG = {
    DEFAULT_PORT: 8000,
    CONNECTION_TIMEOUT: 5000,
    DISCOVERY_TIMEOUT: 20000,  // Longer timeout
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000
};

const BONJOUR_SERVICE = 'klvrcharger';

async function discoverDevicesViaBonjour() {
    console.log('[DISCOVERY] Discovering KLVR devices via Bonjour/mDNS...');
    console.log('[DISCOVERY] Waiting up to 20 seconds for all devices to appear...');
    
    return new Promise((resolve) => {
        const devices = [];
        const deviceMap = new Map(); // Track by service name to avoid duplicates
        
        const timeout = setTimeout(() => {
            console.log('[DISCOVERY] Discovery timeout reached');
            bonjour.destroy();
            resolve(Array.from(deviceMap.values()));
        }, CONFIG.DISCOVERY_TIMEOUT);
        
        const browser = bonjour.find({ type: BONJOUR_SERVICE }, (service) => {
            const ip = (service.addresses || []).find(addr => 
                addr && addr.split('.').length === 4
            ) || service.host;
            
            // Use service name as key to avoid duplicates
            if (!deviceMap.has(service.name)) {
                const device = {
                    ip: ip,
                    deviceName: service.name,
                    port: service.port || CONFIG.DEFAULT_PORT,
                    url: `http://${ip}:${service.port || CONFIG.DEFAULT_PORT}`,
                    serviceName: service.name
                };
                
                deviceMap.set(service.name, device);
                console.log(`[DISCOVERY] Found device ${deviceMap.size}: ${service.name} at ${ip}:${device.port}`);
            }
        });
        
        setTimeout(() => {
            clearTimeout(timeout);
            browser.stop();
            bonjour.destroy();
            
            const foundDevices = Array.from(deviceMap.values());
            if (foundDevices.length > 0) {
                console.log(`[DISCOVERY] Discovery complete: Found ${foundDevices.length} device(s) via Bonjour`);
            } else {
                console.log('[DISCOVERY] No devices found via Bonjour/mDNS');
            }
            
            resolve(foundDevices);
        }, 18000); // 18 second discovery window
    });
}

async function getDeviceInfoWithRetry(deviceIp, deviceName) {
    for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
        try {
            return await getDeviceInfo(deviceIp);
        } catch (error) {
            if (attempt < CONFIG.RETRY_ATTEMPTS) {
                console.log(`[DISCOVERY] Attempt ${attempt} failed for ${deviceName} at ${deviceIp}, retrying in ${CONFIG.RETRY_DELAY/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            } else {
                throw error;
            }
        }
    }
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

async function findAllChargersWithRetry() {
    try {
        console.log('🔍 KLVR Charger Network Discovery (with retry)');
        console.log('=' .repeat(60));
        
        // Step 1: Discover devices via Bonjour
        const discoveredDevices = await discoverDevicesViaBonjour();
        
        if (discoveredDevices.length === 0) {
            console.log('[DISCOVERY] No devices found via Bonjour. They may not be advertising mDNS.');
            console.log('[DISCOVERY] Please ensure all chargers are powered on and on the same network.');
            return;
        }

        console.log(`\n[DISCOVERY] Found ${discoveredDevices.length} device(s) via Bonjour. Getting detailed information...`);
        
        // Step 2: Get detailed info for each discovered device with retries
        const devices = [];
        
        for (const device of discoveredDevices) {
            try {
                console.log(`[DISCOVERY] Connecting to ${device.deviceName} at ${device.ip}...`);
                const info = await getDeviceInfoWithRetry(device.ip, device.deviceName);
                devices.push({
                    ...device,
                    ...info
                });
                console.log(`[DISCOVERY] ✅ ${info.deviceName} at ${device.ip} (v${info.firmwareVersion})`);
            } catch (error) {
                console.log(`[DISCOVERY] ❌ Failed to connect to ${device.deviceName} at ${device.ip} after ${CONFIG.RETRY_ATTEMPTS} attempts: ${error.message}`);
                // Still add it to the list with limited info
                devices.push({
                    ...device,
                    firmwareVersion: 'Unknown (unreachable)',
                    serialNumber: 'Unknown',
                    error: error.message
                });
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
            console.log(`\n${index + 1}. ${device.deviceName || device.serviceName}`);
            console.log(`   IP Address:     ${device.ip}`);
            if (device.firmwareVersion && device.firmwareVersion !== 'Unknown (unreachable)') {
                console.log(`   Firmware:       v${device.firmwareVersion}`);
                console.log(`   Serial Number:  ${device.serialNumber}`);
            } else {
                console.log(`   Status:         ⚠️  Unreachable (${device.error || 'Connection failed'})`);
            }
            console.log(`   URL:            ${device.url}`);
        });

        console.log(`\n📊 Summary:`);
        const reachableDevices = devices.filter(d => d.firmwareVersion && d.firmwareVersion !== 'Unknown (unreachable)');
        const unreachableDevices = devices.filter(d => !d.firmwareVersion || d.firmwareVersion === 'Unknown (unreachable)');
        
        console.log(`Total chargers discovered: ${devices.length}`);
        console.log(`Reachable: ${reachableDevices.length}`);
        console.log(`Unreachable: ${unreachableDevices.length}`);
        
        if (reachableDevices.length > 0) {
            const versions = [...new Set(reachableDevices.map(d => d.firmwareVersion))];
            console.log(`Firmware versions: ${versions.join(', ')}`);
        }

        if (devices.length === 3) {
            if (reachableDevices.length === 3) {
                console.log(`\n✅ Successfully found and connected to all 3 chargers!`);
            } else {
                console.log(`\n⚠️  Found all 3 chargers via Bonjour, but ${unreachableDevices.length} are currently unreachable`);
                console.log(`   This may be due to network routing or the devices being on a different subnet.`);
            }
        } else if (devices.length < 3) {
            console.log(`\n⚠️  Warning: Expected 3 chargers but only found ${devices.length}`);
        }

        console.log(`\n✅ Discovery completed!`);
        
    } catch (error) {
        console.error('[ERROR]', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    findAllChargersWithRetry();
}

module.exports = { findAllChargersWithRetry };
