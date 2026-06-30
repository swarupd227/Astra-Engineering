# Database Migration Guide

## 📚 Table of Contents

- [Overview](#overview)
- [When to Create a Migration](#when-to-create-a-migration)
- [Quick Start Guide](#quick-start-guide)
- [Available Commands](#available-commands)
- [Step-by-Step Process](#step-by-step-process)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

## Overview

This project uses a streamlined migration system to keep database schemas in sync with code definitions. The system includes:

- ✅ **Automatic schema validation** - Detects when schema.ts doesn't match the database
- ✅ **Migration generation** - Creates template files automatically
- ✅ **Migration tracking** - Records all executed migrations in `schema_migrations` table
- ✅ **Rollback support** - All migrations include rollback instructions
- ✅ **Pre-commit checks** - Prevents commits with schema mismatches

## When to Create a Migration

Create a migration whenever you:

1. ✏️ **Add or remove columns** in `shared/schema.ts`
2. 🔧 **Modify column types** or constraints
3. 📊 **Add or remove tables**
4. 🔗 **Change indexes** or foreign keys
5. 🎯 **Alter default values** or constraints

## Quick Start Guide

### 1️⃣ Generate Migration File

```bash
npm run generate:migration add-new-column
```

### 2️⃣ Edit Migration File

Open `migrations/[timestamp]-add-new-column.sql` and add your SQL:

```sql
ALTER TABLE sdlc_backlog_items 
  ADD COLUMN IF NOT EXISTS new_column VARCHAR(255);
```

### 3️⃣ Test Locally

```bash
npm run migrate:dev
```

### 4️⃣ Verify Schema Sync

```bash
npm run check:schema
```

### 5️⃣ Commit Both Files

```bash
git add shared/schema.ts migrations/[timestamp]-add-new-column.sql
git commit -m "feat: add new column with migration"
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run check:schema` | Check if database matches schema definitions |
| `npm run generate:migration <name>` | Create a new migration file |
| `npm run migrate:dev` | Run migrations from `migrations/migration-order.json` |
| `npm run migrate:container` | Same runner (container / `RUN_DB_MIGRATIONS=true`) |
| `npm run migrate:order:generate` | Refresh incremental file list in manifest |
| `npm run migrate:check` | Verify ready to migrate |
| `npm run precommit` | Run pre-commit checks (auto) |

## Step-by-Step Process

### Modifying an Existing Table

1. **Update Schema**
   ```typescript
   // shared/schema.ts
   export const sdlcBacklogItems = mysqlTable("sdlc_backlog_items", {
     // ... existing fields
     newField: varchar("new_field", { length: 255 }), // Add this
   });
   ```

2. **Check What's Missing**
   ```bash
   npm run check:schema
   ```
   
   Output shows missing columns and generates auto-migration files.

3. **Generate Migration** (if not auto-generated)
   ```bash
   npm run generate:migration add-new-field-to-backlog
   ```

4. **Edit Migration File**
   ```sql
   -- migrations/[timestamp]-add-new-field-to-backlog.sql
   
   -- Add new field
   ALTER TABLE sdlc_backlog_items 
     ADD COLUMN IF NOT EXISTS new_field VARCHAR(255);
   
   -- Verify
   SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_NAME = 'sdlc_backlog_items' AND COLUMN_NAME = 'new_field';
   ```

5. **Test Migration**
   ```bash
   npm run migrate:dev
   ```

6. **Verify Results**
   ```bash
   npm run check:schema
   ```

7. **Commit Changes**
   ```bash
   git add shared/schema.ts migrations/[timestamp]-add-new-field-to-backlog.sql
   git commit -m "feat: add new_field to backlog items"
   ```

## Best Practices

### ✅ DO

- ✅ Always use `IF NOT EXISTS` / `IF EXISTS`
- ✅ Test migrations on local database first
- ✅ Include verification queries in migration
- ✅ Add rollback instructions in comments
- ✅ Use descriptive migration names
- ✅ Document complex migrations
- ✅ Keep migrations small and focused
- ✅ Run `check:schema` before committing

### ❌ DON'T

- ❌ Modify old migration files
- ❌ Skip migrations for "small" changes
- ❌ Commit schema changes without migration
- ❌ Use `DROP` without careful review
- ❌ Mix multiple concerns in one migration
- ❌ Forget to test migrations locally
- ❌ Ignore schema sync warnings

## Troubleshooting

### Schema Check Fails

**Problem:** `npm run check:schema` reports mismatches

**Solution:**
1. Review the auto-generated migration files in `migrations/auto-generated/`
2. Copy relevant SQL to a new migration file
3. Test with `npm run migrate:dev`
4. Verify with `npm run check:schema`

### Migration Fails

**Problem:** Migration execution fails

**Solution:**
1. Check error message in console
2. Verify SQL syntax in migration file
3. Ensure database connection is correct
4. Check if column/table already exists
5. Review `schema_migrations` table for status

### Column Already Exists

**Problem:** Error: "Duplicate column name"

**Solution:**
- This is OK! The migration runner handles this
- Use `IF NOT EXISTS` to prevent errors
- Migration will be marked as successful

### Pre-commit Hook Blocks Commit

**Problem:** Can't commit schema changes

**Solution:**
1. Create migration file: `npm run generate:migration <name>`
2. Add necessary SQL to migration file
3. Test migration: `npm run migrate:dev`
4. Verify sync: `npm run check:schema`
5. Try commit again

## Examples

### Example 1: Add Single Column

```sql
-- migrations/1234567890-add-figma-link.sql

ALTER TABLE sdlc_backlog_items 
  ADD COLUMN IF NOT EXISTS figma_link TEXT;

-- Verify
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'sdlc_backlog_items' AND COLUMN_NAME = 'figma_link';

-- Rollback:
-- ALTER TABLE sdlc_backlog_items DROP COLUMN IF EXISTS figma_link;
```

### Example 2: Add Multiple Columns

```sql
-- migrations/1234567890-add-workflow-fields.sql

ALTER TABLE sdlc_backlog_items 
  ADD COLUMN IF NOT EXISTS persona VARCHAR(255),
  ADD COLUMN IF NOT EXISTS persona_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS workflow_session_id VARCHAR(36);

-- Verify
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'sdlc_backlog_items' 
  AND COLUMN_NAME IN ('persona', 'persona_id', 'workflow_session_id');
```

### Example 3: Add Index

```sql
-- migrations/1234567890-add-workflow-index.sql

CREATE INDEX IF NOT EXISTS idx_workflow_session 
  ON sdlc_backlog_items(workflow_session_id);

-- Verify
SHOW INDEX FROM sdlc_backlog_items WHERE Key_name = 'idx_workflow_session';

-- Rollback:
-- DROP INDEX IF EXISTS idx_workflow_session ON sdlc_backlog_items;
```

### Example 4: Modify Column Type

```sql
-- migrations/1234567890-extend-title-length.sql

ALTER TABLE sdlc_backlog_items 
  MODIFY COLUMN title TEXT;

-- Verify
SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'sdlc_backlog_items' AND COLUMN_NAME = 'title';
```

## Migration Tracking

All migrations are tracked in the `schema_migrations` table:

```sql
SELECT * FROM schema_migrations ORDER BY executed_at DESC;
```

Columns:
- `migration_name` - Name of the migration file
- `executed_at` - When it was run
- `execution_time_ms` - How long it took
- `status` - success, failed, or rolled_back
- `error_message` - Error details if failed

## CI/CD Integration

The migration system is integrated with your CI/CD pipeline:

1. **Pre-commit**: Checks schema sync before allowing commit
2. **CI Pipeline**: Validates schema sync on every build
3. **Deployment**: Runs pending migrations automatically

## Getting Help

If you encounter issues:

1. 📖 Read this guide thoroughly
2. 🔍 Check the console output for specific errors
3. 📊 Review `schema_migrations` table for history
4. 🐛 Check existing migration files for examples
5. 👥 Ask the team for help

## Summary

The migration process is designed to be:
- 🚀 **Fast** - Quick commands for common tasks
- 🛡️ **Safe** - Automatic validation and rollback support
- 📝 **Clear** - Well-documented and easy to understand
- 🔄 **Automated** - Pre-commit checks prevent mistakes

Remember: **Always test locally before committing!**
