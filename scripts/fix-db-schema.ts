import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function addColumn(table: string, column: string, type: string) {
  try {
    await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`));
    console.log(`✓ Added ${column} to ${table}`);
  } catch (error: any) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log(`  ${column} already exists in ${table}`);
    } else {
      throw error;
    }
  }
}

async function fixSchema() {
  try {
    console.log('Fixing database schema...\n');
    
    // Add missing columns to artifact_organizations
    console.log('Updating artifact_organizations...');
    await addColumn('artifact_organizations', 'project_name', 'TEXT');
    await addColumn('artifact_organizations', 'organization_url', 'TEXT');
    await addColumn('artifact_organizations', 'pat_token', 'TEXT');
    
    // Add missing columns to conversational_ui_settings
    console.log('\nUpdating conversational_ui_settings...');
    await addColumn('conversational_ui_settings', 'repository_name', 'TEXT');
    await addColumn('conversational_ui_settings', 'project_name', 'TEXT');
    await addColumn('conversational_ui_settings', 'organization_url', 'TEXT');
    await addColumn('conversational_ui_settings', 'pat_token', 'TEXT');
    
    // Add missing columns to workflow_settings
    console.log('\nUpdating workflow_settings...');
    await addColumn('workflow_settings', 'repository_name', 'TEXT');
    await addColumn('workflow_settings', 'project_name', 'TEXT');
    await addColumn('workflow_settings', 'organization_url', 'TEXT');
    await addColumn('workflow_settings', 'pat_token', 'TEXT');
    
    console.log('\n✓ Schema fixed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Error fixing schema:', error);
    process.exit(1);
  }
}

fixSchema();
