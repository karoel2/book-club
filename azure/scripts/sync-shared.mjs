// Copy the portable modules from ../scripts into src/shared/ so the function is
// self-contained for deployment. Single source of truth stays in ../scripts.
// Runs automatically before `npm start` and `npm run deploy`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..'); // book club/
const shared = join(here, '..', 'src', 'shared');
mkdirSync(shared, { recursive: true });

const files = [
  [join(repo, 'scripts', 'lib', 'parse.mjs'), join(shared, 'parse.mjs')],
  [join(repo, 'scripts', 'metadata.mjs'), join(shared, 'metadata.mjs')],
];
for (const [src, dst] of files) copyFileSync(src, dst);
console.log(`synced ${files.length} shared modules into azure/src/shared/`);
