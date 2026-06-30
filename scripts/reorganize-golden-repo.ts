import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';

const zipPath = path.join(process.cwd(), 'attached_assets', 'Golden_Insurance_Repo_1761897344922.zip');
const tempDir = path.join(process.cwd(), 'temp_golden_repo');

async function reorganizeGoldenRepo() {
  try {
    console.log('Starting Golden Repository reorganization...');
    
    // 1. Extract the zip file
    console.log('Extracting zip file...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    
    // 2. Check current structure
    const requirementsPath = path.join(tempDir, 'requirements');
    if (!fs.existsSync(requirementsPath)) {
      console.log('Creating requirements folder...');
      fs.mkdirSync(requirementsPath, { recursive: true });
    }
    
    // List current files
    console.log('\nCurrent requirements folder structure:');
    if (fs.existsSync(requirementsPath)) {
      const files = fs.readdirSync(requirementsPath);
      files.forEach(file => console.log(`  - ${file}`));
    }
    
    // 3. Create artifacts subfolder
    const artifactsPath = path.join(requirementsPath, 'artifacts');
    console.log('\nCreating artifacts subfolder...');
    if (!fs.existsSync(artifactsPath)) {
      fs.mkdirSync(artifactsPath, { recursive: true });
      console.log('✓ Created: requirements/artifacts/');
    } else {
      console.log('✓ artifacts/ folder already exists');
    }
    
    // 4. Move guideline files to artifacts/
    const filesToMove = [
      'task_guideline.md',
      'feature_guideline.md',
      'user_story_guideline.md'
    ];
    
    console.log('\nMoving guideline files to artifacts/...');
    for (const file of filesToMove) {
      const sourcePath = path.join(requirementsPath, file);
      const destPath = path.join(artifactsPath, file);
      
      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, destPath);
        console.log(`✓ Moved: ${file} → artifacts/`);
      } else {
        console.log(`⚠ File not found: ${file} (will be created as placeholder)`);
        // Create placeholder file
        fs.writeFileSync(destPath, `# ${file.replace('.md', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}\n\nPlaceholder content for ${file}\n`);
        console.log(`✓ Created: artifacts/${file}`);
      }
    }
    
    // 5. Delete user-stories.md if it exists
    const userStoriesPath = path.join(requirementsPath, 'user-stories.md');
    if (fs.existsSync(userStoriesPath)) {
      fs.unlinkSync(userStoriesPath);
      console.log('✓ Deleted: user-stories.md');
    } else {
      console.log('⚠ user-stories.md not found (already deleted or never existed)');
    }
    
    // 6. Display final structure
    console.log('\n📁 Final requirements folder structure:');
    function displayTree(dir: string, prefix: string = '') {
      const items = fs.readdirSync(dir);
      items.forEach((item, index) => {
        const itemPath = path.join(dir, item);
        const isLast = index === items.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        console.log(prefix + connector + item);
        
        if (fs.statSync(itemPath).isDirectory()) {
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          displayTree(itemPath, newPrefix);
        }
      });
    }
    displayTree(requirementsPath);
    
    // 7. Create new zip file with updated structure
    console.log('\nCreating updated zip file...');
    const newZip = new AdmZip();
    
    // Add all files from temp directory to new zip
    function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPath: string = '') {
      const items = fs.readdirSync(dirPath);
      items.forEach(item => {
        const itemPath = path.join(dirPath, item);
        const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
        
        if (fs.statSync(itemPath).isDirectory()) {
          addDirectoryToZip(zip, itemPath, itemZipPath);
        } else {
          zip.addLocalFile(itemPath, zipPath);
        }
      });
    }
    
    addDirectoryToZip(newZip, tempDir);
    
    // Backup original zip
    const backupPath = zipPath.replace('.zip', '_backup.zip');
    if (fs.existsSync(zipPath)) {
      fs.copyFileSync(zipPath, backupPath);
      console.log(`✓ Backed up original: ${path.basename(backupPath)}`);
    }
    
    // Write new zip
    newZip.writeZip(zipPath);
    console.log('✓ Updated zip file created successfully');
    
    // 8. Cleanup temp directory
    console.log('\nCleaning up temporary files...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete');
    
    console.log('\n✅ Golden Repository reorganization completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

reorganizeGoldenRepo();
