# Migration File Location Enforcement

## 🎯 Policy
**All SQL migration files MUST be in the `migrations/` folder.**

## 📁 Allowed Locations

```
migrations/
├── manual/              ✅ Manual migrations
├── auto-generated/      ✅ Auto-generated migrations
├── applied/             ✅ Already applied migrations (archive)
└── scripts/             ✅ Migration utility scripts
```

## ❌ Blocked Locations

- Project root (`*.sql`)
- Scripts folder (`scripts/*.sql`)
- Any other folder outside `migrations/`

## 🛡️ Enforcement Layers

### 1. Pre-commit Hook
Automatically runs before every commit:
```bash
# Blocks commits with misplaced SQL files
git commit -m "add feature"
# ❌ Will fail if SQL files outside migrations/
```

### 2. Manual Check
Run manually anytime:
```bash
npm run check:migration-location
```

### 3. CI/CD Pipeline
Automatically runs in Azure Pipelines on every push/PR.

## 🚀 Workflow

### Creating New Migrations
```bash
# ✅ Correct way - generates in migrations/auto-generated/
npm run generate:migration my-feature

# ✅ Or let schema check auto-generate
npm run check:schema
```

### If You Accidentally Create a SQL File in Wrong Place
```bash
# Move it to the correct location
mv my-migration.sql migrations/manual/

# Or use PowerShell
Move-Item my-migration.sql migrations/manual/
```

## 🔍 What Happens If You Try to Commit Misplaced SQL?

```
❌ COMMIT BLOCKED: SQL files detected outside migrations/ folder!

╔════════════════════════════════════════════════════════════╗
║  The following SQL files are in wrong locations:          ║
╠════════════════════════════════════════════════════════════╣
║  • my-feature.sql
║  • scripts/temp-migration.sql
╠════════════════════════════════════════════════════════════╣
║  Please move SQL files to:                                ║
║  • migrations/manual/      (for manual migrations)        ║
║  • migrations/auto-generated/  (for auto migrations)      ║
╚════════════════════════════════════════════════════════════╝
```

## 💡 Benefits

1. **Organized** - All migrations in one place
2. **Tracked** - Easy to audit and review
3. **Safe** - Prevents accidental SQL files scattered across codebase
4. **Consistent** - Team follows same structure

## 🆘 Bypassing (Not Recommended)

If you absolutely need to bypass the check (e.g., for documentation SQL examples):

```bash
# Temporarily disable pre-commit hook
git commit --no-verify -m "add documentation with SQL example"
```

**Note:** This should only be used for non-migration SQL files like documentation examples.

## 📝 Related Scripts

- [check-migration-location.js](../scripts/check-migration-location.js) - Validation script
- [.husky/pre-commit](../.husky/pre-commit) - Git hook
- [azure-pipelines.yml](../azure-pipelines.yml) - CI/CD check
