import JSZip from 'jszip';

export interface FileTreeNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileTreeNode[];
  size?: number;
}

export class StarterCodeService {
  private static zipInstance: JSZip | null = null;
  private static treeCache: FileTreeNode | null = null;

  static async loadZip(): Promise<JSZip> {
    if (this.zipInstance) {
      return this.zipInstance;
    }

    const response = await fetch('/starter-code.zip');
    if (!response.ok) {
      throw new Error('Failed to load starter code zip');
    }

    const blob = await response.blob();
    const zip = new JSZip();
    this.zipInstance = await zip.loadAsync(blob);
    return this.zipInstance;
  }

  static async getFileTree(): Promise<FileTreeNode> {
    if (this.treeCache) {
      return this.treeCache;
    }

    const zip = await this.loadZip();
    const tree: FileTreeNode = {
      name: 'Starter Code',
      type: 'folder',
      path: '',
      children: [],
    };

    const pathMap = new Map<string, FileTreeNode>();
    pathMap.set('', tree);

    // Process all entries in the zip (both files and directories)
    const entries = Object.keys(zip.files).sort();
    
    for (const filePath of entries) {
      const file = zip.files[filePath];
      if (!filePath.startsWith('Starter_code/')) continue;

      // Remove the Starter_code/ prefix
      const relativePath = filePath.substring('Starter_code/'.length);
      if (!relativePath || relativePath.endsWith('/')) continue; // Skip root and directories themselves

      const parts = relativePath.split('/');
      let currentPath = '';

      // Create all folder nodes in the path
      for (let i = 0; i < parts.length - 1; i++) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        if (!pathMap.has(currentPath)) {
          const folderNode: FileTreeNode = {
            name: parts[i],
            type: 'folder',
            path: currentPath,
            children: [],
          };

          const parent = pathMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(folderNode);
          }
          pathMap.set(currentPath, folderNode);
        }
      }

      // Create file node (only for actual files, not directories)
      if (!file.dir) {
        const fileName = parts[parts.length - 1];
        const fullFilePath = parts.join('/');
        const fileNode: FileTreeNode = {
          name: fileName,
          type: 'file',
          path: fullFilePath,
        };

        const parentPath = parts.slice(0, -1).join('/');
        const parent = pathMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(fileNode);
        }
      }
    }

    // Sort children: folders first, then alphabetically
    const sortNode = (node: FileTreeNode) => {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === 'folder' ? -1 : 1;
        });
        node.children.forEach(sortNode);
      }
    };

    sortNode(tree);
    
    // Log tree statistics for verification
    const countNodes = (node: FileTreeNode): { files: number; folders: number } => {
      let files = 0;
      let folders = 0;
      if (node.type === 'file') files = 1;
      if (node.type === 'folder') folders = 1;
      if (node.children) {
        node.children.forEach(child => {
          const counts = countNodes(child);
          files += counts.files;
          folders += counts.folders;
        });
      }
      return { files, folders };
    };
    
    const stats = countNodes(tree);
    console.log('📦 Starter Code Loaded:');
    console.log(`  - ${tree.children?.length || 0} framework folders`);
    console.log(`  - ${stats.folders} total folders`);
    console.log(`  - ${stats.files} total files`);
    console.log('  - Framework folders:', tree.children?.map(c => c.name).join(', '));
    
    // Log Angular_starter_code structure as proof all files are loaded
    const angularFolder = tree.children?.find(c => c.name === 'Angular_starter_code');
    if (angularFolder) {
      console.log('\n📂 Angular_starter_code structure (sample):');
      const printTree = (node: FileTreeNode, indent: string = '', maxDepth: number = 4, currentDepth: number = 0) => {
        if (currentDepth >= maxDepth) return;
        const files = node.children?.filter(c => c.type === 'file') || [];
        const folders = node.children?.filter(c => c.type === 'folder') || [];
        
        // Show all files at root level, limited files in deep folders
        const filesToShow = currentDepth === 0 ? files : files.slice(0, 3);
        filesToShow.forEach(file => {
          console.log(`${indent}├── ${file.name}`);
        });
        if (files.length > filesToShow.length) {
          console.log(`${indent}├── ... ${files.length - filesToShow.length} more files`);
        }
        
        folders.forEach((folder, idx) => {
          const isLast = idx === folders.length - 1;
          console.log(`${indent}├── ${folder.name}/`);
          printTree(folder, indent + '│   ', maxDepth, currentDepth + 1);
        });
      };
      printTree(angularFolder);
    }
    
    this.treeCache = tree;
    return tree;
  }

  static async getFileContent(filePath: string): Promise<{ content: string; size: number; name: string }> {
    const zip = await this.loadZip();
    const fullPath = `Starter_code/${filePath}`;
    const file = zip.file(fullPath);

    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await file.async('text');
    const fileName = filePath.split('/').pop() || filePath;

    return {
      content,
      size: content.length,
      name: fileName,
    };
  }

  static clearCache() {
    this.treeCache = null;
    this.zipInstance = null;
  }
}
