// Bundle the CLI into a single self-contained executable so the published package has ZERO runtime
// dependencies (the workspace deps @conduit/core + @conduit/crypto are inlined). Node builtins stay
// external. Output: bin/conduit.js with a shebang, marked executable — runnable via `npx @conduit/cli`.
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'bin/conduit.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  // node:* builtins are external automatically on platform=node; everything else (the @conduit/* workspace
  // packages) is inlined so the published artifact needs nothing from npm at runtime. esbuild preserves the
  // entry file's `#!/usr/bin/env node` hashbang, so no banner is needed (adding one would double it).
  legalComments: 'none',
});

chmodSync(outfile, 0o755);
process.stdout.write(`bundled -> ${outfile}\n`);
