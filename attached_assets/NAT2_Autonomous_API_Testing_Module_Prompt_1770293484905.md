# NAT 2.0 - Autonomous API Testing Module
## Replit Development Prompt

---

## PROJECT OVERVIEW

Build an **Autonomous API Testing Module** for NAT 2.0 that takes a Swagger/OpenAPI specification as input and automatically generates, executes, and reports API test results without manual intervention.

### User Flow
```
User provides Swagger URL/File → System parses spec → Auto-generates test cases → Executes all tests → Displays results with detailed report
```

---

## INPUT METHODS

The module must support three input methods:

| Input Method | Description |
|--------------|-------------|
| **SwaggerHub URL** | `https://api.swaggerhub.com/apis/{owner}/{api}/{version}` |
| **Direct Swagger URL** | Any URL returning OpenAPI JSON/YAML |
| **File Upload** | Upload `.json` or `.yaml` OpenAPI spec file |

---

## CORE FEATURES

### 1. Swagger Parser
- Parse OpenAPI 2.0 (Swagger) and OpenAPI 3.x specifications
- Extract all endpoints with methods (GET, POST, PUT, PATCH, DELETE)
- Extract request parameters (path, query, header, body)
- Extract request body schemas
- Extract response schemas and status codes
- Extract authentication requirements
- Extract example values if available

### 2. Test Case Auto-Generation

For each endpoint, automatically generate these test categories:

| Category | What to Generate |
|----------|------------------|
| **Positive Tests** | Valid request with all required fields using schema-compliant data |
| **Negative - Missing Required** | Omit each required field one at a time |
| **Negative - Invalid Types** | Send string for integer, integer for boolean, etc. |
| **Negative - Boundary Values** | Min-1, Max+1, empty string, null, extremely long strings |
| **Negative - Invalid Format** | Invalid email, invalid date, invalid UUID, etc. |
| **Auth Tests** | No auth, invalid token, expired token (if auth required) |
| **Response Validation** | Validate response matches expected schema |

### 3. Smart Test Data Generation

Generate test data based on schema types and constraints:

| Schema Property | Generated Data |
|-----------------|----------------|
| `type: string` | Random string or faker-generated value |
| `type: string, format: email` | Valid/invalid email addresses |
| `type: string, format: date` | Valid/invalid date formats |
| `type: string, format: uuid` | Valid/invalid UUIDs |
| `type: integer` | Random int, 0, negative, max int, min int |
| `type: integer, minimum: X, maximum: Y` | X, Y, X-1, Y+1, mid-value |
| `type: boolean` | true, false, "true", 1, null |
| `type: array` | Empty array, single item, multiple items |
| `type: object` | Valid object, empty object, missing properties |
| `enum: [A, B, C]` | Each enum value + invalid value |
| `required: true` | Present and absent |
| `minLength/maxLength` | At limit, below limit, above limit |
| `pattern: regex` | Matching and non-matching values |

### 4. Dependency Chain Detection

Automatically detect and handle endpoint dependencies:

```
POST /users → returns {id: 123}
GET /users/{id} → use id from POST response
PUT /users/{id} → use id from POST response
DELETE /users/{id} → use id from POST response
```

**Rules:**
- Detect CRUD patterns automatically
- Store response values for reuse in subsequent requests
- Execute dependent tests in correct order
- Mark dependent tests as skipped if parent fails

### 5. Authentication Handling

Support multiple auth mechanisms from Swagger securityDefinitions:

| Auth Type | Implementation |
|-----------|----------------|
| **API Key** | Header or query parameter |
| **Bearer Token** | Authorization: Bearer {token} |
| **Basic Auth** | Authorization: Basic {base64} |
| **OAuth2** | Token endpoint flow (if credentials provided) |

**User Configuration:**
- Allow user to input auth credentials/tokens
- Test with valid auth, invalid auth, and no auth

### 6. Test Execution Engine

Execute generated tests with:

| Feature | Implementation |
|---------|----------------|
| **Async Execution** | Run tests asynchronously for speed |
| **Configurable Concurrency** | Control parallel requests (default: 5) |
| **Timeout Handling** | Configurable timeout per request (default: 30s) |
| **Retry Logic** | Retry failed requests (configurable: 0-3 retries) |
| **Response Time Tracking** | Record response time for each request |
| **Request/Response Logging** | Store full request and response for debugging |

### 7. Response Validation

For each response, validate:

| Validation | Check |
|------------|-------|
| **Status Code** | Matches expected (200, 201, 400, 401, 404, etc.) |
| **Schema Compliance** | Response body matches defined schema |
| **Required Fields** | All required response fields present |
| **Data Types** | Response field types match schema |
| **Response Time** | Within acceptable threshold (configurable) |
| **Headers** | Expected headers present (Content-Type, etc.) |

### 8. Environment Support

Allow multiple environment configurations:

```
{
  "environments": {
    "dev": { "baseUrl": "https://dev-api.example.com", "apiKey": "dev-key" },
    "qa": { "baseUrl": "https://qa-api.example.com", "apiKey": "qa-key" },
    "prod": { "baseUrl": "https://api.example.com", "apiKey": "prod-key" }
  }
}
```

---

## USER INTERFACE

### Screen 1: Input Configuration

```
+----------------------------------------------------------+
|  NAT 2.0 - Autonomous API Testing                        |
+----------------------------------------------------------+
|                                                          |
|  Swagger Source:                                         |
|  ( ) SwaggerHub URL: [_______________________________]   |
|  ( ) Direct URL:     [_______________________________]   |
|  ( ) Upload File:    [Choose File]                       |
|                                                          |
|  Environment:                                            |
|  Base URL:    [_______________________________]          |
|                                                          |
|  Authentication:                                         |
|  Type: [Dropdown: None/API Key/Bearer/Basic/OAuth2]      |
|  Token/Key: [_______________________________]            |
|                                                          |
|  Options:                                                |
|  [x] Generate Positive Tests                             |
|  [x] Generate Negative Tests                             |
|  [x] Generate Auth Tests                                 |
|  [x] Validate Response Schema                            |
|  [ ] Include Deprecated Endpoints                        |
|                                                          |
|  Timeout (seconds): [30]    Concurrency: [5]             |
|                                                          |
|  [Parse Swagger]                                         |
|                                                          |
+----------------------------------------------------------+
```

### Screen 2: Endpoint Selection & Test Preview

```
+----------------------------------------------------------+
|  Parsed Endpoints (15 found)                             |
+----------------------------------------------------------+
|                                                          |
|  [x] All Endpoints                                       |
|                                                          |
|  +-- Users                                               |
|  |   [x] GET    /users          - List all users         |
|  |   [x] POST   /users          - Create user            |
|  |   [x] GET    /users/{id}     - Get user by ID         |
|  |   [x] PUT    /users/{id}     - Update user            |
|  |   [x] DELETE /users/{id}     - Delete user            |
|  |                                                       |
|  +-- Orders                                              |
|  |   [x] GET    /orders         - List orders            |
|  |   [x] POST   /orders         - Create order           |
|  |   [x] GET    /orders/{id}    - Get order              |
|                                                          |
|  Test Cases to Generate: 127                             |
|  - Positive: 15                                          |
|  - Negative (Missing Required): 34                       |
|  - Negative (Invalid Types): 45                          |
|  - Negative (Boundary): 23                               |
|  - Auth Tests: 10                                        |
|                                                          |
|  [Generate & Execute Tests]    [Preview Test Cases]      |
|                                                          |
+----------------------------------------------------------+
```

### Screen 3: Execution Progress

```
+----------------------------------------------------------+
|  Test Execution in Progress                              |
+----------------------------------------------------------+
|                                                          |
|  Progress: [====================          ] 65%          |
|                                                          |
|  Executed: 83 / 127                                      |
|  Passed:   71                                            |
|  Failed:   9                                             |
|  Skipped:  3                                             |
|                                                          |
|  Current: POST /users - Negative - Missing email field   |
|                                                          |
|  Live Log:                                               |
|  +------------------------------------------------------+|
|  | ✓ GET /users - Positive - 200 OK (145ms)            ||
|  | ✓ GET /users - Auth - No token - 401 Unauthorized   ||
|  | ✗ POST /users - Negative - Expected 400, got 500    ||
|  | ✓ POST /users - Positive - 201 Created (234ms)      ||
|  | ...                                                  ||
|  +------------------------------------------------------+|
|                                                          |
|  [Stop Execution]                                        |
|                                                          |
+----------------------------------------------------------+
```

### Screen 4: Results Dashboard

```
+----------------------------------------------------------+
|  Test Results - API: Pet Store v1.0                      |
+----------------------------------------------------------+
|                                                          |
|  Summary:                                                |
|  +------------+  +------------+  +------------+          |
|  |   PASSED   |  |   FAILED   |  |  SKIPPED   |          |
|  |    108     |  |     16     |  |     3      |          |
|  |   85.0%    |  |   12.6%    |  |    2.4%    |          |
|  +------------+  +------------+  +------------+          |
|                                                          |
|  Avg Response Time: 187ms    Total Duration: 2m 34s      |
|                                                          |
|  Results by Endpoint:                                    |
|  +------------------------------------------------------+|
|  | Endpoint          | Pass | Fail | Skip | Avg Time    ||
|  |-------------------|------|------|------|-------------||
|  | GET /users        |  8   |  1   |  0   | 145ms       ||
|  | POST /users       |  12  |  3   |  0   | 234ms       ||
|  | GET /users/{id}   |  7   |  2   |  1   | 156ms       ||
|  | PUT /users/{id}   |  9   |  1   |  1   | 198ms       ||
|  | DELETE /users/{id}|  5   |  0   |  1   | 112ms       ||
|  +------------------------------------------------------+|
|                                                          |
|  Results by Category:                                    |
|  +------------------------------------------------------+|
|  | Category              | Pass | Fail | Pass Rate      ||
|  |-----------------------|------|------|----------------||
|  | Positive              |  15  |  0   | 100%           ||
|  | Negative - Required   |  30  |  4   | 88.2%          ||
|  | Negative - Types      |  38  |  7   | 84.4%          ||
|  | Negative - Boundary   |  18  |  5   | 78.3%          ||
|  | Auth Tests            |  7   |  0   | 100%           ||
|  +------------------------------------------------------+|
|                                                          |
|  [View Detailed Report]  [Export JSON]  [Export HTML]    |
|                                                          |
+----------------------------------------------------------+
```

### Screen 5: Detailed Test Results

```
+----------------------------------------------------------+
|  Detailed Results - POST /users                          |
+----------------------------------------------------------+
|                                                          |
|  Filter: [All] [Passed] [Failed] [Skipped]               |
|                                                          |
|  +------------------------------------------------------+|
|  | ✗ FAILED - Negative - Missing required field: email  ||
|  |------------------------------------------------------|
|  | Expected: 400 Bad Request                            ||
|  | Actual:   500 Internal Server Error                  ||
|  |                                                      ||
|  | Request:                                             ||
|  | POST /users                                          ||
|  | Content-Type: application/json                       ||
|  | {                                                    ||
|  |   "name": "John Doe",                               ||
|  |   "age": 25                                         ||
|  | }                                                    ||
|  |                                                      ||
|  | Response (234ms):                                    ||
|  | {                                                    ||
|  |   "error": "Internal server error",                 ||
|  |   "message": "email is undefined"                   ||
|  | }                                                    ||
|  |                                                      ||
|  | Issue: API returns 500 instead of 400 for           ||
|  |        missing required field validation            ||
|  +------------------------------------------------------+|
|                                                          |
+----------------------------------------------------------+
```

---

## TECH STACK

| Component | Technology |
|-----------|------------|
| **Frontend** | React + TypeScript |
| **Backend** | Node.js + Express |
| **Swagger Parser** | `@apidevtools/swagger-parser` |
| **HTTP Client** | `axios` |
| **Schema Validator** | `ajv` |
| **Test Data Generator** | `json-schema-faker` + `@faker-js/faker` |
| **Database** | SQLite (store test runs, results) |
| **Report Generator** | Custom HTML template |
| **Styling** | Tailwind CSS |

---

## API ENDPOINTS (Backend)

```
POST   /api/swagger/parse          - Parse Swagger from URL or file
GET    /api/swagger/{id}/endpoints - Get parsed endpoints
POST   /api/tests/generate         - Generate test cases for endpoints
POST   /api/tests/execute          - Execute generated tests
GET    /api/tests/status/{runId}   - Get execution status (polling)
GET    /api/tests/results/{runId}  - Get test results
GET    /api/reports/{runId}/html   - Download HTML report
GET    /api/reports/{runId}/json   - Download JSON report
```

---

## DATA MODELS

### Parsed Endpoint
```
{
  id: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  summary: string,
  description: string,
  tags: string[],
  deprecated: boolean,
  parameters: Parameter[],
  requestBody: RequestBody | null,
  responses: Response[],
  security: SecurityRequirement[],
  dependencies: string[]  // IDs of endpoints this depends on
}
```

### Generated Test Case
```
{
  id: string,
  endpointId: string,
  category: "positive" | "negative_required" | "negative_type" | "negative_boundary" | "auth",
  name: string,
  description: string,
  request: {
    method: string,
    path: string,
    headers: object,
    queryParams: object,
    body: object | null
  },
  expectedResponse: {
    statusCode: number | number[],
    schemaValidation: boolean,
    bodyContains: string[] | null
  },
  dependsOn: string[] | null  // Test IDs to run before this
}
```

### Test Result
```
{
  testId: string,
  status: "passed" | "failed" | "skipped",
  request: object,
  response: {
    statusCode: number,
    headers: object,
    body: object,
    responseTime: number
  },
  assertions: {
    statusCode: { expected: number, actual: number, passed: boolean },
    schemaValid: { passed: boolean, errors: string[] },
    responseTime: { expected: number, actual: number, passed: boolean }
  },
  errorMessage: string | null
}
```

---

## TEST GENERATION RULES

### Rule 1: Positive Test Generation

For each endpoint, generate ONE positive test with:
- All required fields populated with valid data
- Optional fields included with valid data
- Valid authentication (if required)
- Expected: Success status code (200, 201, 204)

### Rule 2: Missing Required Field Tests

For each required field in request:
- Generate test with that field omitted
- Expected: 400 Bad Request
- Generate N tests where N = number of required fields

### Rule 3: Invalid Type Tests

For each field, generate tests with wrong types:

| Field Type | Invalid Values to Test |
|------------|------------------------|
| string | 123, true, [], {} |
| integer | "abc", true, 1.5, [] |
| number | "abc", true, [] |
| boolean | "yes", 1, "true" |
| array | "string", {}, 123 |
| object | "string", [], 123 |

### Rule 4: Boundary Value Tests

| Constraint | Test Values |
|------------|-------------|
| minimum: X | X-1, X, X+1 |
| maximum: Y | Y-1, Y, Y+1 |
| minLength: X | length X-1, X, X+1 |
| maxLength: Y | length Y-1, Y, Y+1 |
| minItems: X | X-1 items, X items |
| maxItems: Y | Y items, Y+1 items |

### Rule 5: Format Validation Tests

| Format | Invalid Values |
|--------|----------------|
| email | "notanemail", "@missing.com", "missing@.com" |
| date | "not-a-date", "2024-13-45", "2024/01/01" |
| date-time | "not-datetime", "2024-01-01 10:00" (missing T) |
| uuid | "not-a-uuid", "12345", "g1234567-1234-1234-1234-123456789012" |
| uri | "not-a-uri", "missing-protocol.com" |

### Rule 6: Auth Tests

If endpoint requires authentication:
- Test with valid auth → expect success
- Test with no auth → expect 401
- Test with invalid auth → expect 401 or 403

### Rule 7: Dependency Handling

```
1. Detect CRUD patterns by path similarity
2. For GET/PUT/DELETE with {id} parameter:
   - Find corresponding POST endpoint
   - Execute POST first, extract ID from response
   - Use extracted ID in dependent requests
3. If parent test fails, skip dependent tests
```

---

## EXECUTION FLOW

```
1. User provides Swagger source
2. Parse Swagger specification
3. Display endpoints for selection
4. User selects endpoints and options
5. Generate test cases based on rules
6. User initiates execution
7. Execute tests with concurrency control:
   a. Group tests by dependency
   b. Execute independent tests in parallel
   c. Execute dependent tests sequentially after parents
   d. Store results in database
8. Poll for status updates (WebSocket or polling)
9. Display results dashboard
10. Generate downloadable report
```

---

## ERROR HANDLING

| Error | Handling |
|-------|----------|
| Invalid Swagger URL | Display error, ask for valid URL |
| Swagger parse failure | Show parse errors, highlight issues |
| Network timeout | Mark test as failed with timeout error |
| Connection refused | Mark test as failed, suggest checking base URL |
| Invalid auth | Mark auth tests appropriately |
| Circular dependency | Detect and warn, break cycle |

---

## REPORT GENERATION

### HTML Report Contents

1. **Executive Summary**
   - Total tests, pass/fail/skip counts
   - Pass rate percentage
   - Total execution time
   - Environment details

2. **Results by Endpoint**
   - Expandable sections per endpoint
   - Pass/fail counts per endpoint
   - Average response time

3. **Results by Category**
   - Positive, Negative, Auth breakdown
   - Identify weak areas

4. **Failed Tests Detail**
   - Full request/response
   - Expected vs actual
   - Error analysis

5. **Performance Metrics**
   - Response time distribution
   - Slowest endpoints
   - Timeout occurrences

---

## CONFIGURATION OPTIONS

```
{
  "execution": {
    "timeout": 30000,           // Request timeout in ms
    "concurrency": 5,           // Parallel requests
    "retries": 1,               // Retry failed requests
    "retryDelay": 1000          // Delay between retries
  },
  "generation": {
    "positiveTests": true,
    "negativeRequired": true,
    "negativeTypes": true,
    "negativeBoundary": true,
    "authTests": true,
    "includeDeprecated": false
  },
  "validation": {
    "schemaValidation": true,
    "responseTimeThreshold": 5000  // Max acceptable response time
  }
}
```

---

## IMPLEMENTATION PHASES

### Phase 1: Core Parser & Basic Tests
- Swagger URL/file input
- Parse endpoints, parameters, schemas
- Generate positive tests only
- Basic execution and results display

### Phase 2: Negative Test Generation
- Missing required field tests
- Invalid type tests
- Boundary value tests
- Format validation tests

### Phase 3: Advanced Features
- Dependency chain detection
- Auth testing
- Response schema validation
- Concurrent execution

### Phase 4: Reporting & Polish
- HTML report generation
- Export functionality
- Results history
- Performance metrics

---

## SUCCESS CRITERIA

| Criteria | Measure |
|----------|---------|
| Parse any valid OpenAPI 2.0/3.x spec | 100% compatibility |
| Generate minimum 5 test cases per endpoint | Verified |
| Execute 100 tests within 5 minutes | Performance |
| Accurate schema validation | Using ajv |
| Clear pass/fail reporting | UI completeness |
| Exportable reports | HTML and JSON |

---

**END OF PROMPT**

Copy this entire prompt into Replit Agent to build the Autonomous API Testing Module for NAT 2.0.
