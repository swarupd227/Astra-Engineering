import OpenAI from "openai";
import { hasBedrock, azureOpenAI as bedrockLLM } from "../../llm-config";

type ChatClient = {
  chat: {
    completions: {
      create: (...args: any[]) => Promise<any>;
    };
  };
};

let cachedClient: ChatClient | null | undefined;

export function getOptionalSuperAgentLlmClient(): ChatClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  if (hasBedrock && bedrockLLM) {
    cachedClient = bedrockLLM as ChatClient;
    return cachedClient;
  }

  const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (azureApiKey && azureEndpoint && azureDeployment) {
    cachedClient = new OpenAI({
      apiKey: azureApiKey,
      baseURL: `${azureEndpoint}openai/deployments/${azureDeployment}`,
      defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
      defaultHeaders: { "api-key": azureApiKey },
    });
    return cachedClient;
  }

  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey,
  });
  return cachedClient;
}
