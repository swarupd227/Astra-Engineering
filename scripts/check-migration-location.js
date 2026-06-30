#!/usr/bin/env node

/**
 * Check Migration Location Script
 * 
 * Validates that all SQL files are in the migrations/ folder
 * This prevents developers from creating migration files in wrong locations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_DIRS = [
  'migrations/manual',
  'migrations/baseline',
  'migrations/auto-generated',
  'migrations/applied',
  'migrations/scripts'
];

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /build/,
  /attached_assets/,
];

function findSqlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const relativePath = path.relative(process.cwd(), filePath);

    // Skip excluded directories
    if (EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath))) {
      return;
    }

    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findSqlFiles(filePath, fileList);
    } else if (file.endsWith('.sql')) {
      fileList.push(relativePath);
    }
  });

  return fileList;
}

function validateMigrationLocations() {
  console.log('🔍 Checking SQL file locations...\n');

  const projectRoot = process.cwd();
  const sqlFiles = findSqlFiles(projectRoot);
  
  const misplacedFiles = sqlFiles.filter(file => {
    const normalizedPath = file.replace(/\\/g, '/');
    return !ALLOWED_DIRS.some(dir => normalizedPath.startsWith(dir));
  });

  if (misplacedFiles.length === 0) {
    console.log('✅ All SQL files are in correct locations!\n');
    return true;
  }

  console.error('❌ Found SQL files in wrong locations:\n');
  console.error('╔════════════════════════════════════════════════════════════╗');
  console.error('║  The following SQL files should be moved:                 ║');
  console.error('╠════════════════════════════════════════════════════════════╣');
  
  misplacedFiles.forEach(file => {
    console.error(`║  • ${file.padEnd(55)}║`);
  });
  
  console.error('╠════════════════════════════════════════════════════════════╣');
  console.error('║  Migration files should only be in:                       ║');
  console.error('║  • migrations/manual/           (manual migrations)       ║');
  console.error('║  • migrations/auto-generated/   (auto-generated)          ║');
  console.error('║  • migrations/applied/          (already applied)         ║');
  console.error('╚════════════════════════════════════════════════════════════╝');
  console.error('');
  
  return false;
}

// Run validation
const isValid = validateMigrationLocations();
process.exit(isValid ? 0 : 1);
