# KLVR Support Tool

Professional support tools for KLVR Charger Pro — local and **remote** firmware updates, tunnels, and diagnostics.

**Version:** 2.1.0

## Quick Start (download + run)

### macOS / Linux
```bash
bash <(curl -sSL https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.sh)
```

### Windows (PowerShell)
Admin is only required if Node.js or Git are missing. If both are already installed, run normally:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; iex (iwr -useb https://raw.githubusercontent.com/KLVR-no/klvr-support-tool/main/install-and-update.ps1)
```

The installer clones the latest repo (including bundled firmware), installs npm deps, and starts interactive mode.

## Bundled firmware

| Version | Notes |
|---------|--------|
| `v1.8.4` | Stable baseline |
| `v1.8.6-beta` | Beta |
| `v1.8.7-beta` | Beta (easteregg era) |
| `v1.8.9-beta` | Thermal policy: fans 70% @ 32°C, hard-stop 38°C |

## Customer: local firmware update

Interactive → **Customer** → Update Firmware. Connection is **LAN only** (IP or network search) — no Cloudflare.

```bash
klvr-tool firmware-update --local
klvr-tool firmware-update 192.168.1.141 --version 1.8.9-beta -y
```

## Customer: open a remote support tunnel

Interactive → **Start Remote Support Session** (picks a local charger, then opens the tunnel).

```bash
klvr-tool remote-support
```

Share the printed `https://….trycloudflare.com` URL with Klvr support. **Keep that terminal open** until support is done.

`cloudflared` is auto-installed into `~/.klvr-support/bin` on macOS, Linux, and Windows if missing.

## Supporter: upgrade a remote charger

Interactive → **Klvr Support** → Connect to Customer Tunnel → optional firmware update.

```bash
klvr-tool use-target https://abc123.trycloudflare.com
klvr-tool firmware-update --remote --version 1.8.9-beta -y
```

Or in one shot:

```bash
klvr-tool firmware-update https://abc123.trycloudflare.com --version 1.8.9-beta -y
```

### What the update does (safe order)

1. Preflight (info + latency)
2. Upload **main**, then **rear**
3. Reboot **main**, then **rear** (both boards — required for RS485 baud renegotiation)
4. Poll `/api/v2/device/firmware_version` until both match the target (or fail hard)

`--force` reflash even if already on that version. Without it, same-version is skipped.

## Other commands

```bash
klvr-tool device-info [target]
klvr-tool battery-monitor [target] --test-type aa
klvr-tool clear-target
klvr-tool firmware-update --rear-only --version 1.8.9-beta
```

Support engineer CLI:

```bash
npm run support
# or
node src/cli/support-cli.js firmware-update <tunnel-url> --version 1.8.9-beta -y
```

## Windows notes

- **Bonjour / mDNS** is often missing → the tool falls back to subnet HTTP scan and manual IP/tunnel entry.
- **Python** for battery monitor: either `python` or `python3` on PATH is fine.
- **cloudflared** installs under `%USERPROFILE%\.klvr-support\bin\cloudflared.exe` (no admin).
- Installer no longer forces Administrator when Node + Git are already present.

## macOS notes

- mDNS usually works out of the box.
- If Homebrew is available, you can also `brew install cloudflared` instead of the local install.

## Development

```bash
git clone https://github.com/KLVR-no/klvr-support-tool.git
cd klvr-support-tool
npm install
npm test
npm start
```

## Support

stian@klvr.no
