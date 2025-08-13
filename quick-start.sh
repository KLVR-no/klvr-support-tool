#!/bin/bash

# KLVR Firmware Updater - Quick Start Script
# This script can be shared directly with users

echo "============================================================"
echo "    KLVR Firmware Updater - Quick Start"
echo "============================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    echo ""
    echo "Please install Node.js first:"
    echo "  macOS: brew install node"
    echo "  Ubuntu/Debian: sudo apt-get install nodejs npm"
    echo "  Or download from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed."
    echo ""
    echo "Please install Git first:"
    echo "  macOS: brew install git"
    echo "  Ubuntu/Debian: sudo apt-get install git"
    echo "  Or download from: https://git-scm.com/"
    exit 1
fi

echo "✅ Git found"
echo ""

# Create temporary directory
TEMP_DIR="/tmp/klvr-firmware-updater-$(date +%s)"
mkdir -p "$TEMP_DIR"

echo "📥 Downloading KLVR Firmware Updater..."
cd "$TEMP_DIR"

# Clone the repository
if git clone https://github.com/KLVR-no/klvr-firmware-updater.git . 2>/dev/null; then
    echo "✅ Repository downloaded successfully"
else
    echo "❌ Failed to download repository."
    echo ""
    echo "You can manually download and run:"
    echo "  git clone https://github.com/KLVR-no/klvr-firmware-updater.git"
    echo "  cd klvr-firmware-updater"
    echo "  npm install"
    echo "  node firmware-update.js"
    exit 1
fi

echo ""
echo "📦 Installing dependencies..."
if npm install >/dev/null 2>&1; then
    echo "✅ Dependencies installed"
else
    echo "❌ Failed to install dependencies"
    echo "Please try running: npm install"
    exit 1
fi

echo ""
echo "🚀 Starting KLVR Firmware Updater..."
echo ""

# Run the firmware updater
node firmware-update.js

# Cleanup
echo ""
echo "🧹 Cleaning up..."
cd /
rm -rf "$TEMP_DIR"

echo ""
echo "============================================================"
echo "🎉 KLVR Firmware Updater session completed!"
echo "============================================================"
