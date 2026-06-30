/**
 * Extended Test Case Generation Prompt
 * Generates Performance, Security, Usability, and Reliability test cases
 */

export const EXTENDED_TEST_CASES_SYSTEM_PROMPT = `You are an expert Quality Engineering AI Agent specializing in comprehensive test case generation. You excel at creating detailed test cases for non-functional testing dimensions: Performance & Load Testing, Security & Vulnerability Validation, Usability Testing, and Reliability & Resiliency Testing.

Your expertise includes:
- Performance engineering (load, stress, endurance, spike testing)
- Security testing using STRIDE threat model and OWASP guidelines
- Usability evaluation based on Nielsen's Heuristics
- Reliability testing using Chaos Engineering principles
- Risk assessment and prioritization (DREAD scoring)
- Compliance mapping (WCAG, OWASP, SOC2, PCI-DSS, HIPAA)

🚨🚨🚨 CRITICAL OUTPUT FORMAT 🚨🚨🚨

You MUST return ONLY a valid JSON object with this EXACT structure:

🚨 CRITICAL: Use "steps" (not "testCaseSteps") with lowercase property names for Excel/ADO compatibility! 🚨

{
  "testCases": [
    {
      "id": "string (e.g., PERF-LOAD-001)",
      "title": "string (clear test scenario title)",
      "category": "string (performance|security|usability|reliability)",
      "subCategory": "string (e.g., Load Testing, STRIDE-Spoofing, Nielsen-H01, Failure Injection)",
      "priority": "Critical|High|Medium|Low",
      "description": "string (detailed test scenario description)",
      "preconditions": ["array of strings"],
      "steps": [
        {
          "step": 1,
          "action": "string (what tester should do)",
          "expectedResult": "string (what should happen)"
        }
      ],
      "postconditions": ["array of strings"],
      "testData": "string (optional: sample data needed)",
      "toolsRequired": ["array of strings (optional)"],
      "estimatedTime": "string (e.g., 30 minutes)",
      "automationFeasibility": "High|Medium|Low",
      "riskScore": "number (optional: for security - DREAD score)",
      "complianceTag": "string (optional: e.g., OWASP-A01, WCAG-1.1.1)"
    }
  ]
}

🚨 NO markdown code blocks
🚨 NO explanatory text before or after JSON
🚨 Just pure, valid JSON`;

export function getPerformanceTestCasesPrompt(userStory: any, acceptanceCriteria?: string[]): string {
  const acText = acceptanceCriteria && acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : 'No specific acceptance criteria provided';

  return `Generate comprehensive PERFORMANCE & LOAD test cases for the following user story.

USER STORY:
${userStory.title}

DESCRIPTION:
${userStory.description || 'No description provided'}

ACCEPTANCE CRITERIA:
${acText}

Generate test cases covering:

1. **Load Testing** - Normal and peak load conditions
   - Concurrent users scenarios
   - Response time validation
   - Throughput measurement
   - Resource utilization

2. **Stress Testing** - Beyond capacity testing
   - Breaking point identification
   - Graceful degradation validation
   - Recovery testing

3. **Endurance/Soak Testing** - Extended duration testing
   - Memory leak detection
   - Resource exhaustion
   - Long-running stability

4. **Spike Testing** - Sudden traffic surge handling
   - Auto-scaling validation
   - Rapid load increase/decrease

Include specific metrics: Response time (P50, P95, P99), Throughput (TPS), Error rate, CPU/Memory utilization.

Generate test cases with IDs starting with PERF-LOAD-XXX, PERF-STRESS-XXX, PERF-SOAK-XXX, PERF-SPIKE-XXX.

Return ONLY valid JSON matching the required structure.`;
}

export function getSecurityTestCasesPrompt(userStory: any, acceptanceCriteria?: string[]): string {
  const acText = acceptanceCriteria && acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : 'No specific acceptance criteria provided';

  return `Generate comprehensive SECURITY & VULNERABILITY test cases for the following user story using STRIDE threat model and OWASP guidelines.

USER STORY:
${userStory.title}

DESCRIPTION:
${userStory.description || 'No description provided'}

ACCEPTANCE CRITERIA:
${acText}

Generate test cases covering:

1. **STRIDE Threat Model**
   - Spoofing (identity/authentication threats)
   - Tampering (data integrity threats)
   - Repudiation (non-repudiation threats)
   - Information Disclosure (confidentiality threats)
   - Denial of Service (availability threats)
   - Elevation of Privilege (authorization threats)

2. **OWASP Top 10 Validation**
   - A01: Broken Access Control
   - A02: Cryptographic Failures
   - A03: Injection attacks (SQL, XSS, Command)
   - A07: Authentication failures
   - A08: Software and Data Integrity Failures
   - A10: Server-Side Request Forgery

3. **Input Validation & Injection Testing**
   - SQL injection
   - Cross-Site Scripting (XSS)
   - Command injection
   - LDAP injection

4. **Authentication & Session Management**
   - Brute force attempts
   - Session hijacking
   - Token manipulation

5. **Authorization & Access Control**
   - Horizontal privilege escalation
   - Vertical privilege escalation
   - Missing function-level access control

For each high-risk test case, include DREAD risk scoring in the riskScore field (1-10 average of Damage, Reproducibility, Exploitability, Affected Users, Discoverability).

Generate test cases with IDs starting with SEC-SPOOF-XXX, SEC-TAMP-XXX, SEC-REPUD-XXX, SEC-INFO-XXX, SEC-DOS-XXX, SEC-ELEV-XXX, SEC-OWASP-XXX, SEC-INJ-XXX, SEC-AUTH-XXX, SEC-AUTHZ-XXX.

Return ONLY valid JSON matching the required structure.`;
}

export function getUsabilityTestCasesPrompt(userStory: any, acceptanceCriteria?: string[]): string {
  const acText = acceptanceCriteria && acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : 'No specific acceptance criteria provided';

  return `Generate comprehensive USABILITY test cases for the following user story based on Nielsen's 10 Usability Heuristics.

USER STORY:
${userStory.title}

DESCRIPTION:
${userStory.description || 'No description provided'}

ACCEPTANCE CRITERIA:
${acText}

Generate test cases covering Nielsen's 10 Usability Heuristics:

1. **Visibility of System Status** - Is user informed about what's happening?
2. **Match Between System and Real World** - Does it speak user's language?
3. **User Control and Freedom** - Can user undo/redo easily?
4. **Consistency and Standards** - Are conventions followed?
5. **Error Prevention** - Are errors prevented before they occur?
6. **Recognition Rather Than Recall** - Is information visible when needed?
7. **Flexibility and Efficiency of Use** - Are shortcuts available for experts?
8. **Aesthetic and Minimalist Design** - Is irrelevant information avoided?
9. **Help Users Recognize and Recover from Errors** - Are error messages helpful?
10. **Help and Documentation** - Is help easily accessible?

Severity Scale:
- Critical (4): Major usability problem, makes task impossible
- High (3): Significant usability issue, causes frustration
- Medium (2): Minor usability issue, slightly annoying
- Low (1): Cosmetic issue only

Include recommendations for improvement in the postconditions field.

Generate test cases with IDs starting with UX-H01-XXX through UX-H10-XXX (matching heuristic number).

Return ONLY valid JSON matching the required structure.`;
}

export function getReliabilityTestCasesPrompt(userStory: any, acceptanceCriteria?: string[]): string {
  const acText = acceptanceCriteria && acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : 'No specific acceptance criteria provided';

  return `Generate comprehensive RELIABILITY & RESILIENCY test cases for the following user story using Chaos Engineering principles.

USER STORY:
${userStory.title}

DESCRIPTION:
${userStory.description || 'No description provided'}

ACCEPTANCE CRITERIA:
${acText}

Generate test cases covering:

1. **Failure Injection Testing**
   - Service failures (microservice crash, database failure)
   - Network failures (partition, latency injection)
   - Resource exhaustion (CPU, memory, disk)

2. **Chaos Engineering Experiments**
   - Hypothesis-driven testing
   - Blast radius definition
   - Steady state validation
   - Recovery validation

3. **Dependency Resilience**
   - External API failures
   - Database unavailability
   - Message queue issues
   - Cache failures

4. **Data Integrity & Recovery**
   - Transaction rollback validation
   - Backup and restore testing
   - RTO (Recovery Time Objective) compliance
   - RPO (Recovery Point Objective) compliance

5. **Circuit Breaker & Retry Logic**
   - Circuit breaker state transitions
   - Retry policy validation (exponential backoff)
   - Half-open state testing

6. **Failover & High Availability**
   - Automatic failover validation
   - Zero data loss verification
   - Load balancer failover
   - Database replication testing

Include specific SLI/SLO metrics where applicable: MTBF (Mean Time Between Failures), MTTR (Mean Time To Recovery), Availability %.

Generate test cases with IDs starting with REL-FAIL-XXX, REL-CHAOS-XXX, REL-DEP-XXX, REL-DATA-XXX, REL-CB-XXX, REL-HA-XXX.

Return ONLY valid JSON matching the required structure.`;
}
