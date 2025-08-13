# KLVR Firmware Updater

A powerful, interactive firmware updater for KLVR Charger Pro devices with automatic device discovery and user-friendly interface.

## 🚀 Quick Start (One-Command Install)

### macOS/Linux
```bash
bash <(curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.sh)
```

**Alternative:**
```bash
curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.sh | bash
```

### Windows (PowerShell)
```powershell
iex (iwr -useb https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.ps1)
```

That's it! The script will automatically:
- ✅ Check system prerequisites
- ✅ Download the latest firmware updater
- ✅ Install dependencies
- ✅ Start the interactive update process
- ✅ Show you exactly which firmware version was installed

## 📋 Prerequisites

- **Node.js** 14+ (automatically checked)
- **npm** (comes with Node.js)
- **git** (for downloading)

### Install Prerequisites

**macOS (Homebrew):**
```bash
brew install node git
```

**Ubuntu/Debian:**
```bash
sudo apt-get install nodejs npm git curl
```

**Windows:**
- Download Node.js from: https://nodejs.org/
- Download Git from: https://git-scm.com/
- Or use Chocolatey: `choco install nodejs git`

## 💻 Manual Installation

If you prefer to install manually:

```bash
git clone https://github.com/KLVR-no/klvr-firmware-updater.git
cd klvr-firmware-updater
npm install
node firmware-update.js
```

## 🎯 Features

### ✨ Interactive Mode (Recommended)
- **Device Target Selection**: Choose specific IP or auto-discover devices
- **Firmware Version Selection**: Pick from available matched firmware pairs
- **Progress Tracking**: 10-step progress with visual indicators
- **Safety Confirmations**: Review changes before applying

### 🤖 Non-Interactive Mode (Automation)
```bash
node firmware-update.js 10.110.73.155                    # Target specific IP
node firmware-update.js main.bin rear.bin                # Specify firmware files
node firmware-update.js main.bin rear.bin 10.110.73.155  # Full specification
```

### 🔍 Device Discovery
- **Bonjour/mDNS**: Automatic network discovery
- **Direct IP**: Target specific devices
- **Connection Testing**: Verify device connectivity

### 📦 Firmware Management
- **Version Matching**: Ensures main and rear firmware versions match
- **Automatic Detection**: Finds latest firmware automatically
- **File Validation**: Verifies firmware files before update

### 📊 Progress & Monitoring
- **Real-time Progress**: Step-by-step update tracking
- **Visual Indicators**: Emojis and colors for better UX
- **Error Handling**: Clear error messages and troubleshooting
- **Success Reporting**: Detailed completion summaries

## 📁 Project Structure

```
klvr-firmware-updater/
├── firmware/                          # Firmware files directory
│   ├── main_v1.8.3.signed.bin        # Main board firmware
│   └── rear_v1.8.3.signed.bin        # Rear board firmware
├── firmware-update.js                 # Main update script
├── install-and-update.sh             # One-command installer (Unix)
├── install-and-update.ps1            # One-command installer (Windows)
├── package.json                      # Dependencies
└── README.md                         # This file
```

## 🔧 Configuration

The script automatically detects firmware files in the `firmware/` directory. Supported naming patterns:
- `main_v{version}.signed.bin`
- `rear_v{version}.signed.bin`

Example: `main_v1.8.3.signed.bin`, `rear_v1.8.3.signed.bin`

## 🛡️ Safety Features

- **Version Matching**: Prevents mismatched firmware installations
- **Connection Verification**: Tests device connectivity before update
- **Progress Tracking**: Clear visibility into update progress
- **Error Recovery**: Helpful error messages and troubleshooting
- **Confirmation Steps**: User confirmation before critical operations

## 🆘 Troubleshooting

### Common Issues

**"No devices found"**
- Ensure devices are powered on
- Check network connectivity
- Verify Bonjour/mDNS is enabled

**"Connection failed"**
- Verify IP address is correct
- Check device is on same network
- Ensure device is not in sleep mode

**"Firmware upload failed"**
- Check firmware file integrity
- Verify device has sufficient storage
- Ensure stable network connection

### Getting Help

1. Check the error messages for specific guidance
2. Verify prerequisites are installed correctly
3. Try running with a specific IP address
4. Check network connectivity between computer and device

## 📄 License

[Add your license information here]

## 🤝 Contributing

[Add contribution guidelines here]