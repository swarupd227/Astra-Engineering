/**
 * Configuration for Jira integration
 * Provides access to Jira and Azure OpenAI settings
 * 
 * Note: This is a frontend-friendly config that can work in browser contexts
 * For production, consider using environment variables or a backend API
 */

export interface JiraConfig {
  // Jira/Confluence settings
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  confluenceSpaceKey?: string;
  
  // Azure OpenAI settings
  azureOpenAIEndpoint?: string;
  azureOpenAIApiKey?: string;
  azureOpenAIDeployment?: string;
  azureOpenAIApiVersion?: string;
}

// Default config - can be overridden
let configCache: JiraConfig | null = null;

/**
 * Get configuration for Jira integration
 * 
 * This function attempts to get config from:
 * 1. Browser localStorage (if available)
 * 2. Environment variables (if in Node.js/server context)
 * 3. Default values
 * 
 * For production, you may want to fetch this from a backend API
 */
export const getConfig = (): JiraConfig => {
  // Return cached config if available
  if (configCache) {
    return configCache;
  }

  const config: JiraConfig = {};

  // Try to get from browser localStorage (for frontend usage)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem('jiraConfig');
      if (stored) {
        const parsed = JSON.parse(stored);
        config.jiraBaseUrl = parsed.jiraBaseUrl;
        config.jiraEmail = parsed.jiraEmail;
        config.jiraApiToken = parsed.jiraApiToken;
        config.confluenceSpaceKey = parsed.confluenceSpaceKey;
        config.azureOpenAIEndpoint = parsed.azureOpenAIEndpoint;
        config.azureOpenAIApiKey = parsed.azureOpenAIApiKey;
        config.azureOpenAIDeployment = parsed.azureOpenAIDeployment;
        config.azureOpenAIApiVersion = parsed.azureOpenAIApiVersion || '2024-02-01';
      }
    } catch (e) {
      console.warn('Failed to load config from localStorage:', e);
    }
  }

  // Try to get from environment variables (for server/Node.js usage)
  if (typeof process !== 'undefined' && process.env) {
    config.jiraBaseUrl = config.jiraBaseUrl || process.env.JIRA_BASE_URL;
    config.jiraEmail = config.jiraEmail || process.env.JIRA_EMAIL;
    config.jiraApiToken = config.jiraApiToken || process.env.JIRA_API_TOKEN;
    config.confluenceSpaceKey = config.confluenceSpaceKey || process.env.CONFLUENCE_SPACE_KEY;
    config.azureOpenAIEndpoint = config.azureOpenAIEndpoint || process.env.AZURE_OPENAI_ENDPOINT;
    config.azureOpenAIApiKey = config.azureOpenAIApiKey || process.env.AZURE_OPENAI_API_KEY;
    config.azureOpenAIDeployment = config.azureOpenAIDeployment || process.env.AZURE_OPENAI_DEPLOYMENT;
    config.azureOpenAIApiVersion = config.azureOpenAIApiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';
  }

  // Cache the config
  configCache = config;
  return config;
};

/**
 * Set configuration (useful for updating config at runtime)
 */
export const setConfig = (newConfig: Partial<JiraConfig>): void => {
  const currentConfig = getConfig();
  const updatedConfig = { ...currentConfig, ...newConfig };
  configCache = updatedConfig;

  // Also save to localStorage if available
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem('jiraConfig', JSON.stringify(updatedConfig));
    } catch (e) {
      console.warn('Failed to save config to localStorage:', e);
    }
  }
};

/**
 * Clear cached config (useful for testing or re-fetching)
 */
export const clearConfigCache = (): void => {
  configCache = null;
};
