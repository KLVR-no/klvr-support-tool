const os = require('os');

/**
 * Multi-homing helpers — Wi‑Fi + USB/Ethernet at the same time.
 * Node/OS routing often prefers Wi‑Fi; we bind sockets to the local
 * address that shares a subnet with the charger instead.
 */

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

function netmaskToCidr(netmask) {
  if (!netmask || typeof netmask !== 'string') return 0;
  return netmask.split('.').reduce((acc, octet) => {
    const bits = Number(octet).toString(2);
    return acc + (bits.match(/1/g) || []).length;
  }, 0);
}

function isIPv4(addr) {
  return typeof addr === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(addr);
}

function sameSubnet(targetIp, localIp, netmask) {
  if (!isIPv4(targetIp) || !isIPv4(localIp) || !isIPv4(netmask)) return false;
  const t = ipToInt(targetIp);
  const l = ipToInt(localIp);
  const m = ipToInt(netmask);
  return (t & m) === (l & m);
}

/**
 * Heuristic: prefer wired / USB adapters over Wi‑Fi / cellular / VPN.
 * Higher score = better for direct-cable charger links.
 */
function interfacePreference(name) {
  const n = String(name || '').toLowerCase();
  if (/awdl|llw|bridge|utun|tun|tap|ipsec|ppp|vmnet|veth|docker|br-/.test(n)) return -100;
  if (/wi-?fi|wlan|airport|wwan|cellular|pdp_ip/.test(n)) return 10;
  // macOS: en0 is usually Wi‑Fi; USB ethernet is typically en5+ / eth*
  if (/^en0$/.test(n)) return 20;
  if (/usb|en\d+|eth|lan|ethernet|nic/.test(n)) return 100;
  return 50;
}

function interfaceKind(iface) {
  if (iface.preference <= -50) return 'vpn/tunnel';
  if (iface.preference >= 100) return 'wired/usb';
  if (iface.preference <= 20) return 'wifi';
  return 'other';
}

function isIgnorableInterface(iface) {
  return iface.preference <= -50;
}

function listExternalIPv4(options = {}) {
  const includeIgnored = !!options.includeIgnored;
  const raw = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(raw)) {
    for (const addr of addrs || []) {
      const family = addr.family === 'IPv6' || addr.family === 6 ? 'IPv6' : 'IPv4';
      if (family !== 'IPv4' || addr.internal) continue;
      const iface = {
        name,
        address: addr.address,
        netmask: addr.netmask,
        cidr: netmaskToCidr(addr.netmask),
        mac: addr.mac,
        preference: interfacePreference(name)
      };
      if (!includeIgnored && isIgnorableInterface(iface)) continue;
      list.push(iface);
    }
  }
  return list;
}

function isMultiHomed() {
  return listExternalIPv4().length > 1;
}

/**
 * Local interfaces that consider targetIp on-link (same subnet).
 * Sorted: higher CIDR (more specific) first, then wired preference.
 */
function matchingInterfaces(targetIp) {
  if (!isIPv4(targetIp)) return [];
  return listExternalIPv4()
    .filter((iface) => sameSubnet(targetIp, iface.address, iface.netmask))
    .sort((a, b) => {
      if (b.cidr !== a.cidr) return b.cidr - a.cidr;
      return b.preference - a.preference;
    });
}

/**
 * Best localAddress to bind when talking to targetIp.
 * If nothing shares a subnet, return null (caller may try all ifaces).
 */
function preferLocalAddress(targetIp) {
  const matches = matchingInterfaces(targetIp);
  return matches.length ? matches[0].address : null;
}

/**
 * Ordered list of local addresses to try for a LAN target.
 * 1) Same-subnet matches (best first)
 * 2) Other external IPv4s (wired first) — covers weird mask mismatches
 * 3) undefined = OS default route (last resort)
 */
function localAddressesToTry(targetIp) {
  const external = listExternalIPv4().sort((a, b) => b.preference - a.preference);
  const matched = matchingInterfaces(targetIp);
  const seen = new Set();
  const ordered = [];

  for (const iface of matched) {
    if (!seen.has(iface.address)) {
      seen.add(iface.address);
      ordered.push(iface.address);
    }
  }
  for (const iface of external) {
    if (!seen.has(iface.address)) {
      seen.add(iface.address);
      ordered.push(iface.address);
    }
  }
  ordered.push(undefined); // OS routing
  return ordered;
}

function describeMultiHome(logger) {
  const ifaces = listExternalIPv4();
  if (ifaces.length <= 1) {
    if (logger && ifaces.length === 1) {
      logger.debug(`Network: ${ifaces[0].name} ${ifaces[0].address}/${ifaces[0].cidr}`);
    }
    return ifaces;
  }

  if (logger) {
    logger.warn(`Multiple networks active (${ifaces.length}) — Wi‑Fi + cable can break charger links.`);
    for (const iface of ifaces) {
      logger.info(`  ${iface.name}: ${iface.address}/${iface.cidr}  (${interfaceKind(iface)})`);
    }
    logger.info('Binding charger traffic to the matching adapter when possible.');
  }
  return ifaces;
}

function formatIfaceShort(iface) {
  if (!iface) return 'default-route';
  if (typeof iface === 'string') return iface;
  return `${iface.name} ${iface.address}/${iface.cidr}`;
}

module.exports = {
  ipToInt,
  intToIp,
  netmaskToCidr,
  isIPv4,
  sameSubnet,
  interfacePreference,
  interfaceKind,
  isIgnorableInterface,
  listExternalIPv4,
  isMultiHomed,
  matchingInterfaces,
  preferLocalAddress,
  localAddressesToTry,
  describeMultiHome,
  formatIfaceShort
};
