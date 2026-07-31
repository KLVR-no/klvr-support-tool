const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Cross-platform helpers for Mac / Windows / Linux.
 */
function getTempDir(...parts) {
  return path.join(os.tmpdir(), ...parts);
}

function getPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  if (platform === 'win32') {
    return 'win32-x64';
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

/**
 * Run a command without bash. Prefer argv form; string form uses
 * cmd.exe /c on Windows and sh -c elsewhere.
 */
function execCommand(command, args = null, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    if (Array.isArray(args)) {
      child = spawn(command, args, {
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...(options.env || {}) }
      });
    } else {
      const shell = process.platform === 'win32';
      const shellArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['-c', command];
      const shellBin = process.platform === 'win32' ? 'cmd.exe' : 'sh';
      child = spawn(shellBin, shellArgs, {
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...(options.env || {}) }
      });
    }

    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.on('data', (d) => { stdout += d.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (d) => { stderr += d.toString(); });
    }

    const timer = options.timeout
      ? setTimeout(() => {
          try { child.kill(); } catch (_) {}
          reject(new Error(`Command timed out after ${options.timeout}ms: ${command}`));
        }, options.timeout)
      : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed (${code}): ${command}\n${stderr || stdout}`));
      }
    });
  });
}

/**
 * Find a working Python interpreter (python3 preferred, then python).
 */
async function findPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const bin of candidates) {
    try {
      const args = bin === 'py' ? ['-3', '--version'] : ['--version'];
      await execCommand(bin, args, { timeout: 5000 });
      return bin === 'py' ? { command: 'py', prefixArgs: ['-3'] } : { command: bin, prefixArgs: [] };
    } catch (_) {
      // try next
    }
  }
  throw new Error(
    'Python not found. Install Python 3 and ensure `python` or `python3` is on PATH.'
  );
}

function commandExists(bin) {
  return new Promise((resolve) => {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(checker, [bin], { stdio: 'ignore', windowsHide: true });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * Normalize firmware version strings for comparison.
 * "v1.8.92-beta" / "1.8.92" / "1.8.92-beta" → "1.8.92"
 */
function normalizeVersion(version) {
  if (!version) return '';
  return String(version)
    .trim()
    .replace(/^v/i, '')
    .replace(/-(beta|alpha|rc)(\b|[-.].*)?$/i, '')
    .replace(/\+.*$/, '');
}

function versionsMatch(a, b) {
  return normalizeVersion(a) === normalizeVersion(b) && normalizeVersion(a) !== '';
}

const SESSION_DIR = path.join(os.homedir(), '.klvr-support');
const ACTIVE_TARGET_FILE = path.join(SESSION_DIR, 'active-target.json');

async function saveActiveTarget(target) {
  await fs.promises.mkdir(SESSION_DIR, { recursive: true });
  const payload = {
    target,
    savedAt: new Date().toISOString()
  };
  await fs.promises.writeFile(ACTIVE_TARGET_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

async function loadActiveTarget() {
  try {
    const raw = await fs.promises.readFile(ACTIVE_TARGET_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data.target || null;
  } catch (_) {
    return null;
  }
}

async function clearActiveTarget() {
  try {
    await fs.promises.unlink(ACTIVE_TARGET_FILE);
  } catch (_) {
    // ignore
  }
}

module.exports = {
  getTempDir,
  getPlatformKey,
  execCommand,
  findPython,
  commandExists,
  normalizeVersion,
  versionsMatch,
  saveActiveTarget,
  loadActiveTarget,
  clearActiveTarget,
  SESSION_DIR,
  ACTIVE_TARGET_FILE
};
