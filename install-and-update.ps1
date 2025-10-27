# KLVR Support Tool - One-Command Installer & Runner (PowerShell)
# Usage: Set-ExecutionPolicy Bypass -Scope Process -Force; iex (iwr -useb https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.ps1)
# Alternative: Run PowerShell as Administrator, then run the above command

param(
    [string]$RepoUrl = "https://github.com/KLVR-no/klvr-support-tool.git"
)

# ============================================================================
# SECURITY AND PRIVILEGE CHECKS
# ============================================================================

# Set execution policy for this session
try {
    Set-ExecutionPolicy Bypass -Scope Process -Force -ErrorAction Stop
} catch {
    Write-Host "❌ Failed to set execution policy. Please run PowerShell as Administrator." -ForegroundColor Red
    Write-Host "ℹ️  Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Cyan
    exit 1
}

# Check for administrator privileges
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "❌ This script requires administrator privileges to install system dependencies." -ForegroundColor Red
    Write-Host "ℹ️  Please run PowerShell as Administrator and try again:" -ForegroundColor Cyan
    Write-Host "   1. Right-click on PowerShell" -ForegroundColor Yellow
    Write-Host "   2. Select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host "   3. Run this command again" -ForegroundColor Yellow
    exit 1
}

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

# Function to refresh environment variables manually
function Update-EnvironmentPath {
    Write-Step "Refreshing environment variables..."
    try {
        $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
        $userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
        $env:PATH = "$machinePath;$userPath"
        
        # Also update ChocolateyInstall if it exists
        $chocoInstall = [System.Environment]::GetEnvironmentVariable("ChocolateyInstall", "Machine")
        if ($chocoInstall) {
            $env:ChocolateyInstall = $chocoInstall
        }
        
        Write-Success "Environment variables refreshed"
        return $true
    } catch {
        Write-Warning "Failed to refresh environment variables"
        return $false
    }
}

# Function to install Chocolatey
function Install-Chocolatey {
    Write-Step "Installing Chocolatey package manager..."
    
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        
        # Manual environment refresh instead of refreshenv
        Update-EnvironmentPath
        
        # Verify installation
        if (Test-CommandExists "choco") {
            Write-Success "Chocolatey installed successfully"
            return $true
        } else {
            throw "Chocolatey command not found after installation"
        }
    } catch {
        Write-Warning "Failed to install Chocolatey automatically: $($_.Exception.Message)"
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
        $chocoResult = choco install nodejs -y
        if ($LASTEXITCODE -ne 0) {
            throw "Chocolatey installation failed with exit code $LASTEXITCODE"
        }
        
        # Manual environment refresh
        Update-EnvironmentPath
        
        # Verify Node.js installation
        if (Test-CommandExists "node") {
            $nodeVersion = node --version
            Write-Success "Node.js $nodeVersion installed successfully"
        } else {
            throw "Node.js command not found after installation"
        }
    } catch {
        Write-Error "Failed to install Node.js via Chocolatey: $($_.Exception.Message)"
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
        $chocoResult = choco install git -y
        if ($LASTEXITCODE -ne 0) {
            throw "Chocolatey installation failed with exit code $LASTEXITCODE"
        }
        
        # Manual environment refresh
        Update-EnvironmentPath
        
        # Verify Git installation
        if (Test-CommandExists "git") {
            $gitVersion = git --version
            Write-Success "Git installed successfully: $gitVersion"
        } else {
            throw "Git command not found after installation"
        }
    } catch {
        Write-Error "Failed to install Git via Chocolatey: $($_.Exception.Message)"
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

# Function to download and setup the support tool
function Install-SupportTool {
    Write-Step "Downloading KLVR Support Tool..."
    
    try {
        # Create temporary directory
        if (Test-Path $TempDir) {
            Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
        Set-Location $TempDir
        
        # Clone the repository with retry logic
        $maxRetries = 3
        $retryCount = 0
        $cloneSuccess = $false
        
        while ($retryCount -lt $maxRetries -and -not $cloneSuccess) {
            try {
                Write-Info "Cloning repository (attempt $($retryCount + 1)/$maxRetries)..."
                git clone $RepoUrl . 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $cloneSuccess = $true
                    Write-Success "Repository cloned successfully"
                } else {
                    throw "Git clone failed with exit code $LASTEXITCODE"
                }
            } catch {
                $retryCount++
                if ($retryCount -lt $maxRetries) {
                    Write-Warning "Clone attempt failed, retrying in 2 seconds..."
                    Start-Sleep -Seconds 2
                } else {
                    throw "Failed to clone repository after $maxRetries attempts: $($_.Exception.Message)"
                }
            }
        }
        
        # Install dependencies with retry logic
        Write-Step "Installing dependencies..."
        $maxRetries = 3
        $retryCount = 0
        $installSuccess = $false
        
        while ($retryCount -lt $maxRetries -and -not $installSuccess) {
            try {
                Write-Info "Installing npm dependencies (attempt $($retryCount + 1)/$maxRetries)..."
                npm install 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $installSuccess = $true
                    Write-Success "Dependencies installed successfully"
                } else {
                    throw "npm install failed with exit code $LASTEXITCODE"
                }
            } catch {
                $retryCount++
                if ($retryCount -lt $maxRetries) {
                    Write-Warning "npm install failed, retrying in 3 seconds..."
                    Start-Sleep -Seconds 3
                } else {
                    throw "Failed to install dependencies after $maxRetries attempts: $($_.Exception.Message)"
                }
            }
        }
        
        Write-Success "Setup completed successfully!"
        Write-Host ""
        
    } catch {
        Write-Error "Failed to setup support tool: $($_.Exception.Message)"
        Write-Info "Please check your internet connection and repository URL"
        Write-Info "Repository URL: $RepoUrl"
        exit 1
    }
}

# Function to run the support tool
function Start-SupportTool {
    Write-Step "Starting KLVR Support Tool..."
    Write-Host ""
    
    try {
        # Check if the script exists
        if (-not (Test-Path $ScriptName)) {
            throw "Support tool script not found: $ScriptName"
        }
        
        # Verify Node.js is working
        if (-not (Test-CommandExists "node")) {
            throw "Node.js command not found. Please ensure Node.js is properly installed."
        }
        
        # Test Node.js version
        try {
            $nodeVersion = node --version
            Write-Info "Using Node.js version: $nodeVersion"
        } catch {
            throw "Node.js is installed but not working properly"
        }
        
        # Run the support tool
        Write-Info "Launching KLVR Support Tool..."
        node $ScriptName interactive
        
    } catch {
        Write-Error "Failed to start support tool: $($_.Exception.Message)"
        Write-Info "You can try running the tool manually with: node $ScriptName interactive"
        exit 1
    }
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
    Write-ColoredOutput "    KLVR Support Tool - One-Command Installer" "Magenta"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-ColoredOutput "This script will:" "Cyan"
    Write-ColoredOutput "  1. Download the latest KLVR support tools" "Cyan"
    Write-ColoredOutput "  2. Install required dependencies" "Cyan"
    Write-ColoredOutput "  3. Start the interactive support tool interface" "Cyan"
    Write-Host ""
    Write-ColoredOutput "Press Ctrl+C at any time to cancel" "Yellow"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-Host ""
}

# Function to show completion message
function Show-Completion {
    Write-Host ""
    Write-ColoredOutput "============================================================" "Magenta"
    Write-ColoredOutput "🎉 KLVR Support Tool Installation Complete! 🎉" "Green"
    Write-ColoredOutput "============================================================" "Magenta"
    Write-Host ""
    Write-ColoredOutput "To run the support tool again in the future, you can:" "Cyan"
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
        Install-SupportTool
        Start-SupportTool
        
        # Show completion message
        Show-Completion
        
    } finally {
        # Cleanup
        Remove-TempFiles
    }
}

# Run the main function
Main
