CREATE TABLE IF NOT EXISTS modernization_token_usage (
  id CHAR(36) PRIMARY KEY,
  analysis_id CHAR(36) NOT NULL,
  phase VARCHAR(50) NOT NULL,
  agent VARCHAR(100),
  model VARCHAR(50),
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  estimated_cost DECIMAL(10, 6) NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  llm_calls INT NOT NULL DEFAULT 1,
  codebase_file_count INT DEFAULT 0,
  codebase_total_lines INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_token_analysis (analysis_id),
  INDEX idx_token_phase (analysis_id, phase)
);
