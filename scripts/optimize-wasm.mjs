// Shrinks wasm/ with Binaryen, since contract size is paid for in locked NEAR.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/near.mjs';

// The features rustc's wasm32 output uses.
const FEATURES = ['--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-sign-ext', '--enable-mutable-globals', '--enable-nontrapping-float-to-int', '--enable-multivalue', '--enable-reference-types'];
const bin = join(ROOT, 'node_modules', 'binaryen', 'bin', 'wasm-opt');
for (const f of readdirSync(join(ROOT, 'wasm')).filter((n) => n.endsWith('.wasm'))) {
  const path = join(ROOT, 'wasm', f);
  const before = statSync(path).size;
  const r = spawnSync(process.execPath, [bin, ...FEATURES, '-Oz', '--strip-debug', '--strip-producers', path, '-o', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${f}: ${r.stderr}`);
  console.log(`${f}: ${before} -> ${statSync(path).size}`);
}
