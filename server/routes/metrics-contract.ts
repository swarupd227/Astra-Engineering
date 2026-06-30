/**
 * Polaris /api/ai-metrics response contract. Shape is fixed by Polaris; Claude-only
 * fields (chatgpt_requests, custom_tool_requests) are retained as 0 for compatibility.
 * No tenant_id anywhere in request, query, or response.
 */
export interface AiMetricsPeriod {
  start_date: string;
  end_date: string;
  period_type: string;
  timezone: string;
}

export interface AiMetricsUsage {
  total_requests: number;
  chatgpt_requests: number; // always 0 (Claude-only)
  claude_requests: number;
  custom_tool_requests: number; // always 0
  current_week_requests: number;
  previous_week_requests: number;
}

export interface AiMetricsProvider {
  provider: string;
  requests: number;
  successful_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_usd: number;
}

export interface AiMetricsTokens {
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
}

export interface AiMetricsCost {
  total_cost_usd: number;
  cache_savings_usd?: number;
  currency: string;
}

export interface AiMetricsReliability {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
}

export interface AiMetricsQuality {
  accepted_outputs: number;
  modified_outputs: number;
  rejected_outputs: number;
  unrated_outputs: number;
  total_outputs: number;
  previous_period_quality_score: number;
}

export interface AiMetricsUseCases {
  bot_query_count: number;
  artifact_generation_count: number;
  bug_detection_count: number;
  documentation_generation_count: number;
  code_accepted_count: number;
}

export interface AiMetricsAdoption {
  active_users: number;
  total_eligible_users: number;
  previous_period_active_users: number;
}

export interface AiMetricsProductivity {
  target_saved_hours: number;
}

export interface AiMetricsTeam {
  team_id: string;
  team_name: string;
  active_users: number;
  total_members: number;
  total_requests: number;
  accepted_outputs: number;
  modified_outputs: number;
  rejected_outputs: number;
  cost_usd: number;
}

export interface AiMetricsUserProvider {
  provider: string;
  requests: number;
  successful_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface AiMetricsUser {
  user_id: string;
  user_name?: string;
  email?: string;

  team_id: string | null; // null when the user is on no JIRA project (global users[])
  team_name?: string | null;

  weekly_ai_uses: number;
  period_ai_uses: number;

  total_requests: number;
  successful_requests: number;
  failed_requests: number;

  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;

  total_cost_usd: number;
  currency: string;

  providers: AiMetricsUserProvider[];

  first_ai_use_date: string | null;
  last_ai_use_date: string | null;
}

export interface AiMetricsComparison {
  previous_period_start_date: string;
  previous_period_end_date: string;
  previous_total_requests: number;
  previous_quality_score: number;
  previous_active_users: number;
}

export interface AiMetricsResponse {
  period: AiMetricsPeriod;
  usage: AiMetricsUsage;
  providers: AiMetricsProvider[];
  tokens: AiMetricsTokens;
  cost: AiMetricsCost;
  reliability: AiMetricsReliability;
  quality: AiMetricsQuality;
  use_cases: AiMetricsUseCases;
  adoption: AiMetricsAdoption;
  productivity: AiMetricsProductivity;
  teams: AiMetricsTeam[];
  users: AiMetricsUser[];
  comparison: AiMetricsComparison;
}
