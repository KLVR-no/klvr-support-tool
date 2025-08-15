# KLVR Firmware Updater - One-Command Installer & Runner (PowerShell)
# Usage: iex (iwr -useb https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.ps1)
# Alternative: Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/KLVR-no/klvr-firmware-updater/main/install-and-update.ps1" -UseBasicParsing).Content

param(
    [string]$RepoUrl = "https://github.com/KLVR-no/klvr-support-tool.git"
)

# Configuration
$TempDir = "$env:TEMP\klvr-support-tool-$(Get-Date -Format 'yyyyMMddHHmmss')"
$ScriptName = "src/cli/klvr-tool.js"

# Function to write colored output
function Write-ColoredOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

function Write-Step {
    param([string]$Message)
    Write-ColoredOutput "🔍 $Message" "Blue"
}

function Write-Success {
    param([string]$Message)
    Write-ColoredOutput "✅ $Message" "Green"
}

function Write-Warning {
    param([string]$Message)
    Write-ColoredOutput "⚠️  $Message" "Yellow"
}

function Write-Error {
    param([string]$Message)
    Write-ColoredOutput "❌ $Message" "Red"
}

function Write-Info {
    param([string]$Message)
    Write-ColoredOutput "ℹ️  $Message" "Cyan"
}

# Function to check if command exists
function Test-CommandExists {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# Function to check if Chocolatey is installed
function Test-Chocolatey {
    return (Test-CommandExists "choco")
}

# Function to install Chocolatey
function Install-Chocolatey {
    Write-Step "Installing Chocolatey package manager..."
    Write-Info "This requires administrator privileges"
    
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        
        # Refresh environment variables
        $env:ChocolateyInstall = Convert-Path "$((Get-Command choco).Path)\..\.."
        Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
        refreshenv
        
        Write-Success "Chocolatey installed successfully"
        return $true
    } catch {
        Write-Warning "Failed to install Chocolatey automatically"
        Write-Info "Please install Chocolatey manually from: https://chocolatey.org/install"
        return $false
    }
}

# Function to install Node.js via Chocolatey
function Install-NodeJS {
    Write-Step "Installing Node.js..."
    
    if (-not (Test-Chocolatey)) {
        Write-Warning "Chocolatey not found. Attempting to install..."
        if (-not (Install-Chocolatey)) {
            Write-Error "Cannot install Node.js automatically without Chocolatey"
            Write-Info "Please install Node.js manually from: https://nodejs.org/"
            exit 1
        }
    }
    
    try {
        Write-Info "Installing Node.js via Chocolatey..."
        choco install nodejs -y
        
        # Refresh environment variables
        refreshenv
        
        Write-Success "Node.js installed successfully"
    } catch {
        Write-Error "Failed to install Node.js via Chocolatey"
        Write-Info "Please install Node.js manually from: https://nodejs.org/"
        exit 1
    }
}

# Function to install Git via Chocolatey
function Install-Git {
    Write-Step "Installing Git..."
    
    if (-not (Test-Chocolatey)) {
        Write-Warning "Chocolatey not found. Attempting to install..."
        if (-not (Install-Chocolatey)) {
            Write-Error "Cannot install Git automatically without Chocolatey"
            Write-Info "Please install Git manually from: https://git-scm.com/"
            exit 1
        }
    }
    
    try {
        Write-Info "Installing Git via Chocolatey..."
        choco install git -y
        
        # Refresh environment variables
        refreshenv
        
        Write-Success "Git installed successfully"
    } catch {
        Write-Error "Failed to install Git via Chocolatey"
        Write-Info "Please install Git manually from: https://git-scm.com/"
        exit 1
    }
}

# Function to check and install prerequisites
function Test-Prerequisites {
    Write-Step "Checking system prerequisites..."
    
    $needsNodeJS = $false
    $needsGit = $false
    
    # Check for Node.js
    if (-not (Test-CommandExists "node")) {
        Write-Warning "Node.js not found - will install automatically"
        $needsNodeJS = $true
    } else {
        try {
            $nodeVersion = (node --version) -replace 'v', ''
            $majorVersion = [int]($nodeVersion -split '\.')[0]
            if ($majorVersion -lt 14) {
                Write-Warning "Node.js version $nodeVersion found, but version 14+ required - will update"
                $needsNodeJS = $true
            } else {
                Write-Success "Node.js $nodeVersion found"
            }
        } catch {
            Write-Warning "Node.js found but unable to determine version - will reinstall"
            $needsNodeJS = $true
        }
    }
    
    # Check for npm (usually comes with Node.js)
    if (-not (Test-CommandExists "npm") -and -not $needsNodeJS) {
        Write-Warning "npm not found - will install with Node.js"
        $needsNodeJS = $true
    } elseif (Test-CommandExists "npm") {
        try {
            $npmVersion = npm --version
            Write-Success "npm $npmVersion found"
        } catch {
            Write-Success "npm found"
        }
    }
    
    # Check for git
    if (-not (Test-CommandExists "git")) {
        Write-Warning "Git not found - will install automatically"
        $needsGit = $true
    } else {
        try {
            $gitVersion = (git --version) -split ' ' | Select-Object -Last 1
            Write-Success "git $gitVersion found"
        } catch {
            Write-Success "git found"
        }
    }
    
    # Install missing dependencies
    if ($needsNodeJS) {
        Install-NodeJS
        
        # Verify installation
        if (Test-CommandExists "node") {
            $nodeVersion = (node --version)
            Write-Success "Node.js $nodeVersion installed successfully"
        } else {
            Write-Error "Failed to install Node.js"
            exit 1
        }
    }
    
    if ($needsGit) {
        Install-Git
        
        # Verify installation
        if (Test-CommandExists "git") {
            $gitVersion = (git --version) -split ' ' | Select-Object -Last 1
            Write-Success "Git $gitVersion installed successfully"
        } else {
            Write-Error "Failed to install Git"
            exit 1
        }
    }
    
    Write-Success "All prerequisites ready!"
    Write-Host ""
}

# Function to download and setup the firmware updater
function Install-FirmwareUpdater {
    Write-Step "Downloading KLVR Firmware Updater..."
    
    try {
        # Create temporary directory
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
        Set-Location $TempDir
        
        # Clone the repository
        git clone $RepoUrl . *>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Git clone failed"
        }
        Write-Success "Repository cloned successfully"
        
        # Install dependencies
        Write-Step "Installing dependencies..."
        npm install *>$null
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed"
        }
        Write-Success "Dependencies installed successfully"
        
        Write-Success "Setup completed successfully!"
        Write-Host ""
        
    } catch {
        Write-Error "Failed to setup firmware updater: $($_.Exception.Message)"
        Write-Info "Please check your internet connection and repository URL"
        exit 1
    }
}

# Function to run the firmware updater
function Start-FirmwareUpdater {
    Write-Step "Starting KLVR Firmware Updater..."
    Write-Host ""
    
    # Check if the script exists
    if (-not (Test-Path $ScriptName)) {
        Write-Error "Firmware update script not found: $ScriptName"
        exit 1
    }
    
    # Run the support tool
    node $ScriptName interactive
}

# Function to cleanup
function Remove-TempFiles {
    if (Test-Path $TempDir) {
        Write-Step "Cleaning up temporary files..."
        try {
            Remove-Item $TempDir -Recurse -Force
            Write-Success "Cleanup completed"
        } catch {
            Write-Warning "Could not clean up temporary files at: $TempDir"
        }
    }
}

# Function to show header
function Show-Header {
    Write-Host ""
    Write-ColoredOutput "============================================================" "Magenta"
    Write-ColoredOutput "    KLVR Firmware Updater - One-Command Installer" "Magenta"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-ColoredOutput "This script will:" "Cyan"
    Write-ColoredOutput "  1. Download the latest firmware updater" "Cyan"
    Write-ColoredOutput "  2. Install required dependencies" "Cyan"
    Write-ColoredOutput "  3. Start the interactive firmware update process" "Cyan"
    Write-Host ""
    Write-ColoredOutput "Press Ctrl+C at any time to cancel" "Yellow"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-Host ""
}

# Function to show completion message
function Show-Completion {
    Write-Host ""
    Write-ColoredOutput "============================================================" "Magenta"
    Write-ColoredOutput "🎉 KLVR Firmware Updater Installation Complete! 🎉" "Green"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-Host ""
    Write-ColoredOutput "To run the firmware updater again in the future, you can:" "Cyan"
    Write-ColoredOutput "  1. Use this one-command installer again, or" "Cyan"
    Write-ColoredOutput "  2. Clone the repository manually and run: node src/cli/klvr-tool.js" "Cyan"
    Write-Host ""
    Write-ColoredOutput "Repository: $RepoUrl" "Yellow"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-Host ""
}

# Main execution
function Main {
    try {
        # Show header
        Show-Header
        
        # Run the installation process
        Test-Prerequisites
        Install-FirmwareUpdater
        Start-FirmwareUpdater
        
        # Show completion message
        Show-Completion
        
    } finally {
        # Cleanup
        Remove-TempFiles
    }
}

# Run the main function
Main
