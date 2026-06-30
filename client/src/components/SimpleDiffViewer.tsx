import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';

interface SimpleDiffViewerProps {
  original: string;
  modified: string;
  onModifiedChange?: (value: string) => void;
  title?: string;
  className?: string;
}
// Hybrid smart diff: line-level + word-level analysis
function computeHybridDiff(original: string, modified: string) {
  if (original === modified) {
    return {
      originalElements: [{ text: original, type: 'equal' as const }],
      modifiedElements: [{ text: modified, type: 'equal' as const }]
    };
  }

  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  
  // First pass: find exactly matching lines
  const originalMatched = new Set<number>();
  const modifiedMatched = new Set<number>();
  const lineMatches = new Map<number, number>();
  
  // Find exact line matches
  for (let i = 0; i < originalLines.length; i++) {
    for (let j = 0; j < modifiedLines.length; j++) {
      if (!originalMatched.has(i) && !modifiedMatched.has(j) && 
          originalLines[i].trim() === modifiedLines[j].trim()) {
        originalMatched.add(i);
        modifiedMatched.add(j);
        lineMatches.set(i, j);
        break;
      }
    }
  }

  const originalElements: Array<{text: string, type: 'equal' | 'removed' | 'changed'}> = [];
  const modifiedElements: Array<{text: string, type: 'equal' | 'added' | 'changed'}> = [];

  let origIndex = 0;
  let modIndex = 0;

  while (origIndex < originalLines.length || modIndex < modifiedLines.length) {
    // Check if we have exact line matches
    if (origIndex < originalLines.length && lineMatches.has(origIndex)) {
      const matchedModIndex = lineMatches.get(origIndex)!;
      
      // Add any unmatched modified lines before this match as additions
      while (modIndex < matchedModIndex) {
        if (!modifiedMatched.has(modIndex)) {
          modifiedElements.push({ 
            text: modifiedLines[modIndex] + (modIndex < modifiedLines.length - 1 ? '\n' : ''), 
            type: 'added' 
          });
        }
        modIndex++;
      }
      
      // Add the matched line
      const line = originalLines[origIndex] + (origIndex < originalLines.length - 1 ? '\n' : '');
      originalElements.push({ text: line, type: 'equal' });
      modifiedElements.push({ text: line, type: 'equal' });
      
      origIndex++;
      modIndex++;
    } else if (origIndex < originalLines.length && !originalMatched.has(origIndex)) {
      // This original line doesn't have an exact match
      let foundSimilar = false;
      
      // Look for similar lines (word-level comparison)
      for (let j = modIndex; j < modifiedLines.length && j < modIndex + 3; j++) {
        if (!modifiedMatched.has(j)) {
          const similarity = calculateLineSimilarity(originalLines[origIndex], modifiedLines[j]);
          if (similarity > 0.3) { // 30% similarity threshold
            // Found similar lines - treat as changed
            const origLine = originalLines[origIndex] + (origIndex < originalLines.length - 1 ? '\n' : '');
            const modLine = modifiedLines[j] + (j < modifiedLines.length - 1 ? '\n' : '');
            
            // Add any skipped modified lines as additions
            for (let k = modIndex; k < j; k++) {
              if (!modifiedMatched.has(k)) {
                modifiedElements.push({ 
                  text: modifiedLines[k] + (k < modifiedLines.length - 1 ? '\n' : ''), 
                  type: 'added' 
                });
              }
            }
            
            originalElements.push({ text: origLine, type: 'changed' });
            modifiedElements.push({ text: modLine, type: 'changed' });
            
            modIndex = j + 1;
            foundSimilar = true;
            break;
          }
        }
      }
      
      if (!foundSimilar) {
        // No similar line found - mark as removed
        const line = originalLines[origIndex] + (origIndex < originalLines.length - 1 ? '\n' : '');
        originalElements.push({ text: line, type: 'removed' });
      }
      
      origIndex++;
    } else if (modIndex < modifiedLines.length && !modifiedMatched.has(modIndex)) {
      // This modified line doesn't have a match - mark as added
      const line = modifiedLines[modIndex] + (modIndex < modifiedLines.length - 1 ? '\n' : '');
      modifiedElements.push({ text: line, type: 'added' });
      modIndex++;
    } else {
      // Skip already matched lines
      if (origIndex < originalLines.length) origIndex++;
      if (modIndex < modifiedLines.length) modIndex++;
    }
  }

  return { originalElements, modifiedElements };
}

// Calculate similarity between two lines using word overlap
function calculateLineSimilarity(line1: string, line2: string): number {
  const words1 = line1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = line2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const commonWords = words1.filter(word => words2.includes(word));
  const totalWords = Math.max(words1.length, words2.length);
  
  return commonWords.length / totalWords;
}
export function SimpleDiffViewer({
  original,
  modified,
  onModifiedChange,
  title = "Text Comparison",
  className = ""
}: SimpleDiffViewerProps) {
  const [currentModified, setCurrentModified] = useState(modified);
  const hasChanges = currentModified !== original;
  
  // Single ref for the shared scroll container
  const sharedScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Compute hybrid smart diff that handles isolated changes intelligently
  const { originalElements, modifiedElements } = computeHybridDiff(original, currentModified);

  const handleModifiedChange = (value: string) => {
    setCurrentModified(value);
    onModifiedChange?.(value);
  };

  return (
    <div className={`w-full h-full flex flex-col ${className}`}>
      <div className="flex-shrink-0 p-4 border-b">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>

      {/* Table-based layout for perfect alignment */}
      <div 
        ref={sharedScrollRef}
        className="flex-1 overflow-auto"
        style={{ minHeight: 0 }}
      >
        <table className="w-full h-full border-collapse">
          {/* Table Header Row */}
          <thead>
            <tr>
              <th className="w-1/2 bg-gray-100 border-r border-gray-300 border-b border-gray-300 p-6 text-left align-top">
                <div className="font-medium text-sm text-gray-700 flex items-center gap-2">
                  <div className="w-3 h-3 bg-gray-300 border border-gray-500 rounded-sm"></div>
                  Original Text
                </div>
              </th>
              <th className="w-1/2 bg-blue-100 border-b border-gray-300 p-6 text-left align-top">
                <div className="font-medium text-sm text-gray-700 flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-300 border border-blue-500 rounded-sm"></div>
                  Enhanced Text (Editable)
                </div>
              </th>
            </tr>
          </thead>
          
          {/* Table Body with Content */}
          <tbody>
            <tr>
              {/* Left Cell: Original Text */}
              <td className="w-1/2 bg-gray-50 border-r border-gray-300 p-6 align-top vertical-align-top">
                <div className="whitespace-pre-wrap text-sm text-gray-900 font-mono leading-6">
                  {originalElements.map((element, index) => (
                    <span 
                      key={index} 
                      className={
                        element.type === 'removed' 
                          ? 'bg-red-100 text-red-800 px-1 rounded' 
                          : element.type === 'changed'
                          ? 'bg-orange-100 text-orange-800 px-1 rounded'
                          : ''
                      }
                    >
                      {element.text}
                    </span>
                  ))}
                </div>
              </td>
              
              {/* Right Cell: Enhanced Text */}
              <td className="w-1/2 bg-blue-50 p-6 align-top vertical-align-top relative">
                <div className="whitespace-pre-wrap text-sm text-gray-900 font-mono leading-6 relative">
                  {modifiedElements.map((element, index) => (
                    <span 
                      key={index} 
                      className={
                        element.type === 'added' 
                          ? 'bg-green-100 text-green-800 px-1 rounded' 
                          : element.type === 'changed'
                          ? 'bg-blue-100 text-blue-800 px-1 rounded'
                          : ''
                      }
                    >
                      {element.text}
                    </span>
                  ))}
                  
                  {/* Transparent overlay textarea */}
                  <textarea
                    ref={textareaRef}
                    value={currentModified}
                    onChange={(e) => handleModifiedChange(e.target.value)}
                    className="absolute inset-0 w-full h-full bg-transparent border-0 resize-none font-mono text-sm leading-6 focus:outline-none focus:ring-0"
                    style={{ 
                      overflow: 'hidden',
                      color: 'transparent', // hide duplicate text (we render it underneath)
                      caretColor: '#111827', // show a visible blinking cursor (gray-900)
                      padding: '0',
                      margin: '0'
                    }}
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      {/* Status bar */}
      <div className="flex-shrink-0 px-4 py-2 bg-gray-50 border-t text-xs text-gray-500 flex justify-between">
        <div>
          {hasChanges ? (
            <span className="text-orange-600 font-medium">● Modified</span>
          ) : (
            <span className="text-green-600">✓ No changes</span>
          )}
        </div>
        <div>
          Lines: {currentModified.split('\n').length} | 
          Characters: {currentModified.length}
        </div>
      </div>
    </div>
  );
}

export default SimpleDiffViewer;