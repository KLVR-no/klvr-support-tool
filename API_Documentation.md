I'll analyze the repository to create comprehensive API documentation for the KLVR Charger Pro firmware.
Ran tool
Now let me examine the JSON response structures and data models:
Ran tool
Let me get more details about the network and debug structures:
Read file: app/src/network.c
Ran tool
Now let me check the debug mode structure:
Read file: include/app/debug_mode.h
Now I have enough information to create comprehensive API documentation. Let me compile it:

# **KLVR Charger Pro - Complete API Documentation**

## **Base Information**
- **Base URL**: `http://device-ip:8000` or `https://tunnel-url`
- **API Version**: `v2`
- **Content-Type**: `application/json` (for JSON endpoints)
- **CORS**: Enabled on all endpoints

---

## **📋 API Endpoints Overview**

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/v2/charger/status` | GET | Battery charging status | ✅ Working |
| `/api/v2/device/info` | GET | Device information | ✅ Working |
| `/api/v2/device/identify` | GET/POST | Trigger device identification | ✅ Working |
| `/api/v2/device/network` | GET/POST | Network configuration | ✅ Working |
| `/api/v2/device/name` | GET/POST | Device name | ✅ Working |
| `/api/v2/device/firmware_version` | GET | Firmware versions | ✅ Working |
| `/api/v2/device/firmware_charger` | POST | Upload main board firmware | ✅ Working |
| `/api/v2/device/firmware_rear` | POST | Upload rear board firmware | ✅ Working |
| `/api/v2/device/reboot` | POST | Reboot device boards | ⚠️ HTTPS Issue |
| `/api/v2/testctl` | POST | Debug/test commands | ✅ Working |

---

## **🔋 Battery & Charging Status**

### **GET `/api/v2/charger/status`**
Returns current status of all battery slots including charging progress and diagnostic data.

**Response:**
```json
{
  "deviceStatus": "ok",
  "batteries": [
    {
      "index": 0,
      "batteryBayTempC": 27.0,
      "batteryDetected": "KLVR-AA",
      "slotState": "charging",
      "stateOfChargePercent": 85.5,
      "timeRemainingSeconds": 1200,
      "errorMsg": "",
      "debug": {
        "voltageAAA_mv": 1250,
        "voltageAA_mv": 1180,
        "voltageDelta_mv": 70,
        "lastDetection_ms": 1692123456789
      }
    }
  ]
}
```

**Battery Types:**
- `"KLVR-AA"` - AA battery detected
- `"KLVR-AAA"` - AAA battery detected  
- `""` - No battery or unknown type

**Slot States:**
- `"empty"` - No battery detected
- `"charging"` - Battery is charging
- `"done"` - Charging complete
- `"error"` - Error condition

**Error Messages:**
- `"overtemp"` - Battery temperature too high
- `"overcurrent"` - Overcurrent detected
- `"faulty"` - Faulty battery
- `"detect_err"` - Detection error

---

## **📱 Device Information**

### **GET `/api/v2/device/info`**
Returns comprehensive device information including firmware version, network config, and hardware details.

**Response:**
```json
{
  "deviceInternalTemperatureC": 25.20,
  "name": "KLVR2",
  "firmwareVersion": "1.8.3",
  "firmwareBuild": "1.8.3-b",
  "ip": {
    "type": "dhcp",
    "ipAddress": "192.168.1.100",
    "gatewayAddress": "192.168.1.1",
    "mask": "255.255.255.0",
    "macAddress": "aa:bb:cc:dd:ee:ff"
  }
}
```

**Network Types:**
- `"dhcp"` - DHCP assigned IP
- `"static"` - Manually configured IP
- `"unknown"` - Unknown configuration

---

## **🔧 Device Control**

### **GET/POST `/api/v2/device/identify`**
Triggers visual identification (LED flash) on the device.

**Request:** No body required
**Response:** Empty (200 OK)

### **GET `/api/v2/device/name`**
Get current device name.

**Response:**
```json
{
  "name": "KLVR2"
}
```

### **POST `/api/v2/device/name`**
Set device name.

**Request:**
```json
{
  "name": "MyCharger"
}
```

**Response:** 200 OK on success

---

## **🌐 Network Configuration**

### **GET `/api/v2/device/network`**
Get current network configuration.

**Response:**
```json
{
  "type": "dhcp",
  "ipAddress": "192.168.1.100",
  "gatewayAddress": "192.168.1.1",
  "mask": "255.255.255.0",
  "macAddress": "aa:bb:cc:dd:ee:ff"
}
```

### **POST `/api/v2/device/network`**
Configure network settings.

**DHCP Configuration:**
```json
{
  "type": "dhcp"
}
```

**Static IP Configuration:**
```json
{
  "type": "static",
  "ipAddress": "192.168.1.100",
  "gatewayAddress": "192.168.1.1",
  "mask": "255.255.255.0"
}
```

**Response:** 200 OK on success, 400 on invalid JSON

---

## **🔄 Firmware Management**

### **GET `/api/v2/device/firmware_version`**
Get firmware versions for both boards.

**Response:**
```json
{
  "firmwareRear": "1.8.3",
  "firmwareMain": "1.8.3"
}
```

### **POST `/api/v2/device/firmware_charger`**
Upload firmware for the main (charger) board.

**Request:**
- **Content-Type**: `application/octet-stream`
- **Body**: Binary firmware file (.bin)

**Response:** 
- `200` - Upload successful
- `400` - Invalid content length or transfer aborted
- `500` - Flash operation failed

### **POST `/api/v2/device/firmware_rear`**
Upload firmware for the rear board.

**Request:**
- **Content-Type**: `application/octet-stream`  
- **Body**: Binary firmware file (.bin)

**Response:**
- `200` - Upload successful
- `400` - Invalid content length or transfer aborted
- `500` - Flash operation failed

---

## **🔄 Device Reboot**

### **POST `/api/v2/device/reboot`** ⚠️
Reboot specific device board.

**Request:**
- **Content-Type**: `application/octet-stream`
- **Body**: `"main"` or `"rear"`
- **Query Parameter**: `?board=main` or `?board=rear`

**Example:**
```bash
curl -X POST "http://device:8000/api/v2/device/reboot?board=main" \
     -H "Content-Type: application/octet-stream" \
     -d "main"
```

**⚠️ Known Issue**: 
- **HTTPS Tunnels**: Returns 200 OK but doesn't actually reboot due to HTTP chunking bug
- **Local HTTP**: Works correctly
- **Fix**: Firmware needs to check `HTTP_SERVER_DATA_FINAL` status before processing

**Response:** 200 OK (but may not actually reboot through HTTPS)

---

## **🔬 Debug & Testing**

### **POST `/api/v2/testctl`**
Execute debug and test commands.

**Request:**
```json
{
  "command": 0,
  "arg": 0,
  "value": "test"
}
```

**Debug Commands:**
- `0` - **PING**: Test connectivity
- `1` - **ENABLE**: Enable debug mode
- `2` - **SET_LED**: Control battery LEDs
- `3` - **SET_5V**: Control 5V rail
- `4` - **SET_CC**: Set constant current
- `5` - **MEASURE**: Take measurements

**LED Control (command=2):**
```json
{
  "command": 2,
  "arg": 0,
  "value": "green_solid"
}
```

**LED Colors**: `green`, `orange`, `red`
**LED Modes**: `off`, `solid`, `blink`

**Response:** 
- `200` - Command executed
- `400` - Invalid JSON format

---

## **📊 Data Models**

### **Battery Data Structure**
```typescript
interface Battery {
  index: number;                    // 0-based slot index
  batteryBayTempC: number;         // Temperature in Celsius
  batteryDetected: string;         // "KLVR-AA", "KLVR-AAA", or ""
  slotState: string;               // "empty", "charging", "done", "error"
  stateOfChargePercent: number;    // 0-100%
  timeRemainingSeconds: number;    // Seconds until full
  errorMsg: string;                // Error description
  debug: {
    voltageAAA_mv: number;         // AAA spring voltage (mV)
    voltageAA_mv: number;          // AA spring voltage (mV) 
    voltageDelta_mv: number;       // Voltage difference (mV)
    lastDetection_ms: number;      // Timestamp of last detection
  };
}
```

### **Network Configuration**
```typescript
interface NetworkConfig {
  type: "dhcp" | "static" | "unknown";
  ipAddress: string;               // "192.168.1.100"
  gatewayAddress: string;          // "192.168.1.1"
  mask: string;                    // "255.255.255.0"
  macAddress: string;              // "aa:bb:cc:dd:ee:ff"
}
```

---

## **🚨 Error Handling**

### **HTTP Status Codes**
- `200` - Success
- `400` - Bad Request (invalid JSON, missing fields)
- `500` - Internal Server Error (hardware failure, encoding error)

### **Common Error Responses**
```json
{
  "error": "Invalid JSON object given"
}
```

```json
{
  "error": "Failed to encode battery status"
}
```

---

## **🔧 Technical Details**

### **Server Configuration**
- **Port**: 8000
- **Protocol**: HTTP/1.1
- **Max Connections**: 5 concurrent
- **Buffer Size**: 16KB response buffer
- **Timeout**: 3 seconds for most operations

### **CORS Headers**
All endpoints include CORS headers for web browser compatibility:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### **Content-Length Requirement**
POST endpoints require accurate `Content-Length` header for proper data processing.

---

## **🐛 Known Issues**

1. **Reboot Endpoint HTTPS Bug**: 
   - **Issue**: `/api/v2/device/reboot` doesn't work through HTTPS tunnels
   - **Cause**: Handler doesn't wait for complete HTTP data
   - **Workaround**: Use local HTTP connection for reboots
   - **Fix**: Add `HTTP_SERVER_DATA_FINAL` status check

2. **Firmware Upload Timeout**:
   - Large firmware files may timeout through slow connections
   - Increase timeout for tunnel connections

---

## **💡 Usage Examples**

### **Check Battery Status**
```bash
curl "http://192.168.1.100:8000/api/v2/charger/status"
```

### **Upload Firmware**
```bash
curl -X POST "http://192.168.1.100:8000/api/v2/device/firmware_charger" \
     -H "Content-Type: application/octet-stream" \
     --data-binary "@firmware.bin"
```

### **Set Static IP**
```bash
curl -X POST "http://192.168.1.100:8000/api/v2/device/network" \
     -H "Content-Type: application/json" \
     -d '{
       "type": "static",
       "ipAddress": "192.168.1.200",
       "gatewayAddress": "192.168.1.1", 
       "mask": "255.255.255.0"
     }'
```

### **Identify Device**
```bash
curl -X POST "http://192.168.1.100:8000/api/v2/device/identify"
```

This API provides comprehensive control over the KLVR Charger Pro device, enabling monitoring, configuration, and firmware management through a clean REST interface.