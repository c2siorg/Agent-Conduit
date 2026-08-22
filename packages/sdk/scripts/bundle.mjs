// Bundle the SDK runtime into a single self-contained module so the published package has ZERO runtime
// dependencies (the workspace deps @conduit/crypto + @conduit/core are inlined). tsc already emitted a
// self-contained dist/index.d.ts (public types are declared locally in src/types.ts); this overwrites the
// unbundled dist/index.js with the bundled one.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(root, 'dist/index.js'),
  legalComments: 'none',
});

process.stdout.write('bundled -> dist/index.js\n');
