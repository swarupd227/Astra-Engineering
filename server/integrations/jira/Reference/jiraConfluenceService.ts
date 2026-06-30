import { getConfig } from '../config';
import { svgToDataUri } from '../svg-utils';

export interface ConfluencePage {
  id?: string;
  title: string;
  spaceKey: string;
  body: string;
}

const getAuthHeader = (): string => {
  const config = getConfig();
  const credentials = btoa(`${config.jiraEmail}:${config.jiraApiToken}`);
  return `Basic ${credentials}`;
};

const getBaseUrl = (): string => {
  const config = getConfig();
  if (!config.jiraBaseUrl) {
    throw new Error('Jira Base URL is not configured');
  }
  return config.jiraBaseUrl.replace(/\/$/, '');
};

// Helper function to make API calls through proxy or directly
const makeApiCall = async (
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<Response> => {
  const { method = 'GET', headers = {}, body } = options;
  const PROXY_URL = 'http://localhost:3001/api/proxy';

  // Try proxy first (if available)
  try {
    const proxyResponse = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        method,
        headers,
        body,
      }),
    });

    if (proxyResponse.ok) {
      const proxyData = await proxyResponse.json();
      // Create a proper Response object from the proxy data
      const responseData = typeof proxyData.data === 'string' 
        ? proxyData.data 
        : JSON.stringify(proxyData.data);
      
      return new Response(responseData, {
        status: proxyData.status,
        statusText: proxyData.statusText,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } else {
      // Proxy returned an error, throw it
      const errorData = await proxyResponse.json().catch(() => ({}));
      throw new Error(`Proxy error: ${proxyResponse.status} ${JSON.stringify(errorData)}`);
    }
  } catch (proxyError) {
    // If proxy is not available, check if it's a connection error
    if (proxyError instanceof TypeError && proxyError.message.includes('Failed to fetch')) {
      console.warn('Proxy server not available. Make sure to run: npm run dev:proxy');
      throw new Error(
        'Proxy server not running. Please start it with: npm run dev:proxy\n' +
        'Or run both servers together with: npm run dev:all'
      );
    }
    // Re-throw other proxy errors
    throw proxyError;
  }
};

export const createConfluencePage = async (
  title: string,
  svgContent: string,
  spaceKey?: string
): Promise<ConfluencePage> => {
  const config = getConfig();
  const targetSpaceKey = spaceKey || config.confluenceSpaceKey;
  
  if (!config.jiraBaseUrl || !config.jiraEmail || !config.jiraApiToken) {
    throw new Error('Jira configuration is incomplete. Please check your settings.');
  }

  if (!targetSpaceKey) {
    throw new Error('Confluence space key is required');
  }

  // Validate that we have SVG content, not Mermaid syntax
  if (!svgContent || svgContent.trim().length === 0) {
    throw new Error('SVG content is required. Please ensure the diagram has been converted to SVG.');
  }

  // Check if content looks like SVG (starts with <svg)
  if (!svgContent.trim().toLowerCase().startsWith('<svg')) {
    throw new Error('Invalid SVG content. The diagram must be converted to SVG format before pushing to Confluence.');
  }

  // Process SVG to ensure it has proper attributes for Confluence
  // IMPORTANT: Preserve the original viewBox and dimensions from Mermaid
  // DO NOT modify viewBox as it will break the diagram rendering
  let processedSvg = svgContent.trim();
  
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

  console.log('SVG length:', processedSvg.length);
  console.log('SVG preview (first 200 chars):', processedSvg.substring(0, 200));
  
  let finalHtmlContent: string;

  // Use SVG data URI directly - faster and should work in Confluence
  // IMPORTANT: Use the processed SVG directly without additional processing
  // The SVG from mermaidService already has correct viewBox and dimensions
  try {
    console.log('Converting SVG to data URI...');
    // Encode SVG for data URI (don't process again - svgToDataUri processes it)
    // Use processedSvg directly since we only added xmlns if missing
    const encoded = encodeURIComponent(processedSvg);
    const svgDataUri = `data:image/svg+xml;charset=utf-8,${encoded}`;
    console.log('SVG data URI created, length:', svgDataUri.length);
    
    // Embed as image using SVG data URI - Confluence should render this
    // Use responsive styling that preserves aspect ratio
    finalHtmlContent = `
      <p style="text-align: center; padding: 20px;">
        <img src="${svgDataUri}" alt="${title}" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto;" />
      </p>
    `;
  } catch (error) {
    console.warn('Failed to create SVG data URI, using direct embedding:', error);
    // Fallback to direct SVG embedding - preserve original SVG
    finalHtmlContent = `
      <div style="text-align: center; padding: 20px; overflow-x: auto;">
        <div style="max-width: 100%; margin: 0 auto;">
          ${processedSvg}
        </div>
      </div>
    `;
  }
  
  console.log('HTML content created, length:', finalHtmlContent.length);

  const pageData = {
    type: 'page',
    title: title,
    space: {
      key: targetSpaceKey,
    },
    body: {
      storage: {
        value: finalHtmlContent,
        representation: 'storage',
      },
    },
  };
  
  console.log('Page data being sent:', JSON.stringify(pageData).substring(0, 500));

  try {
    const response = await makeApiCall(`${getBaseUrl()}/wiki/rest/api/content`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: pageData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Confluence page: ${response.status} ${errorText}`);
    }

    const createdPage = await response.json();
    return {
      id: createdPage.id,
      title: createdPage.title,
      spaceKey: targetSpaceKey,
      body: finalHtmlContent,
    };
  } catch (error) {
    console.error('Error creating Confluence page:', error);
    throw new Error(`Failed to create Confluence page: ${error}`);
  }
};

export const updateConfluencePage = async (
  pageId: string,
  title: string,
  svgContent: string,
  version: number
): Promise<ConfluencePage> => {
  const config = getConfig();

  // Validate SVG content
  if (!svgContent || !svgContent.trim().toLowerCase().startsWith('<svg')) {
    throw new Error('Invalid SVG content');
  }

  // Process SVG the same way as create function
  let processedSvg = svgContent.trim();
  
  if (!processedSvg.includes('style=')) {
    processedSvg = processedSvg.replace(
      /<svg([^>]*)>/i,
      '<svg$1 style="max-width: 100%; height: auto; display: block; margin: 0 auto;">'
    );
  } else {
    if (!processedSvg.includes('display:')) {
      processedSvg = processedSvg.replace(
        /style="([^"]*)"/i,
        'style="$1; max-width: 100%; height: auto; display: block; margin: 0 auto;"'
      );
    }
  }

  const htmlContent = `
    <div style="text-align: center; padding: 20px; overflow-x: auto;">
      ${processedSvg}
    </div>
  `;

  const pageData = {
    type: 'page',
    title: title,
    version: {
      number: version + 1,
    },
    body: {
      storage: {
        value: htmlContent,
        representation: 'storage',
      },
    },
  };

  try {
    const response = await makeApiCall(`${getBaseUrl()}/wiki/rest/api/content/${pageId}`, {
      method: 'PUT',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: pageData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update Confluence page: ${response.status} ${errorText}`);
    }

    const updatedPage = await response.json();
    const config = getConfig();
    if (!config.confluenceSpaceKey) {
      throw new Error('Confluence space key is not configured');
    }
    return {
      id: updatedPage.id,
      title: updatedPage.title,
      spaceKey: config.confluenceSpaceKey,
      body: htmlContent,
    };
  } catch (error) {
    console.error('Error updating Confluence page:', error);
    throw new Error(`Failed to update Confluence page: ${error}`);
  }
};

export interface ConfluenceSpace {
  key: string;
  name: string;
  type: string;
}

export const getConfluenceSpaces = async (): Promise<ConfluenceSpace[]> => {
  const baseUrl = getBaseUrl();
  
  if (!baseUrl) {
    throw new Error('Jira Base URL is not configured');
  }

  const url = `${baseUrl}/wiki/rest/api/space?limit=100`;
  
  try {
    const response = await makeApiCall(url, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch spaces: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('Invalid response format from Confluence API');
    }
    
    return data.results.map((space: any) => ({
      key: space.key,
      name: space.name,
      type: space.type,
    }));
  } catch (error) {
    console.error('Error fetching Confluence spaces:', error);
    console.error('Request URL:', url);
    
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      // This is likely a CORS issue
      throw new Error(
        'CORS Error: Unable to fetch spaces from browser. ' +
        'This is a browser security restriction. ' +
        'Please enter the Space Key manually, or use a backend proxy. ' +
        `Attempted URL: ${url}`
      );
    }
    
    throw new Error(`Failed to fetch Confluence spaces: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const testConnection = async (): Promise<boolean> => {
  const baseUrl = getBaseUrl();
  
  if (!baseUrl) {
    throw new Error('Jira Base URL is not configured');
  }

  try {
    const response = await makeApiCall(`${baseUrl}/wiki/rest/api/user/current`, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
    });

    return response.ok;
  } catch (error) {
    console.error('Connection test failed:', error);
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error(
        'CORS Error: Unable to connect from browser. ' +
        'This is a browser security restriction. ' +
        'For production, use a backend proxy server.'
      );
    }
    throw error;
  }
};
