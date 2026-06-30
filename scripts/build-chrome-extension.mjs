import { existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'chrome-extension');
const OUT_DIR = path.join(ROOT, 'downloads');
const OUT_FILE = path.join(OUT_DIR, 'chrome-extension.zip');

if (!existsSync(path.join(EXT_DIR, 'manifest.json'))) {
  console.error('ERROR: chrome-extension/manifest.json not found. Run this script from the repo root.');
  process.exit(1);
}

import { mkdirSync } from 'fs';
mkdirSync(OUT_DIR, { recursive: true });

const zip = new AdmZip();
zip.addLocalFolder(EXT_DIR, 'chrome-extension');
zip.writeZip(OUT_FILE);

const size = statSync(OUT_FILE).size;
console.log(`✓ chrome-extension.zip created (${(size / 1024).toFixed(1)} KB) → ${OUT_FILE}`);
