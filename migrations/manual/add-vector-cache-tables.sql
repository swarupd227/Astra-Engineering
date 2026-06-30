-- Migration: Add Vector Cache Tables for RAG Optimization
-- Purpose: Create tables to store vectorized guidelines and chunks for caching
-- Date: 2024-12-30

-- Create vectorized_guidelines table
CREATE TABLE IF NOT EXISTS vectorized_guidelines (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    project_id VARCHAR(36) NOT NULL,
    guideline_name VARCHAR(500) NOT NULL,
    content_hash VARCHAR(64) NOT NULL UNIQUE,
    qdrant_collection VARCHAR(255) NOT NULL,
    chunk_count INT NOT NULL DEFAULT 0,
    embedding_model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-ada-002',
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    processing_time_ms INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    
    INDEX idx_project_id (project_id),
    INDEX idx_content_hash (content_hash),
    INDEX idx_status (status),
    INDEX idx_project_status (project_id, status)
);

-- Create guideline_chunks table
CREATE TABLE IF NOT EXISTS guideline_chunks (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    guideline_id VARCHAR(36) NOT NULL,
    chunk_index INT NOT NULL,
    chunk_text LONGTEXT NOT NULL,
    qdrant_point_id VARCHAR(255) NOT NULL,
    chunk_size INT NOT NULL,
    overlap_size INT NOT NULL DEFAULT 0,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    FOREIGN KEY (guideline_id) REFERENCES vectorized_guidelines(id) ON DELETE CASCADE,
    INDEX idx_guideline_id (guideline_id),
    INDEX idx_chunk_index (guideline_id, chunk_index),
    INDEX idx_qdrant_point (qdrant_point_id)
);

-- Create rag_sessions table
CREATE TABLE IF NOT EXISTS rag_sessions (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    session_type VARCHAR(50) NOT NULL DEFAULT 'artifact_generation',
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    requirement_ids JSON NULL,
    guideline_ids JSON NULL,
    cache_hit_count INT NOT NULL DEFAULT 0,
    cache_miss_count INT NOT NULL DEFAULT 0,
    total_processing_time_ms INT NULL,
    rag_processing_time_ms INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NULL,
    
    INDEX idx_project_id (project_id),
    INDEX idx_session_type (session_type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- Add comments for documentation
ALTER TABLE vectorized_guidelines COMMENT = 'Stores metadata about vectorized guidelines for RAG caching';
ALTER TABLE guideline_chunks COMMENT = 'Stores individual chunks of vectorized guidelines with Qdrant references';
ALTER TABLE rag_sessions COMMENT = 'Tracks RAG processing sessions for analytics and debugging';
