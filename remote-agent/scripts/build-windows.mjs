/**
 * Build NAT-Agent-Windows-x64.zip — self-contained remote agent for Windows.
 * Run from remote-agent/: node scripts/build-windows.mjs
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync, readFileSync, cpSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AGENT_ROOT, '..');
const DIST = path.join(AGENT_ROOT, 'dist');
const STAGE = path.join(DIST, 'NAT-Agent');
const DOWNLOADS = path.join(REPO_ROOT, 'downloads');

const NODE_VERSION = '20.18.1';
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;

function run(cmd, args, opts = {}) {
  const isBare = !path.isAbsolute(cmd) && !cmd.includes(path.sep) && !cmd.endsWith('.exe');
  const useShell = opts.shell ?? isBare;
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts, shell: useShell });
  if (r.status !== 0) throw new Error(`${cmd} exited with code ${r.status}`);
}

async function downloadFile(url, dest) {
  const nodeFetch = (await import('node-fetch')).default;
  console.log(`  Downloading ${url} ...`);
  const res = await nodeFetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  → ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

console.log('═══ NAT Agent Windows x64 Build ═══\n');

// Clean
if (existsSync(DIST)) { rmSync(DIST, { recursive: true, force: true }); }
mkdirSync(STAGE, { recursive: true });
mkdirSync(DOWNLOADS, { recursive: true });

// Step 1: Download portable Node.js
console.log('Step 1/6: Download portable Node.js ...');
const nodeZipPath = path.join(DIST, 'node.zip');
if (!existsSync(nodeZipPath)) {
  await downloadFile(NODE_URL, nodeZipPath);
}
console.log('  Extracting...');
const nodeZip = new AdmZip(nodeZipPath);
nodeZip.extractAllTo(DIST, true);
const extractedNodeDir = path.join(DIST, `node-v${NODE_VERSION}-win-x64`);
const stageNode = path.join(STAGE, 'node');
if (existsSync(extractedNodeDir)) {
  cpSync(extractedNodeDir, stageNode, { recursive: true });
  rmSync(extractedNodeDir, { recursive: true, force: true });
} else {
  throw new Error('Node extraction failed — expected dir not found');
}
console.log('  ✓ Portable Node.js ready\n');

// Step 2: npm install production deps
console.log('Step 2/6: Install production dependencies ...');
const stageModules = path.join(STAGE, 'node_modules');
const stagePkg = path.join(STAGE, 'package.json');
writeFileSync(stagePkg, JSON.stringify({
  name: 'nat-agent',
  version: '1.0.0',
  private: true,
  dependencies: {
    playwright: '^1.40.0',
    'socket.io-client': '^4.8.3',
    ws: '^8.14.0'
  }
}, null, 2));
run('npm', ['install', '--production', '--no-optional'], { cwd: STAGE, shell: true });
console.log('  ✓ Dependencies installed\n');

// Step 3: esbuild agent.ts → app/agent.cjs
console.log('Step 3/6: Bundle agent.ts with esbuild ...');
const appDir = path.join(STAGE, 'app');
mkdirSync(appDir, { recursive: true });
const agentSrc = path.join(AGENT_ROOT, 'agent.ts');
const outFile = path.join(appDir, 'agent.cjs');
run('npx', [
  'esbuild',
  `"${agentSrc}"`,
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  `--outfile="${outFile}"`,
  '--external:playwright',
  '--external:ws',
  '--external:socket.io-client',
], { cwd: AGENT_ROOT, shell: true });
console.log('  ✓ agent.cjs bundled\n');

// Step 4: Install Playwright Chromium using portable Node
console.log('Step 4/6: Install Playwright Chromium (this takes a few minutes) ...');
const BROWSERS = path.join(STAGE, 'browsers');
mkdirSync(BROWSERS, { recursive: true });
const pwCli = path.join(STAGE, 'node_modules', 'playwright', 'cli.js');
const pwCliAlt = path.join(STAGE, 'node_modules', 'playwright-core', 'cli.js');
const cliPath = existsSync(pwCli) ? pwCli : existsSync(pwCliAlt) ? pwCliAlt : null;
if (!cliPath) throw new Error('playwright cli.js not found in staged node_modules');
run('npx', ['playwright', 'install', 'chromium'], {
  cwd: STAGE,
  shell: true,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }
});
console.log('  ✓ Chromium installed\n');

// Step 5: Copy launcher files
console.log('Step 5/6: Copy launcher files ...');
const launcherDir = path.join(AGENT_ROOT, 'launcher');
const launcherFiles = ['start-agent.bat', 'start-agent.vbs', 'stop-agent.bat', 'config.json', 'README.txt'];
for (const f of launcherFiles) {
  const src = path.join(launcherDir, f);
  if (existsSync(src)) {
    copyFileSync(src, path.join(STAGE, f));
  } else {
    console.warn(`  ⚠ launcher/${f} not found — skipping`);
  }
}
console.log('  ✓ Launchers copied\n');

// Step 6: Create ZIP
console.log('Step 6/6: Creating ZIP ...');
const zipOut = path.join(DIST, 'NAT-Agent-Windows-x64.zip');
const finalZip = new AdmZip();
finalZip.addLocalFolder(STAGE, 'NAT-Agent');
finalZip.writeZip(zipOut);
const zipSize = statSync(zipOut).size;
console.log(`  ✓ ZIP created: ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

// Copy to downloads/
const downloadsDest = path.join(DOWNLOADS, 'NAT-Agent-Windows-x64.zip');
copyFileSync(zipOut, downloadsDest);
console.log(`  ✓ Copied to ${downloadsDest}`);
console.log('\n═══ Build complete! ═══');
