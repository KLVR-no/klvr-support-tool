const bonjour = require('bonjour')();
const http = require('http');

const CONFIG = {
    DEFAULT_PORT: 8000,
    CONNECTION_TIMEOUT: 3000,
    DISCOVERY_TIMEOUT: 15000  // Longer timeout
};

const BONJOUR_SERVICE = 'klvrcharger';
const SUBNET_BASE = '10.110.73';
const SUBNET_START = 1;
const SUBNET_END = 254;

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
        }, 12000); // 12 second discovery window
    });
}

async function testKLVRDevice(ip) {
    return new Promise((resolve) => {
        const options = {
            hostname: ip,
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
                    const deviceName = info.deviceName || info.name || '';
                    
                    if (deviceName.toLowerCase().includes('klvr')) {
                        resolve({
                            ip: ip,
                            deviceName: deviceName,
                            firmwareVersion: info.firmwareVersion || 'Unknown',
                            serialNumber: info.serialNumber || info.ip?.macAddress || 'Unknown',
                            connected: true
                        });
                    } else {
                        resolve(null);
                    }
                } catch (error) {
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

async function scanSubnet() {
    console.log(`[SCAN] Scanning subnet ${SUBNET_BASE}.${SUBNET_START}-${SUBNET_END} as fallback...`);
    
    const devices = [];
    const batchSize = 50;
    const allIPs = [];
    
    for (let i = SUBNET_START; i <= SUBNET_END; i++) {
        allIPs.push(`${SUBNET_BASE}.${i}`);
    }
    
    console.log(`[SCAN] Total IPs to scan: ${allIPs.length}`);
    
    for (let i = 0; i < allIPs.length; i += batchSize) {
        const batch = allIPs.slice(i, i + batchSize);
        const promises = batch.map(ip => testKLVRDevice(ip));
        const results = await Promise.all(promises);
        
        const foundDevices = results.filter(device => device !== null);
        devices.push(...foundDevices);
        
        if (foundDevices.length > 0) {
            console.log(`[SCAN] Found ${foundDevices.length} device(s) in batch ${Math.floor(i / batchSize) + 1}`);
            foundDevices.forEach(device => {
                console.log(`  - ${device.deviceName} at ${device.ip} (v${device.firmwareVersion})`);
            });
        }
        
        const progress = Math.min(i + batchSize, allIPs.length);
        const percentage = ((progress / allIPs.length) * 100).toFixed(1);
        process.stdout.write(`\r[SCAN] Progress: ${progress}/${allIPs.length} (${percentage}%) - Found: ${devices.length} devices`);
    }
    
    console.log(`\n[SCAN] Subnet scan completed. Found ${devices.length} KLVR device(s).`);
    return devices;
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

async function findAllChargersComprehensive() {
    try {
        console.log('🔍 Comprehensive KLVR Charger Network Discovery');
        console.log('=' .repeat(60));
        
        // Step 1: Try Bonjour discovery first
        const bonjourDevices = await discoverDevicesViaBonjour();
        
        // Step 2: If we didn't find 3, scan subnet as fallback
        let allDevices = [...bonjourDevices];
        
        if (bonjourDevices.length < 3) {
            console.log(`\n[DISCOVERY] Only found ${bonjourDevices.length} device(s) via Bonjour. Scanning subnet as fallback...`);
            const scannedDevices = await scanSubnet();
            
            // Merge results, avoiding duplicates
            const bonjourIPs = new Set(bonjourDevices.map(d => d.ip));
            const newDevices = scannedDevices.filter(d => !bonjourIPs.has(d.ip));
            allDevices.push(...newDevices);
        }

        if (allDevices.length === 0) {
            console.log('[DISCOVERY] No devices found. Please ensure all chargers are powered on and on the same network.');
            return;
        }

        // Step 3: Get detailed info for each device
        console.log(`\n[DISCOVERY] Getting detailed information for ${allDevices.length} device(s)...`);
        const devices = [];
        
        for (const device of allDevices) {
            try {
                const info = await getDeviceInfo(device.ip);
                devices.push({
                    ...device,
                    ...info,
                    url: device.url || `http://${device.ip}:${CONFIG.DEFAULT_PORT}`
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

        // Step 4: Display found devices
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

        if (devices.length < 3) {
            console.log(`\n⚠️  Warning: Expected 3 chargers but only found ${devices.length}`);
        } else if (devices.length === 3) {
            console.log(`\n✅ Successfully found all 3 chargers!`);
        }

        console.log(`\n✅ Discovery completed!`);
        
    } catch (error) {
        console.error('[ERROR]', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    findAllChargersComprehensive();
}

module.exports = { findAllChargersComprehensive };
