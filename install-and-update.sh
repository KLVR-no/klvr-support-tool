#!/bin/bash

# KLVR Firmware Updater - One-Command Installer & Runner
# Usage: curl -sSL https://raw.githubusercontent.com/[repo-url]/install-and-update.sh | bash
# Or: bash <(curl -sSL https://raw.githubusercontent.com/[repo-url]/install-and-update.sh)

set -e  # Exit on any error

# Configuration
REPO_URL="https://github.com/stiansagholen/klvr-firmware-updater.git"
TEMP_DIR="/tmp/klvr-firmware-updater-$(date +%s)"
SCRIPT_NAME="firmware-update.js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_step "🔍 Checking system prerequisites..."
    
    local missing_deps=()
    
    # Check for Node.js
    if ! command_exists node; then
        missing_deps+=("Node.js")
    else
        local node_version=$(node --version | sed 's/v//')
        local major_version=$(echo $node_version | cut -d. -f1)
        if [ "$major_version" -lt 14 ]; then
            missing_deps+=("Node.js (version 14+ required, found $node_version)")
        else
            print_success "Node.js $node_version found"
        fi
    fi
    
    # Check for npm
    if ! command_exists npm; then
        missing_deps+=("npm")
    else
        print_success "npm $(npm --version) found"
    fi
    
    # Check for git
    if ! command_exists git; then
        missing_deps+=("git")
    else
        print_success "git $(git --version | cut -d' ' -f3) found"
    fi
    
    # Check for curl
    if ! command_exists curl; then
        missing_deps+=("curl")
    else
        print_success "curl found"
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing required dependencies:"
        for dep in "${missing_deps[@]}"; do
            echo -e "  ${RED}• $dep${NC}"
        done
        echo ""
        print_info "Please install the missing dependencies and try again."
        print_info "On macOS: brew install node git"
        print_info "On Ubuntu/Debian: sudo apt-get install nodejs npm git curl"
        print_info "On CentOS/RHEL: sudo yum install nodejs npm git curl"
        exit 1
    fi
    
    print_success "All prerequisites met!"
    echo ""
}

# Function to download and setup the firmware updater
setup_firmware_updater() {
    print_step "📥 Downloading KLVR Firmware Updater..."
    
    # Create temporary directory
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    
    # Clone the repository
    if git clone "$REPO_URL" . >/dev/null 2>&1; then
        print_success "Repository cloned successfully"
    else
        print_error "Failed to clone repository from $REPO_URL"
        print_info "Please check your internet connection and repository URL"
        exit 1
    fi
    
    # Install dependencies
    print_step "📦 Installing dependencies..."
    if npm install >/dev/null 2>&1; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        print_info "Please check npm configuration and try again"
        exit 1
    fi
    
    print_success "Setup completed successfully!"
    echo ""
}

# Function to run the firmware updater
run_firmware_updater() {
    print_step "🚀 Starting KLVR Firmware Updater..."
    echo ""
    
    # Check if the script exists
    if [ ! -f "$SCRIPT_NAME" ]; then
        print_error "Firmware update script not found: $SCRIPT_NAME"
        exit 1
    fi
    
    # Make sure we're in the right directory and run the updater
    node "$SCRIPT_NAME"
}

# Function to cleanup
cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        print_step "🧹 Cleaning up temporary files..."
        rm -rf "$TEMP_DIR"
        print_success "Cleanup completed"
    fi
}

# Function to show header
show_header() {
    echo ""
    echo -e "${PURPLE}============================================================${NC}"
    echo -e "${PURPLE}    KLVR Firmware Updater - One-Command Installer${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo -e "${CYAN}This script will:${NC}"
    echo -e "${CYAN}  1. Download the latest firmware updater${NC}"
    echo -e "${CYAN}  2. Install required dependencies${NC}"
    echo -e "${CYAN}  3. Start the interactive firmware update process${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C at any time to cancel${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo ""
}

# Function to show completion message
show_completion() {
    echo ""
    echo -e "${PURPLE}============================================================${NC}"
    echo -e "${GREEN}🎉 KLVR Firmware Updater Installation Complete! 🎉${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo ""
    echo -e "${CYAN}To run the firmware updater again in the future, you can:${NC}"
    echo -e "${CYAN}  1. Use this one-command installer again, or${NC}"
    echo -e "${CYAN}  2. Clone the repository manually and run: node firmware-update.js${NC}"
    echo ""
    echo -e "${YELLOW}Repository: $REPO_URL${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo ""
}

# Main execution
main() {
    # Set up trap for cleanup on exit
    trap cleanup EXIT
    
    # Show header
    show_header
    
    # Run the installation process
    check_prerequisites
    setup_firmware_updater
    run_firmware_updater
    
    # Show completion message
    show_completion
}

# Check if script is being sourced or executed
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
