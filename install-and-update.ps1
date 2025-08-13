# KLVR Firmware Updater - One-Command Installer & Runner (PowerShell)
# Usage: iex (iwr -useb https://raw.githubusercontent.com/[repo-url]/install-and-update.ps1)
# Or: Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/[repo-url]/install-and-update.ps1" -UseBasicParsing).Content

param(
    [string]$RepoUrl = "https://github.com/stiansagholen/klvr-firmware-updater.git"
)

# Configuration
$TempDir = "$env:TEMP\klvr-firmware-updater-$(Get-Date -Format 'yyyyMMddHHmmss')"
$ScriptName = "firmware-update.js"

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

# Function to check prerequisites
function Test-Prerequisites {
    Write-Step "Checking system prerequisites..."
    
    $missingDeps = @()
    
    # Check for Node.js
    if (-not (Test-CommandExists "node")) {
        $missingDeps += "Node.js"
    } else {
        try {
            $nodeVersion = (node --version) -replace 'v', ''
            $majorVersion = [int]($nodeVersion -split '\.')[0]
            if ($majorVersion -lt 14) {
                $missingDeps += "Node.js (version 14+ required, found $nodeVersion)"
            } else {
                Write-Success "Node.js $nodeVersion found"
            }
        } catch {
            $missingDeps += "Node.js (unable to determine version)"
        }
    }
    
    # Check for npm
    if (-not (Test-CommandExists "npm")) {
        $missingDeps += "npm"
    } else {
        try {
            $npmVersion = npm --version
            Write-Success "npm $npmVersion found"
        } catch {
            $missingDeps += "npm (unable to determine version)"
        }
    }
    
    # Check for git
    if (-not (Test-CommandExists "git")) {
        $missingDeps += "git"
    } else {
        try {
            $gitVersion = (git --version) -split ' ' | Select-Object -Last 1
            Write-Success "git $gitVersion found"
        } catch {
            Write-Success "git found"
        }
    }
    
    if ($missingDeps.Count -gt 0) {
        Write-Error "Missing required dependencies:"
        foreach ($dep in $missingDeps) {
            Write-Host "  • $dep" -ForegroundColor Red
        }
        Write-Host ""
        Write-Info "Please install the missing dependencies and try again."
        Write-Info "Download Node.js from: https://nodejs.org/"
        Write-Info "Download Git from: https://git-scm.com/"
        Write-Info "Or use a package manager like Chocolatey: choco install nodejs git"
        exit 1
    }
    
    Write-Success "All prerequisites met!"
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
    
    # Run the updater
    node $ScriptName
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
    Write-ColoredOutput "  2. Clone the repository manually and run: node firmware-update.js" "Cyan"
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
