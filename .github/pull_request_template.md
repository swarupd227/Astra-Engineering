# Pull Request

## Description
<!-- Provide a brief description of the changes -->

## Type of Change
<!-- Mark with an 'x' all that apply -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Database schema change
- [ ] Documentation update

## Database Changes

### Schema Changes
- [ ] No database schema changes
- [ ] Schema changes included with migration file
- [ ] Migration tested locally
- [ ] Schema sync check passed (`npm run check:schema`)

### Migration Files
<!-- List any new migration files -->
```
migrations/[timestamp]-description.sql
```

### Schema Changes Description
<!-- Describe what changed in the database schema -->
```
Example:
- Added 'figma_link' column to sdlc_backlog_items
- Added 'workflow_session_id' column to sdlc_backlog_items
- Added index on workflow_session_id
```

### Migration Testing
<!-- Confirm you've tested the migration -->
- [ ] Ran `npm run migrate:dev` locally
- [ ] Verified with `npm run check:schema`
- [ ] Tested rollback (if applicable)
- [ ] Verified data integrity after migration

## How Has This Been Tested?
<!-- Describe the tests you ran -->
- [ ] Local development environment
- [ ] Automated tests pass
- [ ] Manual testing completed

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] Any dependent changes have been merged and published

## Screenshots (if applicable)
<!-- Add screenshots here -->

## Additional Notes
<!-- Any additional information -->
