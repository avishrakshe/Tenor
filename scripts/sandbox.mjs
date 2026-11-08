// Starts a local NEAR sandbox on 127.0.0.1:3030. No funds or keys needed.
// Binary: https://github.com/near/near-sandbox (Linux x86_64 and macOS arm64 builds on S3).
// On Windows it runs through WSL.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib/near.mjs';

const VERSION = '2.14.0';
const windows = platform() === 'win32';

function sh(script, { inherit = false } = {}) {
  const [cmd, args] = windows ? ['wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc', script]] : ['bash', ['-c', script]];
  return inherit ? spawn(cmd, args, { stdio: 'inherit' }) : spawnSync(cmd, args, { encoding: 'utf8' });
}

const os = platform() === 'darwin' ? (arch() === 'arm64' ? 'Darwin-arm64' : 'Darwin-x86_64') : 'Linux-x86_64';
const url = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${os}/${VERSION}/near-sandbox.tar.gz`;
const BIN = '$HOME/.tenor-bin/near-sandbox-bin';
const HOME_DIR = '$HOME/.tenor-sandbox';

const install = sh(
  `set -e; mkdir -p $HOME/.tenor-bin; cd $HOME/.tenor-bin; if [ ! -x near-sandbox-bin ]; then curl -fLsS -o s.tgz ${url}; tar -xzf s.tgz; find . -name near-sandbox -type f -exec cp {} near-sandbox-bin \\;; chmod +x near-sandbox-bin; rm s.tgz; fi; rm -rf ${HOME_DIR}; ${BIN} --home ${HOME_DIR} init >/dev/null 2>&1; echo ${HOME_DIR}`,
);
if (install.status !== 0) {
  console.error(install.stderr);
  process.exit(1);
}

// Copy the genesis key where scripts can read it.
const home = install.stdout.trim().split('\n').pop();
mkdirSync(join(ROOT, '.sandbox'), { recursive: true });
let keyPath = join(home, 'validator_key.json');
if (windows) {
  const copied = sh(`cat ${HOME_DIR}/validator_key.json`);
  const dest = join(ROOT, '.sandbox', 'validator_key.json');
  rmSync(dest, { force: true });
  (await import('node:fs')).writeFileSync(dest, copied.stdout);
} else {
  copyFileSync(keyPath, join(ROOT, '.sandbox', 'validator_key.json'));
}

console.log('Sandbox RPC: http://127.0.0.1:3030 (Ctrl+C to stop)');
const child = sh(`exec ${BIN} --home ${HOME_DIR} run 2>/dev/null`, { inherit: true });
process.on('SIGINT', () => child.kill());
child.on('exit', (code) => process.exit(code ?? 0));
void homedir;
void existsSync;
