# KLVR Support Tool

Professional support tools for KLVR Charger Pro — local and **remote** firmware updates, tunnels, and diagnostics.

**Version:** 2.4.0

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
| `v1.8.93-beta` | Thermal: fans, throttle avg 36/35, hard-stop 38 |

## Customer menu (only two choices)

1. **Update Firmware** — local LAN update (IP or network search; no Cloudflare)
2. **Start Remote Support Session** — always works, even if the charger is offline

```bash
klvr-tool
```

### Update Firmware

```bash
klvr-tool firmware-update --local
klvr-tool firmware-update 192.168.1.141 --version 1.8.93-beta -y
```

### Remote Support Session (one URL for everything)

Starts a local **support hub** and a Cloudflare tunnel. Does **not** require the charger to be reachable first.

Support can then:
- pull network diagnostics (interfaces, masks, ping, Wi‑Fi vs USB)
- discover / select the charger
- update firmware through the same tunnel (hub proxies `/api/v2/*`)

```bash
klvr-tool remote-support
# optional IP hint:
klvr-tool remote-support --ip 10.101.0.56
```

Share the printed `https://….trycloudflare.com` URL. **Keep that terminal open.**

`cloudflared` is auto-installed into `~/.klvr-support/bin` on macOS, Linux, and Windows if missing.

## Supporter

```bash
klvr-tool diagnose https://abc123.trycloudflare.com
klvr-tool use-target https://abc123.trycloudflare.com
klvr-tool firmware-update --remote --version 1.8.93-beta -y
```

Or in one shot:

```bash
klvr-tool firmware-update https://abc123.trycloudflare.com --version 1.8.93-beta -y
```

### What the update does (safe order)

1. Preflight (info + latency)
2. Upload **main**, then **rear**
3. Reboot **main**, then **rear** (both boards — required for RS485 baud renegotiation)
4. Poll `/api/v2/device/firmware_version` until both match the target (or fail hard)

`--force` reflash even if already on that version. Without it, same-version is skipped.

## Other commands

```bash
klvr-tool doctor --ip 10.101.0.56   # local-only network check
klvr-tool device-info [target]
klvr-tool clear-target
klvr-tool firmware-update --rear-only --version 1.8.93-beta
```

Support engineer CLI:

```bash
npm run support
# or
node src/cli/support-cli.js firmware-update <tunnel-url> --version 1.8.93-beta -y
```

## Windows notes

- **Bonjour / mDNS** is often missing → the tool falls back to subnet HTTP scan and manual IP/tunnel entry.
- **Python** for battery monitor: either `python` or `python3` on PATH is fine.
- **cloudflared** installs under `%USERPROFILE%\.klvr-support\bin\cloudflared.exe` (no admin).
- Installer no longer forces Administrator when Node + Git are already present.

## macOS notes

- mDNS usually works out of the box.
- If Homebrew is available, you can also `brew install cloudflared` instead of the local install.
- **Wi‑Fi + USB LAN:** the tool detects multi-homing, warns, and binds charger HTTP (scan / connect / firmware upload) to the adapter that shares a subnet with the charger — so Wi‑Fi being up should not steal the direct-cable path.

## Development

```bash
git clone https://github.com/KLVR-no/klvr-support-tool.git
cd klvr-support-tool
npm install
npm start
npm test
```
