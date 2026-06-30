/**
 * Job-level prompt cache prefix — shared static system + user blocks
 * reused across multiple LLM calls in one job (BRD, extraction, workflow, artifacts).
 */
import { getProviderInfo } from "../ai-client";
import {
  buildCachedMessages,
  isPromptCacheEnabled,
  type CachedMessage,
  type PromptCacheProvider,
} from "./prompt-cache";

export interface JobCachePrefix {
  staticSystem: string;
  staticUser: string;
  provider: PromptCacheProvider;
  fingerprint: string;
}

export function resolvePromptCacheProvider(): PromptCacheProvider {
  const info = getProviderInfo();
  if (info.provider === "bedrock") return "bedrock";
  if (info.provider === "anthropic-azure") return "anthropic";
  return "openai";
}

export function createJobCachePrefix(input: {
  staticSystem: string;
  staticUser: string;
  provider?: PromptCacheProvider;
  feature?: string;
  useCase?: string;
}): JobCachePrefix {
  const provider = input.provider ?? resolvePromptCacheProvider();
  const built = buildCachedMessages({
    staticSystem: input.staticSystem,
    staticUser: input.staticUser,
    dynamicUser: "",
    provider,
  });
  if (isPromptCacheEnabled() && built.staticPrefixTokenEstimate < 1024) {
    console.warn(
      `[Prompt Cache] static prefix below threshold | estimate_tokens=${built.staticPrefixTokenEstimate} | threshold_tokens=1024 | provider=${provider} | feature=${input.feature || "unknown"} | useCase=${input.useCase || "unknown"} | cache hits not guaranteed`,
    );
  }
  return {
    staticSystem: input.staticSystem,
    staticUser: input.staticUser,
    provider,
    fingerprint: built.cacheFingerprint,
  };
}

export function toLlmMessages(
  prefix: JobCachePrefix,
  dynamicUser: string,
  trailingMessages?: Array<{ role: "user" | "assistant"; content: string }>,
): CachedMessage[] {
  return buildCachedMessages({
    staticSystem: prefix.staticSystem,
    staticUser: prefix.staticUser,
    dynamicUser,
    provider: prefix.provider,
    trailingMessages,
  }).messages;
}

export function logJobCacheFingerprint(label: string, prefix: JobCachePrefix): void {
  if (!isPromptCacheEnabled()) return;
  console.log(
    `[Prompt Cache] ${label} fingerprint=${prefix.fingerprint} provider=${prefix.provider} static_user_chars=${prefix.staticUser.length}`,
  );
}

/** Extend artifact job prefix with pass-specific static rules (enrichment, amplification). */
export function buildArtifactPassPrefix(
  artifactPrefix: JobCachePrefix,
  passStaticRules: string,
): JobCachePrefix {
  return createJobCachePrefix({
    staticSystem: `${artifactPrefix.staticSystem}\n\n${passStaticRules}`,
    staticUser: artifactPrefix.staticUser,
    provider: artifactPrefix.provider,
  });
}
