# KLVR Support Tool

Professional support tools for KLVR Charger Pro devices - firmware updates, remote access, and diagnostics.

## 🚀 Quick Start (One-Command Install)

### macOS/Linux
```bash
bash <(curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.sh)
```

### Windows (PowerShell)
```powershell
iex (iwr -useb https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.ps1)
```

That's it! The script will automatically:
- ✅ **Install missing dependencies** (Node.js, npm, git)
- ✅ **Download the latest support tools**
- ✅ **Install project dependencies**
- ✅ **Start the interactive interface**
- ✅ **Show you exactly what operations were performed**

**No manual setup required!** The installer handles everything automatically.

## 📊 Current Status

### ✅ **Latest Updates (December 2024)**
- **🔄 Manual Firmware Selection**: Removed auto-selection - users now choose firmware version
- **📱 Simplified End-User Interface**: Clean 3-option menu (Update Firmware, Remote Support, Exit)
- **🛠️ Enhanced Support Tools**: Interactive firmware selection for support engineers
- **📦 Latest Firmware**: v1.8.3 (stable), v1.8.3-beta4 (testing)
- **🌐 Tunnel Support**: Cloudflare quick tunnels with session tracking
- **🔋 Battery Monitoring**: AA/AAA detection with detailed voltage logging

### 🎯 **Key Improvements**
- **No "Latest" Labels**: Clean firmware selection without auto-highlighting
- **Manual Control**: Users have full control over firmware version selection
- **Session Consistency**: Tunnel URLs tracked for better user experience
- **Comprehensive Testing**: Full system validation and error handling

## 🎯 Features

### ✨ **For End Users:**
- **🔄 Firmware Updates**: Interactive firmware version selection (no auto-selection)
- **🌐 Remote Support**: Share secure tunnel with KLVR support team
- **📱 Simple Interface**: Clean 3-option menu (Firmware Update, Remote Support, Exit)

### 🛠️ **For Support Engineers:**
- **🔧 Advanced CLI**: Full command-line interface for all operations
- **🌐 Remote Access**: Connect to devices via secure tunnels
- **🔋 Battery Diagnostics**: Detailed AA/AAA detection monitoring with logging
- **📊 Firmware Management**: Interactive version selection with validation
- **📝 Session Tracking**: Comprehensive logging and export capabilities
- **🔍 Device Diagnostics**: Complete device health and status reporting

## 💻 Usage

### Interactive Mode (Recommended for End Users)
```bash
# After installation, just run:
klvr-tool

# Or start interactive mode explicitly:
klvr-tool interactive
```

### Command Line Interface (For Support Engineers)

#### Firmware Updates
```bash
# Update firmware on discovered device
klvr-tool firmware-update

# Update firmware on specific device
klvr-tool firmware-update 10.110.73.155

# Update via remote tunnel
klvr-tool firmware-update https://abc123.trycloudflare.com

# Force update with specific firmware files
klvr-tool firmware-update --main firmware/main_v1.8.3-beta4.signed.bin --rear firmware/rear_v1.8.3-beta4.signed.bin --force
```

#### Remote Support Sessions
```bash
# Start remote support session (auto-discovers device)
klvr-tool remote-support

# Create tunnel with custom options
klvr-tool remote-support --tunnel-provider cloudflare
```

#### Battery Detection Monitoring
```bash
# Monitor battery detection (auto-discovers device)
klvr-tool battery-monitor

# Monitor specific device for AA battery testing
klvr-tool battery-monitor 10.110.73.155 --test-type aa --duration 30

# Monitor via tunnel with detailed logging
klvr-tool battery-monitor https://abc123.trycloudflare.com --test-type aaa --export json
```

#### Device Information
```bash
# Get device information
klvr-tool device-info

# Get info from specific device
klvr-tool device-info 10.110.73.155

# Export device info as JSON
klvr-tool device-info --format json
```

## 🔧 Advanced Usage

### Global Options
All commands support these global options:
```bash
--verbose          # Enable detailed logging
--log-file <path>  # Save logs to specific file
--session-id <id>  # Track support session
```

### Environment Variables
```bash
export KLVR_LOG_LEVEL=debug    # Set logging level
export KLVR_LOG_DIR=./logs     # Set log directory
export KLVR_TUNNEL_PROVIDER=cloudflare  # Default tunnel provider
```

## 📁 Project Structure

```
klvr-support-tool/
├── 📁 src/
│   ├── core/                   # Core functionality modules
│   │   ├── device-discovery.js # Device discovery and connection
│   │   ├── firmware-manager.js # Firmware update management
│   │   ├── tunnel-manager.js   # Remote tunnel management
│   │   └── logger.js           # Centralized logging
│   ├── cli/                    # Command-line interfaces
│   │   ├── klvr-tool.js        # Main CLI (end-users)
│   │   └── support-cli.js      # Advanced CLI (support engineers)
│   └── utils/                  # Utility functions
│       └── system-test.js      # System validation tests
├── 📁 tools/                   # Diagnostic tools
│   └── battery-monitor.py      # Battery detection monitor
├── 📁 firmware/                # Firmware files directory
│   ├── main_v1.8.3.signed.bin # Stable main firmware
│   ├── rear_v1.8.3.signed.bin # Stable rear firmware
│   ├── main_v1.8.3-beta4.signed.bin # Beta main firmware
│   └── rear_v1.8.3-beta4.signed.bin # Beta rear firmware
├── 📁 logs/                    # Session logs (auto-created)
├── 📁 scripts/                 # Build and deployment scripts
├── 📦 package.json             # npm package configuration
├── 🔧 install-and-update.sh    # macOS/Linux installer
├── 🔧 install-and-update.ps1   # Windows PowerShell installer
└── 📖 README.md                # This file
```

## 🌐 Remote Support Workflow

### For End Users:
1. **Run the installer**: One command downloads and sets up everything
2. **Select "Remote Support"**: Choose option 2 in the interactive menu
3. **Share the tunnel URL**: Tool automatically creates secure tunnel and displays URL
4. **Keep terminal open**: Session stays active until you press Ctrl+C

### For Support Engineers:
1. **Get tunnel URL** from end user
2. **Use normal commands** with the tunnel URL:
   ```bash
   klvr-tool device-info https://abc123.trycloudflare.com
   klvr-tool battery-monitor https://abc123.trycloudflare.com --test-type aa
   klvr-tool firmware-update https://abc123.trycloudflare.com
   ```
3. **Access all diagnostics** as if device was local

## 🛡️ Security & Privacy

- **Secure tunnels**: All remote access uses HTTPS encryption
- **Temporary access**: Tunnels automatically close when session ends
- **No data collection**: No user data is stored or transmitted to KLVR servers
- **Local processing**: All operations happen locally on user's device

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

**"Tunnel creation failed"**
- Check internet connectivity
- Verify cloudflared installation
- Try running with `--verbose` for detailed logs

### Getting Help

1. **Check logs**: Use `--verbose` flag for detailed information
2. **Session tracking**: Use `--session-id` for support correlation
3. **Export diagnostics**: Use `--format json` to share device information
4. **Contact support**: Include session logs when requesting help

## 📄 License

MIT License - Internal KLVR tool for support operations.

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/KLVR-no/klvr-support-tool/issues)
- **Email**: support@klvr.no
- **Documentation**: [Wiki](https://github.com/KLVR-no/klvr-support-tool/wiki)