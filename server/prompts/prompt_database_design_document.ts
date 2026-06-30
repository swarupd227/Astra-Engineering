const promptDatabaseDesignDocument = (
  dbType: string,
  domain: string,
  contextSummary: string,
  featuresList: string
): string => ` 
Generate a comprehensive "Database Design Document" for Azure DevOps Wiki.

**CRITICAL: Wrap every diagram in standard Markdown \`\`\`mermaid ... \`\`\` fenced code blocks (NOT ::: wrappers):**

\`\`\`mermaid
erDiagram
    ENTITY1 ||--o{ ENTITY2 : "relationship"
\`\`\`

${contextSummary}

**Database Type:** ${dbType}

**Key Features:**
${featuresList}

---

## Document Structure

### 1. Overview
#### Purpose
This document defines the complete database architecture for the ${domain} system using ${dbType}.

#### Scope
- Entity Relationship Diagram (ERD)
- Table specifications with SQL schema
- Data dictionary and business rules
- Performance optimization strategies
- Security and compliance requirements
- Backup and scaling strategies

---

### 2. Entity Relationship Diagram (ERD)
#### Purpose
Visual representation of all database entities and their relationships.

\`\`\`mermaid
erDiagram
    %% Add your ERD here
    %% Extract REAL entities from features above
    %% Example for Insurance domain:
    %% CLAIM ||--o{ CLAIM_DOCUMENT : "has"
    %% POLICY ||--o{ CLAIM : "covers"
    %% POLICYHOLDER ||--|| POLICY : "owns"
\`\`\`

**Description:** [Explain the main entities, their relationships, and the overall data model]

**Key Entities:**
Extract entities from the ${domain} domain:
- **Entity 1**: [Description, role in system]
- **Entity 2**: [Description, role in system]
- **Entity 3**: [Description, role in system]

**Relationships:**
- **One-to-One**: [List relationships with business justification]
- **One-to-Many**: [List relationships with business justification]
- **Many-to-Many**: [List relationships - note junction tables]

---

### 3. Table Specifications
For each entity, provide complete SQL schema:

#### Table: [EntityName]
**Purpose:** [What this table stores and why]

**SQL Schema:**
\`\`\`sql
CREATE TABLE entity_name (
    id BIGSERIAL PRIMARY KEY,
    field1 VARCHAR(255) NOT NULL,
    field2 INTEGER CHECK (field2 > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_entity_field1 UNIQUE (field1)
);

CREATE INDEX idx_entity_field1 ON entity_name(field1);
CREATE INDEX idx_entity_created_at ON entity_name(created_at DESC);
\`\`\`

**Column Specifications:**
| Column | Type | Constraints | Description | Business Rules |
|--------|------|-------------|-------------|----------------|

**Indexes:**
- **Primary Key**: id (auto-increment)
- **Unique Index**: field1 (business key)
- **Performance Index**: created_at (for time-based queries)

---

[Repeat above structure for all major entities]

---

### 4. Data Dictionary

| Table | Column | Data Type | Nullable | Default | Description | Valid Values | Example |
|-------|--------|-----------|----------|---------|-------------|--------------|---------|

---

### 5. Query Optimization & Indexing Strategy
#### Frequently Used Queries
- **Query 1**: [Description]
  - **Index Used**: [Index name and columns]
  - **Performance Target**: < [X] ms

#### Composite Indexes
- **Index**: [column1, column2, column3]
  - **Purpose**: [Why this combination]
  - **Queries Supported**: [List queries]

#### Full-Text Search
- **Tables**: [Which tables need FTS]
- **Columns**: [Which columns are indexed]
- **Technology**: [PostgreSQL FTS, Elasticsearch, etc.]

---

### 6. Security & Compliance
#### Access Control
- **Database Roles**:
  - \`app_read\`: SELECT only
  - \`app_write\`: SELECT, INSERT, UPDATE
  - \`app_admin\`: ALL privileges

#### Data Protection
- **Encryption at Rest**: [Method and columns]
- **Encryption in Transit**: SSL/TLS configuration
- **Sensitive Data**: [PII columns, encryption approach]

#### Audit Logging
\`\`\`sql
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    user_id BIGINT,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
\`\`\`

#### Compliance
- **GDPR**: Right to erasure, data portability
- **HIPAA** (if applicable): PHI protection
- **[Domain-Specific]**: [Other compliance requirements]

---

### 7. Backup & Recovery
#### Backup Strategy
- **Full Backup**: Daily at 2 AM UTC
- **Incremental Backup**: Every 6 hours
- **WAL Archiving**: Continuous

#### Recovery Objectives
- **RPO (Recovery Point Objective)**: < 1 hour
- **RTO (Recovery Time Objective)**: < 2 hours

#### Disaster Recovery
- **Primary**: [Azure Region 1]
- **Replica**: [Azure Region 2]
- **Failover Process**: [Steps]

---

### 8. Scaling & Performance
#### Read Replicas
- **Configuration**: [Number of replicas, regions]
- **Load Balancing**: [How queries are routed]

#### Sharding (if applicable)
- **Shard Key**: [Column used for sharding]
- **Strategy**: [Range, hash, geographic]

#### Connection Pooling
- **Max Connections**: [Number]
- **Pool Size per Instance**: [Number]

#### Caching Strategy
- **Redis/Memcached**: [What data is cached]
- **Cache Invalidation**: [Strategy]

---

### 9. Migration Strategy
#### Version Control
- **Tool**: [Flyway, Liquibase, migrations folder]
- **Naming**: V{version}__{description}.sql

#### Deployment Process
1. Review migration scripts
2. Test in staging environment
3. Backup production database
4. Execute migration with rollback plan
5. Verify data integrity

---

## Related Documentation
- [[System Design Document]]
- [[Data Models]]
- [[API Documentation]]
- [[Class Diagrams]]

**IMPORTANT:**
1. Extract REAL entities from the features listed (e.g., for ${domain}: specific domain entities)
2. Use ${dbType}-specific data types and features
3. Create production-ready schema design with complete SQL
4. Show ALL relationships with proper cardinality
5. Return ONLY the Markdown content (NO \`\`\`markdown wrapper)`

;
export { promptDatabaseDesignDocument }