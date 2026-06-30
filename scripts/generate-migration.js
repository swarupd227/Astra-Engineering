// Generate a new migration file with template
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function generateMigration() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Error: Migration name is required!');
    console.error('\nUsage:');
    console.error('  npm run generate:migration <migration-name>');
    console.error('\nExample:');
    console.error('  npm run generate:migration add-workflow-columns');
    process.exit(1);
  }

  const name = args[0].toLowerCase().replace(/\s+/g, '-');
  const timestamp = Date.now();
  const filename = `${timestamp}-${name}.sql`;
  
  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- Author: ${process.env.USERNAME || process.env.USER || 'developer'}
-- Description: [Add detailed description here]

-- ============================================
-- Pre-checks
-- ============================================

-- Verify table exists
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'your_table_name';

-- Check if column already exists (example)
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'your_table_name' 
  AND COLUMN_NAME = 'your_column_name';

-- ============================================
-- Migration SQL
-- ============================================

-- Add your migration SQL here
-- Example: Add a new column
-- ALTER TABLE your_table_name 
--   ADD COLUMN IF NOT EXISTS your_column_name VARCHAR(255) NOT NULL DEFAULT 'default_value';

-- Example: Add multiple columns
-- ALTER TABLE your_table_name 
--   ADD COLUMN IF NOT EXISTS column1 VARCHAR(255),
--   ADD COLUMN IF NOT EXISTS column2 INT,
--   ADD COLUMN IF NOT EXISTS column3 JSON;

-- Example: Modify a column
-- ALTER TABLE your_table_name 
--   MODIFY COLUMN your_column_name VARCHAR(500);

-- Example: Add an index
-- CREATE INDEX IF NOT EXISTS idx_your_column 
--   ON your_table_name(your_column_name);

-- Example: Add a foreign key
-- ALTER TABLE your_table_name 
--   ADD CONSTRAINT fk_your_constraint 
--   FOREIGN KEY (column_name) 
--   REFERENCES other_table(id) 
--   ON DELETE CASCADE;

-- ============================================
-- Verification queries
-- ============================================

-- Verify the changes
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'your_table_name'
ORDER BY ORDINAL_POSITION;

-- ============================================
-- Rollback instructions (if needed)
-- ============================================

-- To rollback this migration:
-- ALTER TABLE your_table_name DROP COLUMN IF EXISTS your_column_name;
`;

  // Ensure migrations directory exists
  const migrationsDir = join(__dirname, '..', 'migrations');
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
  }

  const filepath = join(migrationsDir, filename);
  writeFileSync(filepath, template);
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ MIGRATION FILE CREATED');
  console.log('='.repeat(80));
  console.log(`\n📝 File: migrations/${filename}`);
  console.log(`📅 Timestamp: ${timestamp}`);
  console.log(`📋 Name: ${name}`);
  console.log('\n' + '─'.repeat(80));
  console.log('Next Steps:');
  console.log('─'.repeat(80));
  console.log('1. Edit the migration file and add your SQL');
  console.log('2. Test locally: npm run migrate:dev');
  console.log('3. Verify schema: npm run check:schema');
  console.log('4. Commit both files: schema.ts + migration file');
  console.log('='.repeat(80) + '\n');
}

generateMigration();
