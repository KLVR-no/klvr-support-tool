# KLVR Charger Pro Firmware Update Script

This script allows for manual firmware updates of the KLVR Charger Pro device.

## Prerequisites

- Node.js installed on your system
- The firmware files (`main_v1.7.4.signed.bin` and `rear_v1.7.4.signed.bin`)
- The IP address of your KLVR Charger Pro device

## Files

- `firmware-update.js` - The main update script
- `main_v1.7.4.signed.bin` - Firmware for the main board (v1.7.4)
- `rear_v1.7.4.signed.bin` - Firmware for the rear board (v1.7.4)

## Usage

Run the script with Node.js, providing the IP address of your device:

\`\`\`bash
node firmware-update.js <device-ip>
\`\`\`

Example:
\`\`\`bash
node firmware-update.js 10.110.73.155
\`\`\`

## Update Process

The script follows this sequence:
1. Uploads main board firmware
2. Waits 7 seconds for firmware processing
3. Reboots main board
4. Waits 1.5 seconds for reboot message
5. Uploads rear board firmware
6. Waits 7 seconds for firmware processing
7. Reboots rear board
8. Waits 20 seconds for complete reboot

## Important Notes

- Do not interrupt the update process once started
- Ensure stable network connection throughout the update
- The device will reboot multiple times during the update
- Total update time is approximately 35-40 seconds
