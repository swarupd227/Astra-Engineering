// LLM Client - TypeScript equivalent of llm_client.py
import OpenAI from "openai";
import type { LLMMessage, LLMCompletionOptions, LLMResponse } from "./models";
import { config } from "./config";
import { hasBedrock, azureOpenAI as bedrockLLM, bedrockEmbeddingClient } from "../../llm-config";
import { isAwsHosting } from "../../platform/hosting";

class LLMClient {
  private client: OpenAI | null = null;
  private fastClient: OpenAI | null = null;
  private embeddingClient: OpenAI | null = null; // Separate client for embeddings
  private chatModel: any = null; // LangChain equivalent would be complex to implement
  private embeddings: any = null; // LangChain equivalent would be complex to implement
  private initialized = false;
  private initializationError: Error | null = null;

  constructor() {
    // Don't initialize clients here - lazy load them when needed
    // This allows the server to start even without OpenAI credentials
    this.initializeClients();
  }

  private initializeClients(): void {
    if (this.initialized) {
      return;
    }

    try {
      console.log('[LLMClient] Loading embedding configuration...');
      if (!isAwsHosting()) {
        console.log('[LLMClient] Embedding Deployment:', config.AZURE_EMBEDDING_DEPLOYMENT);
        console.log('[LLMClient] Embedding Endpoint:', config.AZURE_EMBEDDING_ENDPOINT);
        console.log('[LLMClient] Embedding API Version:', config.AZURE_EMBEDDING_API_VERSION);
      }

      // Check if required credentials are available (strict validation - must be non-empty strings)
      const hasChatCredentials =
        config.AZURE_OPENAI_API_KEY &&
        config.AZURE_OPENAI_API_KEY.trim() !== '' &&
        config.AZURE_OPENAI_ENDPOINT &&
        config.AZURE_OPENAI_ENDPOINT.trim() !== '' &&
        config.AZURE_OPENAI_DEPLOYMENT &&
        config.AZURE_OPENAI_DEPLOYMENT.trim() !== '';

      const hasEmbeddingCredentials =
        config.AZURE_EMBEDDING_API_KEY &&
        config.AZURE_EMBEDDING_API_KEY.trim() !== '' &&
        config.AZURE_EMBEDDING_ENDPOINT &&
        config.AZURE_EMBEDDING_ENDPOINT.trim() !== '' &&
        config.AZURE_EMBEDDING_DEPLOYMENT &&
        config.AZURE_EMBEDDING_DEPLOYMENT.trim() !== '';

      if (!hasChatCredentials && !hasEmbeddingCredentials && !hasBedrock) {
        console.warn('[LLMClient] ⚠️ OpenAI credentials not configured. LLM features will be unavailable.');
        console.warn('[LLMClient] ⚠️ Set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT for chat completions');
        console.warn('[LLMClient] ⚠️ Set AZURE_EMBEDDING_API_KEY, AZURE_EMBEDDING_ENDPOINT, AZURE_EMBEDDING_DEPLOYMENT for embeddings');
        this.initialized = true;
        return;
      }

      // Initialize chat completion client if credentials are available
      if (hasBedrock && bedrockLLM) {
        this.client = bedrockLLM as any;
        this.fastClient = bedrockLLM as any;
        console.log('[LLMClient] ✅ Chat completion client initialized (Bedrock)');
      } else if (hasChatCredentials) {
        try {
          this.client = new OpenAI({
            apiKey: config.AZURE_OPENAI_API_KEY!,
            baseURL: `${config.AZURE_OPENAI_ENDPOINT}/openai/deployments/${config.AZURE_OPENAI_DEPLOYMENT}`,
            defaultQuery: { "api-version": config.AZURE_OPENAI_API_VERSION || "2024-02-01" },
            defaultHeaders: { "api-key": config.AZURE_OPENAI_API_KEY! }
          });

          this.chatModel = {
            azureDeployment: config.AZURE_OPENAI_DEPLOYMENT!,
            apiVersion: config.AZURE_OPENAI_API_VERSION || "2024-02-01",
            azureEndpoint: config.AZURE_OPENAI_ENDPOINT!,
            apiKey: config.AZURE_OPENAI_API_KEY!,
            temperature: 0.7
          };
          console.log('[LLMClient] ✅ Chat completion client initialized');

          if (
            config.AZURE_OPENAI_FAST_DEPLOYMENT &&
            config.AZURE_OPENAI_FAST_DEPLOYMENT.trim() !== "" &&
            config.AZURE_OPENAI_FAST_DEPLOYMENT.trim() !== config.AZURE_OPENAI_DEPLOYMENT
          ) {
            this.fastClient = new OpenAI({
              apiKey: config.AZURE_OPENAI_API_KEY!,
              baseURL: `${config.AZURE_OPENAI_ENDPOINT}/openai/deployments/${config.AZURE_OPENAI_FAST_DEPLOYMENT}`,
              defaultQuery: { "api-version": config.AZURE_OPENAI_API_VERSION || "2024-02-01" },
              defaultHeaders: { "api-key": config.AZURE_OPENAI_API_KEY! }
            });
            console.log('[LLMClient] ✅ Fast chat deployment initialized:', config.AZURE_OPENAI_FAST_DEPLOYMENT);
          }
        } catch (error: any) {
          console.error('[LLMClient] ❌ Error initializing chat completion client:', error?.message || String(error));
          this.client = null;
          this.fastClient = null;
        }
      } else {
        console.warn('[LLMClient] ⚠️ Chat completion credentials not available');
      }

      // Initialize embedding client: Bedrock on AWS, Azure on Azure
      if (hasBedrock && bedrockEmbeddingClient) {
        this.embeddingClient = bedrockEmbeddingClient as any;
        console.log('[LLMClient] ✅ Embedding client initialized (Bedrock)');
      } else if (hasEmbeddingCredentials) {
        try {
          this.embeddingClient = new OpenAI({
            apiKey: config.AZURE_EMBEDDING_API_KEY!,
            baseURL: `${config.AZURE_EMBEDDING_ENDPOINT}/openai/deployments/${config.AZURE_EMBEDDING_DEPLOYMENT}`,
            defaultQuery: { "api-version": config.AZURE_EMBEDDING_API_VERSION || "2024-02-01" },
            defaultHeaders: { "api-key": config.AZURE_EMBEDDING_API_KEY! }
          });

          this.embeddings = {
            azureDeployment: config.AZURE_EMBEDDING_DEPLOYMENT!,
            apiVersion: config.AZURE_EMBEDDING_API_VERSION || "2024-02-01",
            azureEndpoint: config.AZURE_EMBEDDING_ENDPOINT!,
            apiKey: config.AZURE_EMBEDDING_API_KEY!
          };
          console.log('[LLMClient] ✅ Embedding client initialized');
          console.log('[LLMClient] Embedding client baseURL:', `${config.AZURE_EMBEDDING_ENDPOINT}/openai/deployments/${config.AZURE_EMBEDDING_DEPLOYMENT}`);
        } catch (error: any) {
          console.error('[LLMClient] ❌ Error initializing embedding client:', error?.message || String(error));
          this.embeddingClient = null;
        }
      } else {
        console.warn('[LLMClient] ⚠️ Embedding credentials not available');
      }

      this.initialized = true;
    } catch (error: any) {
      this.initializationError = error;
      console.error('[LLMClient] ❌ Error initializing OpenAI clients:', error?.message || String(error));
      console.warn('[LLMClient] ⚠️ LLM features will be unavailable');
      this.initialized = true; // Mark as initialized to prevent retry loops
    }
  }

  async generateCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: LLMCompletionOptions | number = {}
  ): Promise<string> {
    try {
      if (!this.client) {
        throw new Error('OpenAI chat client not initialized. Please configure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT environment variables.');
      }

      // Handle both object options and direct temperature number (for backward compatibility)
      const temperature = typeof options === 'number' ? options : (options.temperature || 0.7);
      const maxTokens = (typeof options === 'object' && options.maxTokens) ? options.maxTokens : 4000;
      const useFastModel = typeof options === 'object' ? !!options.useFastModel : false;

      const activeClient = useFastModel && this.fastClient ? this.fastClient : this.client;
      const activeDeployment =
        useFastModel && config.AZURE_OPENAI_FAST_DEPLOYMENT
          ? config.AZURE_OPENAI_FAST_DEPLOYMENT
          : config.AZURE_OPENAI_DEPLOYMENT;

      const deploymentLower = (activeDeployment || "").toLowerCase();
      const isNewModel =
        deploymentLower.includes("gpt-5") ||
        deploymentLower.includes("o1") ||
        deploymentLower.includes("o3");

      const basePayload: Record<string, any> = {
        model: activeDeployment!,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      };

      if (isNewModel) {
        // Keep latency/cost manageable while still honoring requested token needs.
        // Env var allows ops-level cap without code changes.
        const envCap = Number(process.env.AZURE_OPENAI_MAX_COMPLETION_TOKENS || "");
        const cap = Number.isFinite(envCap) && envCap > 0 ? envCap : 10000;
        basePayload.max_completion_tokens = Math.min(maxTokens ?? 10000, cap);
        // Newer Azure OpenAI models may not support custom temperature values.
        basePayload.temperature = 1;
      } else {
        basePayload.max_tokens = maxTokens;
        basePayload.temperature = temperature;
      }

      const maxRetries = Number(process.env.AZURE_OPENAI_CHAT_MAX_RETRIES || "3");
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await activeClient!.chat.completions.create(basePayload as any);

          const content = response.choices[0]?.message?.content;
          if (!content || content.trim().length === 0) {
            throw new Error('LLM returned empty or null response');
          }
          return content;
        } catch (error: any) {
          const isRateLimit =
            error?.status === 429 ||
            error?.code === 'RateLimitReached' ||
            error?.error?.code === 'RateLimitReached' ||
            error?.code === 'too_many_requests' ||
            error?.error?.code === 'too_many_requests';

          if (!isRateLimit || attempt >= maxRetries) {
            throw error;
          }

          const retryAfterMsHeader =
            Number(error?.headers?.get?.('retry-after-ms')) ||
            Number(error?.response?.headers?.['retry-after-ms']);
          const retryAfterSecHeader =
            Number(error?.headers?.get?.('retry-after')) ||
            Number(error?.response?.headers?.['retry-after']);

          let waitMs =
            Number.isFinite(retryAfterMsHeader) && retryAfterMsHeader > 0
              ? retryAfterMsHeader
              : Number.isFinite(retryAfterSecHeader) && retryAfterSecHeader > 0
                ? retryAfterSecHeader * 1000
                : Math.min(1000 * Math.pow(2, attempt + 1), 60000);

          // add small jitter
          waitMs = waitMs + Math.floor(Math.random() * 250);
          console.warn(`[LLMClient] ⏳ Chat rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}), retrying after ${Math.round(waitMs / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      throw new Error('LLM completion failed after retries');
    } catch (error) {
      console.error('Error generating LLM completion:', error);
      throw error;
    }
  }

  async getEmbeddings(text: string): Promise<number[]> {
    const result = await this.getBatchEmbeddings([text]);
    return result[0];
  }

  /**
   * Generate embeddings for multiple texts in a single API call.
   * Uses retry with exponential backoff for rate limit errors.
   * Batches texts in groups of up to 16 to stay within API limits.
   */
  async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.embeddingClient) {
      throw new Error('OpenAI embedding client not initialized. Please configure AZURE_EMBEDDING_API_KEY, AZURE_EMBEDDING_ENDPOINT, and AZURE_EMBEDDING_DEPLOYMENT environment variables.');
    }

    if (texts.length === 0) return [];

    const validIndices: number[] = [];
    const validTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const trimmed = texts[i]?.trim();
      if (trimmed && trimmed.length > 0) {
        validIndices.push(i);
        validTexts.push(trimmed);
      } else {
        console.warn(`[LLMClient] Skipping empty text at index ${i} in embedding batch`);
      }
    }

    if (validTexts.length === 0) return texts.map(() => []);

    const BATCH_SIZE = 16;
    const validEmbeddings: number[][] = [];

    for (let i = 0; i < validTexts.length; i += BATCH_SIZE) {
      const batch = validTexts.slice(i, i + BATCH_SIZE);
      const batchResult = await this._callEmbeddingsWithRetry(batch);
      validEmbeddings.push(...batchResult);
    }

    const result: number[][] = texts.map(() => []);
    for (let i = 0; i < validIndices.length; i++) {
      result[validIndices[i]] = validEmbeddings[i];
    }
    return result;
  }

  /**
   * Call embeddings API with retry + exponential backoff for rate limit errors.
   */
  private async _callEmbeddingsWithRetry(
    texts: string[],
    maxRetries: number = 3
  ): Promise<number[][]> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.embeddingClient!.embeddings.create({
          model: isAwsHosting() ? undefined as any : (config.AZURE_EMBEDDING_DEPLOYMENT || 'text-embedding-ada-002'),
          input: texts,
        });

        // Return embeddings in the same order as input texts
        return response.data
          .sort((a, b) => a.index - b.index)
          .map(d => d.embedding);

      } catch (error: any) {
        const isRateLimit = error?.status === 429
          || error?.code === 'RateLimitReached'
          || error?.error?.code === 'RateLimitReached'
          || (error?.message && error.message.includes('Rate limit'));

        if (isRateLimit && attempt < maxRetries) {
          // Parse retry-after from error message or use exponential backoff
          let waitMs = Math.min(1000 * Math.pow(2, attempt + 1), 60000); // 2s, 4s, 8s... max 60s
          const retryAfterMatch = error?.message?.match(/retry after (\d+) seconds/i);
          if (retryAfterMatch) {
            waitMs = (parseInt(retryAfterMatch[1], 10) + 1) * 1000;
          }

          console.warn(`[LLMClient] ⏳ Embedding rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}), retrying after ${Math.round(waitMs / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        console.error('[LLMClient] Error generating embeddings:', error);
        throw error;
      }
    }

    throw new Error('[LLMClient] Embedding generation failed after max retries');
  }

  getChatModel(): any {
    return this.chatModel;
  }
}

// Export singleton instance (matching Python's llm_client)
export const llmClient = new LLMClient();