#!/bin/bash

# KLVR Firmware Updater - One-Command Installer & Runner
# Usage: bash <(curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.sh)
# Alternative: curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.sh | bash

set -e  # Exit on any error

# Configuration
REPO_URL="https://github.com/KLVR-no/klvr-firmware-updater.git"
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

# Function to detect the operating system
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command_exists apt-get; then
            echo "debian"
        elif command_exists yum; then
            echo "rhel"
        elif command_exists dnf; then
            echo "fedora"
        elif command_exists pacman; then
            echo "arch"
        else
            echo "linux"
        fi
    else
        echo "unknown"
    fi
}

# Function to install Node.js based on OS
install_nodejs() {
    local os=$(detect_os)
    print_step "📦 Installing Node.js..."
    
    case $os in
        "macos")
            if command_exists brew; then
                print_info "Installing Node.js via Homebrew..."
                brew install node
            else
                print_error "Homebrew not found. Please install Homebrew first:"
                print_info "Visit: https://brew.sh/"
                print_info "Then run: brew install node"
                exit 1
            fi
            ;;
        "debian")
            print_info "Installing Node.js via apt..."
            sudo apt-get update
            sudo apt-get install -y nodejs npm
            ;;
        "rhel")
            print_info "Installing Node.js via yum..."
            sudo yum install -y nodejs npm
            ;;
        "fedora")
            print_info "Installing Node.js via dnf..."
            sudo dnf install -y nodejs npm
            ;;
        "arch")
            print_info "Installing Node.js via pacman..."
            sudo pacman -S nodejs npm
            ;;
        *)
            print_error "Unsupported operating system. Please install Node.js manually:"
            print_info "Visit: https://nodejs.org/"
            exit 1
            ;;
    esac
}

# Function to install git based on OS
install_git() {
    local os=$(detect_os)
    print_step "📦 Installing Git..."
    
    case $os in
        "macos")
            if command_exists brew; then
                print_info "Installing Git via Homebrew..."
                brew install git
            else
                print_error "Homebrew not found. Git should be available via Xcode Command Line Tools:"
                print_info "Run: xcode-select --install"
                exit 1
            fi
            ;;
        "debian")
            print_info "Installing Git via apt..."
            sudo apt-get update
            sudo apt-get install -y git
            ;;
        "rhel")
            print_info "Installing Git via yum..."
            sudo yum install -y git
            ;;
        "fedora")
            print_info "Installing Git via dnf..."
            sudo dnf install -y git
            ;;
        "arch")
            print_info "Installing Git via pacman..."
            sudo pacman -S git
            ;;
        *)
            print_error "Unsupported operating system. Please install Git manually:"
            print_info "Visit: https://git-scm.com/"
            exit 1
            ;;
    esac
}

# Function to check and install prerequisites
check_prerequisites() {
    print_step "🔍 Checking system prerequisites..."
    
    local needs_nodejs=false
    local needs_git=false
    
    # Check for Node.js
    if ! command_exists node; then
        print_warning "Node.js not found - will install automatically"
        needs_nodejs=true
    else
        local node_version=$(node --version | sed 's/v//')
        local major_version=$(echo $node_version | cut -d. -f1)
        if [ "$major_version" -lt 14 ]; then
            print_warning "Node.js version $node_version found, but version 14+ required - will update"
            needs_nodejs=true
        else
            print_success "Node.js $node_version found"
        fi
    fi
    
    # Check for npm (usually comes with Node.js)
    if ! command_exists npm && ! $needs_nodejs; then
        print_warning "npm not found - will install with Node.js"
        needs_nodejs=true
    elif command_exists npm; then
        print_success "npm $(npm --version) found"
    fi
    
    # Check for git
    if ! command_exists git; then
        print_warning "Git not found - will install automatically"
        needs_git=true
    else
        print_success "git $(git --version | cut -d' ' -f3) found"
    fi
    
    # Check for curl (usually pre-installed)
    if ! command_exists curl; then
        print_warning "curl not found, but continuing (git clone will work)"
    else
        print_success "curl found"
    fi
    
    # Install missing dependencies
    if $needs_nodejs; then
        install_nodejs
        # Verify installation
        if command_exists node; then
            print_success "Node.js $(node --version) installed successfully"
        else
            print_error "Failed to install Node.js"
            exit 1
        fi
    fi
    
    if $needs_git; then
        install_git
        # Verify installation
        if command_exists git; then
            print_success "Git $(git --version | cut -d' ' -f3) installed successfully"
        else
            print_error "Failed to install Git"
            exit 1
        fi
    fi
    
    print_success "All prerequisites ready!"
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
