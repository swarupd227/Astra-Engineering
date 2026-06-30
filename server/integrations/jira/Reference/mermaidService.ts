import mermaid from 'mermaid';
import { getConfig } from '../config';

// Initialize Mermaid with larger default size
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: false, // Changed to false to allow larger diagrams
    htmlLabels: true,
    curve: 'basis',
    diagramPadding: 20, // Add padding
  },
  // Set larger default dimensions
  gantt: {
    useMaxWidth: false,
  },
  sequence: {
    useMaxWidth: false,
    diagramMarginX: 50,
    diagramMarginY: 10,
  },
});

export const renderMermaidToSvg = async (
  mermaidSyntax: string,
  containerId: string
): Promise<string> => {
  try {
    // First, render to DOM to get SVG
    const { svg } = await mermaid.render(`${containerId}_svg`, mermaidSyntax);
    return svg;
  } catch (error) {
    console.error('Error rendering Mermaid to SVG:', error);
    throw new Error(`Failed to render Mermaid diagram: ${error}`);
  }
};

export const mermaidToSvgString = async (mermaidSyntax: string): Promise<string> => {
  // Create a temporary unique ID
  const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { svg } = await mermaid.render(tempId, mermaidSyntax);
    
    // Ensure SVG has proper attributes for Confluence rendering
    // IMPORTANT: Preserve the original viewBox from Mermaid - DO NOT modify it
    // Mermaid generates the correct viewBox for the diagram
    let processedSvg = svg;
    
    // Add xmlns if missing (required for proper SVG rendering in Confluence)
    if (!processedSvg.includes('xmlns=')) {
      processedSvg = processedSvg.replace(
        /<svg([^>]*)>/i,
        '<svg$1 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
      );
    }
    
    // Mermaid already generates viewBox and dimensions correctly
    // Only add viewBox if it's completely missing (shouldn't happen with Mermaid)
    if (!processedSvg.includes('viewBox=') && !processedSvg.includes('width=')) {
      // Only add default viewBox if absolutely no dimensions exist
      processedSvg = processedSvg.replace(
        /<svg([^>]*)>/i,
        '<svg$1 viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">'
      );
    }
    // DO NOT modify existing viewBox - Mermaid generates it correctly
    
    return processedSvg;
  } catch (error) {
    console.error('Error converting Mermaid to SVG:', error);
    throw new Error(`Failed to convert Mermaid to SVG: ${error}`);
  }
};
