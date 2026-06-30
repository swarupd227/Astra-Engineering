/**
 * SVG Utilities
 * Functions to process and convert SVG for Confluence embedding
 * Based on the reference implementation that successfully renders SVG in Confluence
 */

/**
 * Converts SVG string to data URI
 * This is the format that works reliably in Confluence
 */
export function svgToDataUri(svg: string): string {
  // Ensure SVG is properly formatted
  const processedSvg = processSvgForConfluence(svg);
  
  // Encode SVG for data URI
  const encoded = encodeURIComponent(processedSvg);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

/**
 * Processes SVG to ensure it has proper attributes for Confluence rendering
 * IMPORTANT: Preserves original viewBox and dimensions from Mermaid
 * DO NOT modify viewBox as it will break the diagram rendering
 */
export function processSvgForConfluence(svg: string): string {
  let processedSvg = svg.trim();
  
  // Ensure SVG has xmlns for proper rendering (required for Confluence)
  if (!processedSvg.includes('xmlns=')) {
    processedSvg = processedSvg.replace(
      /<svg([^>]*)>/i,
      '<svg$1 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    );
  }
  
  // Extract existing viewBox to preserve it (DO NOT modify)
  const viewBoxMatch = processedSvg.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = processedSvg.match(/width=["']([^"']+)["']/i);
  const heightMatch = processedSvg.match(/height=["']([^"']+)["']/i);
  
  // Ensure viewBox exists - if not, try to extract from width/height or use defaults
  if (!viewBoxMatch) {
    if (widthMatch && heightMatch) {
      const width = widthMatch[1];
      const height = heightMatch[1];
      // Only add viewBox if it's missing - preserve original dimensions
      processedSvg = processedSvg.replace(
        /<svg([^>]*)>/i,
        `<svg$1 viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`
      );
    } else {
      // Only add default viewBox if absolutely no dimensions exist
      processedSvg = processedSvg.replace(
        /<svg([^>]*)>/i,
        '<svg$1 viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">'
      );
    }
  }
  
  // Ensure width and height are set (preserve existing values, don't override)
  if (!widthMatch) {
    // Extract width from viewBox if available
    if (viewBoxMatch) {
      const viewBoxValues = viewBoxMatch[1].split(/\s+/);
      if (viewBoxValues.length >= 4) {
        const width = viewBoxValues[2];
        processedSvg = processedSvg.replace(
          /<svg([^>]*)>/i,
          `<svg$1 width="${width}">`
        );
      }
    }
  }
  
  if (!heightMatch) {
    // Extract height from viewBox if available
    if (viewBoxMatch) {
      const viewBoxValues = viewBoxMatch[1].split(/\s+/);
      if (viewBoxValues.length >= 4) {
        const height = viewBoxValues[3];
        processedSvg = processedSvg.replace(
          /<svg([^>]*)>/i,
          `<svg$1 height="${height}">`
        );
      }
    }
  }
  
  return processedSvg;
}

/**
 * Converts SVG to HTML content for Confluence embedding
 * Uses data URI approach (primary) with fallback to direct embedding
 * Based on the reference jiraConfluenceService.ts implementation
 */
export function svgToConfluenceHtml(svg: string, title: string = 'Diagram'): string {
  // Process SVG first
  const processedSvg = processSvgForConfluence(svg);
  
  // Try data URI approach first (faster and should work in Confluence)
  try {
    const svgDataUri = svgToDataUri(processedSvg);
    
    // Embed as image using SVG data URI - Confluence should render this
    // Use larger size styling for better visibility
    return `
      <p style="text-align: center; padding: 20px;">
        <img src="${svgDataUri}" alt="${title}" style="width: 100%; max-width: 1600px; height: auto; border: none; display: block; margin: 0 auto;" />
      </p>
    `;
  } catch (error) {
    console.warn('[SvgUtils] Failed to create SVG data URI, using direct embedding:', error);
    // Fallback to direct SVG embedding with larger size
    return `
      <div style="text-align: center; padding: 20px; overflow-x: auto;">
        <div style="width: 100%; max-width: 1600px; margin: 0 auto;">
          ${processedSvg}
        </div>
      </div>
    `;
  }
}
