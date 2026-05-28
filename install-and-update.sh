#!/bin/bash

# Klvr Support Tool - One-Command Installer & Runner
# Usage: bash <(curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.sh)

set -e

REPO_URL="https://github.com/KLVR-no/klvr-support-tool.git"
TEMP_DIR="/tmp/klvr-support-tool-$(date +%s)"
SCRIPT_NAME="src/cli/klvr-tool.js"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

print_step()    { echo -e "${BLUE}$1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_info()    { echo -e "${CYAN}ℹ️  $1${NC}"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command_exists apt-get; then echo "debian"
        elif command_exists dnf;     then echo "fedora"
        elif command_exists yum;     then echo "rhel"
        elif command_exists pacman;  then echo "arch"
        else echo "linux"
        fi
    else
        echo "unknown"
    fi
}

# ── Homebrew ──────────────────────────────────────────────────────────────────

ensure_brew() {
    # Already in PATH?
    if command_exists brew; then return; fi

    # Apple Silicon installs to /opt/homebrew, Intel to /usr/local
    for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        if [ -x "$candidate" ]; then
            eval "$("$candidate" shellenv)"
            return
        fi
    done

    print_warning "Homebrew not found — installing it now."
    print_info "This may take a few minutes and might ask for your Mac password."
    echo ""

    # Homebrew's own installer handles Xcode Command Line Tools automatically
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Re-source after install
    for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        if [ -x "$candidate" ]; then
            eval "$("$candidate" shellenv)"
            break
        fi
    done

    if ! command_exists brew; then
        print_error "Homebrew installation failed."
        print_info "Please install it manually from https://brew.sh and re-run this script."
        exit 1
    fi

    print_success "Homebrew installed."
}

# ── Node.js ───────────────────────────────────────────────────────────────────

install_nodejs() {
    local os=$(detect_os)
    print_step "📦 Installing Node.js..."

    case $os in
        macos)
            ensure_brew
            brew install node
            ;;
        debian)
            # Use NodeSource for a recent version rather than the often-outdated distro package
            if command_exists curl; then
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - >/dev/null 2>&1
            fi
            sudo apt-get install -y nodejs >/dev/null 2>&1
            ;;
        rhel)   sudo yum install -y nodejs npm >/dev/null 2>&1 ;;
        fedora) sudo dnf install -y nodejs npm >/dev/null 2>&1 ;;
        arch)   sudo pacman -S --noconfirm nodejs npm >/dev/null 2>&1 ;;
        *)
            print_error "Unsupported OS. Please install Node.js from https://nodejs.org/ and re-run."
            exit 1
            ;;
    esac
}

# ── Git ───────────────────────────────────────────────────────────────────────

install_git() {
    local os=$(detect_os)
    print_step "📦 Installing Git..."

    case $os in
        macos)
            ensure_brew
            brew install git
            ;;
        debian) sudo apt-get install -y git >/dev/null 2>&1 ;;
        rhel)   sudo yum install -y git >/dev/null 2>&1 ;;
        fedora) sudo dnf install -y git >/dev/null 2>&1 ;;
        arch)   sudo pacman -S --noconfirm git >/dev/null 2>&1 ;;
        *)
            print_error "Unsupported OS. Please install Git from https://git-scm.com/ and re-run."
            exit 1
            ;;
    esac
}

# ── Prerequisites check ───────────────────────────────────────────────────────

check_prerequisites() {
    print_step "🔍 Checking prerequisites..."

    local needs_nodejs=false
    local needs_git=false

    # Node.js
    if ! command_exists node; then
        print_warning "Node.js not found — will install automatically"
        needs_nodejs=true
    else
        local node_major
        node_major=$(node --version | sed 's/v//' | cut -d. -f1)
        if [ "$node_major" -lt 14 ]; then
            print_warning "Node.js $(node --version) is too old (need v14+) — will update"
            needs_nodejs=true
        else
            print_success "Node.js $(node --version)"
        fi
    fi

    # npm (sanity check — normally bundled with Node)
    if ! command_exists npm && [ "$needs_nodejs" = false ]; then
        print_warning "npm not found — will reinstall Node.js"
        needs_nodejs=true
    elif command_exists npm; then
        print_success "npm $(npm --version)"
    fi

    # Git
    if ! command_exists git; then
        print_warning "Git not found — will install automatically"
        needs_git=true
    else
        print_success "git $(git --version | awk '{print $3}')"
    fi

    # curl (needed to fetch Homebrew installer on macOS; almost always present)
    if ! command_exists curl; then
        print_error "curl is required but not found. Please install curl and re-run."
        exit 1
    fi

    $needs_nodejs && install_nodejs
    $needs_git    && install_git

    # Verify
    if ! command_exists node; then
        print_error "Node.js installation failed. Please install it manually from https://nodejs.org/"
        exit 1
    fi
    if ! command_exists git; then
        print_error "Git installation failed. Please install it manually from https://git-scm.com/"
        exit 1
    fi

    print_success "All prerequisites ready!"
    echo ""
}

# ── Download & run ────────────────────────────────────────────────────────────

setup_tool() {
    print_step "📥 Downloading Klvr Support Tool..."

    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"

    if ! git clone --depth 1 "$REPO_URL" . >/dev/null 2>&1; then
        print_error "Could not download the Klvr Support Tool."
        print_info "Check your internet connection and try again."
        exit 1
    fi
    print_success "Downloaded latest version"

    print_step "📦 Installing tool dependencies..."
    if ! npm install --silent 2>/dev/null; then
        # Retry with verbose output so the user can see what failed
        print_warning "First attempt failed — retrying with details..."
        npm install
    fi
    print_success "Dependencies ready"
    echo ""
}

run_tool() {
    print_step "🚀 Starting Klvr Support Tool..."
    echo ""

    if [ ! -f "$SCRIPT_NAME" ]; then
        print_error "Tool script not found after download. Please try again."
        exit 1
    fi

    node "$SCRIPT_NAME" interactive
}

cleanup() {
    [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"
}

show_header() {
    echo ""
    echo -e "${PURPLE}============================================================${NC}"
    echo -e "${PURPLE}         Klvr Charger Pro — Support Tool${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo -e "${CYAN}  This will:${NC}"
    echo -e "${CYAN}    1. Install any missing dependencies (Node.js, Git)${NC}"
    echo -e "${CYAN}    2. Download the latest Klvr support tools${NC}"
    echo -e "${CYAN}    3. Open the interactive firmware update menu${NC}"
    echo ""
    echo -e "${YELLOW}  Press Ctrl+C at any time to cancel${NC}"
    echo -e "${PURPLE}============================================================${NC}"
    echo ""
}

main() {
    trap cleanup EXIT
    show_header
    check_prerequisites
    setup_tool
    run_tool
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
