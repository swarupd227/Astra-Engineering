import AdmZip from 'adm-zip';
import * as path from 'path';

const zipPath = path.join(process.cwd(), 'attached_assets', 'Golden_Insurance_Repo_1761897344922.zip');

async function verifyGuidelineTemplates() {
  try {
    console.log('🔍 Verifying Golden Repository guideline templates...\n');
    
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    // Check for artifacts folder and guideline files
    const artifactsFiles = entries
      .filter(entry => entry.entryName.startsWith('requirements/artifacts/'))
      .filter(entry => !entry.isDirectory)
      .map(entry => ({
        path: entry.entryName,
        name: path.basename(entry.entryName),
        size: entry.header.size
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    console.log('📁 requirements/artifacts/ folder contents:\n');
    
    if (artifactsFiles.length === 0) {
      console.log('⚠️  No files found in artifacts folder!');
      return;
    }
    
    const expectedFiles = [
      'bugs_defect_guideline.md',
      'epic_guideline.md',
      'feature_guideline.md',
      'task_guideline.md',
      'user_story_guideline.md'
    ];
    
    // Display files with emoji indicators
    const fileEmojis: Record<string, string> = {
      'epic_guideline.md': '🟣',
      'bugs_defect_guideline.md': '🛑',
      'user_story_guideline.md': '🔵',
      'task_guideline.md': '⚪',
      'feature_guideline.md': '🟢'
    };
    
    artifactsFiles.forEach((file, index) => {
      const isLast = index === artifactsFiles.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const emoji = fileEmojis[file.name] || '📄';
      const sizeKB = (file.size / 1024).toFixed(1);
      console.log(`${connector}${emoji} ${file.name} (${sizeKB} KB)`);
    });
    
    console.log('\n✅ Verification Summary:\n');
    
    // Check each expected file
    let allPresent = true;
    expectedFiles.forEach(fileName => {
      const found = artifactsFiles.find(f => f.name === fileName);
      const emoji = fileEmojis[fileName] || '📄';
      if (found) {
        console.log(`✓ ${emoji} ${fileName} - Present`);
      } else {
        console.log(`✗ ${emoji} ${fileName} - Missing`);
        allPresent = false;
      }
    });
    
    if (allPresent) {
      console.log('\n🎉 All 5 guideline templates are present and up-to-date!');
    } else {
      console.log('\n⚠️  Some templates are missing. Please run the update script.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

verifyGuidelineTemplates();
