import Anthropic from "@anthropic-ai/sdk";
import { createQeAnthropicClient } from './ai-client.js';

let anthropic: Anthropic | null = null;

// On AWS the unified facade routes the synthetic-data LLM call through
// Bedrock, which needs no Anthropic API key. On Azure we still require the
// Replit-hosted Anthropic proxy key. `isLLMGenerationAvailable()` is used by
// both upstream callers and the route layer to decide whether to attempt AI
// generation at all, so it must reflect the chosen hosting backend.
function llmBackendAvailable(): boolean {
  const onAws = (process.env.DEVX_HOSTING || 'azure').toLowerCase().trim() === 'aws';
  if (onAws) return true;
  return !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function getAnthropicClient(): Anthropic | null {
  if (anthropic) return anthropic;
  if (llmBackendAvailable()) {
    anthropic = createQeAnthropicClient();
  }
  return anthropic;
}

export function isLLMGenerationAvailable(): boolean {
  return llmBackendAvailable();
}

interface SyntheticDataRequest {
  domain: string;
  subDomain: string;
  fields: string[];
  customFields: string[];
  recordCount: number;
  dataPrefix?: string;
}

const BATCH_SIZE = 50;

function getFieldTypeHints(fields: string[], customFields: string[], domain: string, subDomain: string): string {
  const allFields = [...fields, ...customFields];
  const hints: string[] = [];
  
  for (const field of allFields) {
    const lowerField = field.toLowerCase();
    
    if (lowerField.includes("vin")) {
      hints.push(`- ${field}: Generate valid 17-character VIN format (e.g., "1HGBH41JXMN109186")`);
    } else if (lowerField.includes("policy") && (lowerField.includes("number") || lowerField.includes("id"))) {
      hints.push(`- ${field}: Format like "POL-2024-XXXXXX" with realistic numbering`);
    } else if (lowerField.includes("claim") && (lowerField.includes("number") || lowerField.includes("id"))) {
      hints.push(`- ${field}: Format like "CLM-2024-XXXXXX"`);
    } else if (lowerField.includes("ssn") || lowerField.includes("social_security")) {
      hints.push(`- ${field}: Format XXX-XX-XXXX with realistic patterns (use 900-999 range for test data)`);
    } else if (lowerField.includes("premium") || lowerField.includes("annual_premium")) {
      hints.push(`- ${field}: Realistic insurance premium amounts ($800-$8000 for auto, $1000-$15000 for home)`);
    } else if (lowerField.includes("deductible")) {
      hints.push(`- ${field}: Standard deductible amounts ($250, $500, $1000, $2500)`);
    } else if (lowerField.includes("coverage") && lowerField.includes("limit")) {
      hints.push(`- ${field}: Realistic coverage limits (25000, 50000, 100000, 250000, 500000)`);
    } else if (lowerField.includes("mileage") || lowerField.includes("annual_miles")) {
      hints.push(`- ${field}: Realistic annual mileage (5000-25000 miles)`);
    } else if (lowerField.includes("vehicle_year") || lowerField.includes("model_year")) {
      hints.push(`- ${field}: Vehicle years between 2010-2024`);
    } else if (lowerField.includes("make")) {
      hints.push(`- ${field}: Real car manufacturers (Toyota, Honda, Ford, Chevrolet, BMW, etc.)`);
    } else if (lowerField.includes("model")) {
      hints.push(`- ${field}: Real car models matching the make`);
    } else if (lowerField.includes("state") || lowerField.includes("garaging_state")) {
      hints.push(`- ${field}: Valid US state abbreviations (CA, TX, NY, FL, etc.)`);
    } else if (lowerField.includes("zip") || lowerField.includes("postal")) {
      hints.push(`- ${field}: Valid US ZIP codes matching the state`);
    } else if (lowerField.includes("city")) {
      hints.push(`- ${field}: Real US cities matching the state`);
    } else if (lowerField.includes("account") && lowerField.includes("number")) {
      hints.push(`- ${field}: Bank account format (10-12 digits)`);
    } else if (lowerField.includes("routing")) {
      hints.push(`- ${field}: Valid 9-digit routing number format`);
    } else if (lowerField.includes("credit_score") || lowerField.includes("fico")) {
      hints.push(`- ${field}: Realistic credit scores (580-850)`);
    } else if (lowerField.includes("age") && !lowerField.includes("mileage")) {
      hints.push(`- ${field}: Driver ages (16-85)`);
    } else if (lowerField.includes("license") && lowerField.includes("number")) {
      hints.push(`- ${field}: State-specific driver license format`);
    } else if (lowerField.includes("icd") || lowerField.includes("diagnosis_code")) {
      hints.push(`- ${field}: Valid ICD-10 codes (e.g., J06.9, M54.5)`);
    } else if (lowerField.includes("ndc") || lowerField.includes("drug_code")) {
      hints.push(`- ${field}: Valid NDC drug codes format`);
    } else if (lowerField.includes("mrn") || lowerField.includes("patient_id")) {
      hints.push(`- ${field}: Medical record number format (MRN-XXXXXXXX)`);
    } else if (lowerField.includes("sku") || lowerField.includes("product_code")) {
      hints.push(`- ${field}: SKU format (ABC-12345-XYZ)`);
    } else if (lowerField.includes("order_id") || lowerField.includes("order_number")) {
      hints.push(`- ${field}: Order ID format (ORD-2024-XXXXXX)`);
    } else if (lowerField.includes("imei")) {
      hints.push(`- ${field}: Valid 15-digit IMEI format`);
    } else if (lowerField.includes("msisdn") || lowerField.includes("phone_number")) {
      hints.push(`- ${field}: Phone format +1-XXX-XXX-XXXX`);
    }
  }
  
  if (domain === "Insurance") {
    hints.push("\nINSURANCE-SPECIFIC RULES:");
    hints.push("- All monetary values should be realistic for insurance industry");
    hints.push("- Policy dates should have logical effective/expiration relationships");
    hints.push("- Coverage types should match the sub-domain (Auto: Liability, Collision, Comprehensive; Home: Dwelling, Personal Property, Liability)");
    hints.push("- Risk scores should correlate with premium amounts");
  } else if (domain === "Banking") {
    hints.push("\nBANKING-SPECIFIC RULES:");
    hints.push("- Interest rates should be realistic (3%-25% depending on product)");
    hints.push("- Loan amounts should match loan types");
    hints.push("- Account statuses should be realistic (Active, Dormant, Closed)");
  } else if (domain === "Healthcare") {
    hints.push("\nHEALTHCARE-SPECIFIC RULES:");
    hints.push("- Diagnosis codes must be valid ICD-10 format");
    hints.push("- Procedure codes should match diagnoses logically");
    hints.push("- Patient ages should be realistic for conditions");
  }
  
  return hints.length > 0 ? "\nFIELD-SPECIFIC REQUIREMENTS:\n" + hints.join("\n") : "";
}

async function generateBatch(
  anthropic: Anthropic,
  domain: string,
  subDomain: string,
  fields: string[],
  customFields: string[],
  batchSize: number,
  batchNumber: number,
  dataPrefix?: string
): Promise<Record<string, any>[]> {
  const allFields = [...fields, ...customFields];
  const fieldTypeHints = getFieldTypeHints(fields, customFields, domain, subDomain);
  
  const prompt = `You are a production-grade synthetic data generation expert specializing in ${domain} ${subDomain} data. Your output will be used for enterprise QA testing, so data quality and realism are CRITICAL.

TASK: Generate exactly ${batchSize} unique, production-ready records.

DOMAIN: ${domain}
SUB-DOMAIN: ${subDomain}
BATCH NUMBER: ${batchNumber} (ensure records are unique across batches)

FIELDS TO GENERATE:
${allFields.map(f => `- ${f}`).join("\n")}
${fieldTypeHints}

MANDATORY DATA COORDINATION RULES (VIOLATION = FAILURE):

1. DATE COORDINATION:
   - Policy_Effective_Date: Random date in 2023-2024
   - Policy_Expiration_Date: MUST be 6 months to 1 year AFTER effective date
   - Claim_Date: MUST be AFTER effective date and BEFORE expiration date
   - Birth dates (DOB): Generate realistic dates (ages 18-80 for adults, vary appropriately)
   - NEVER generate same date for effective and expiration

2. RELATIONSHIP FIELD VALUES:
   - Relationship field: ONLY use valid values: "Self", "Spouse", "Child", "Parent", "Domestic Partner", "Other Dependent"
   - If relationship is "Self", DOB should indicate age 18-80
   - If relationship is "Child", DOB should indicate age 0-26
   - If relationship is "Spouse", DOB should be similar range to Self (within 15 years)

3. HEALTHCARE SUBSCRIBER DATA:
   - Subscriber_DOB: Real date format YYYY-MM-DD (e.g., "1985-03-15", "1972-11-28")
   - Member_ID: Format like "HEA_XXXXXX" or "MEM-XXXXXXX"
   - Group_Number: Numeric format like "100001", "200045"
   - NEVER use placeholders like "Data_1", "Data_2", "N/A", "TBD"

4. INSURANCE POLICY DATA:
   - Premium_Amount: Realistic values $800-$15,000 annually based on coverage
   - Deductible: Standard values: $250, $500, $1000, $1500, $2000, $2500
   - Coverage_Limit: Standard values: $25000, $50000, $100000, $250000, $500000

5. CROSS-FIELD CONSISTENCY:
   - State/City/ZIP must match real US locations
   - Vehicle Make/Model must be real combinations (Toyota Camry, Honda Accord)
   - Names should be diverse (various ethnicities, genders)
   - Emails derived from names (firstname.lastname@domain.com)
   - Phone numbers: realistic format (555-XXX-XXXX or area codes)

6. ID GENERATION:
   - Each ID must be unique within the batch
   - Use proper formats: Policy_Number (POL-2024-XXXXXX), Claim_Number (CLM-2024-XXXXXX)
   ${dataPrefix ? `- Prefix all IDs with "${dataPrefix}"` : ""}

ABSOLUTE PROHIBITIONS:
- NO placeholder text: "Data_1", "Data_2", "TBD", "N/A", "Example", "Test"
- NO identical dates for start/end date pairs
- NO invalid relationship values
- NO unrealistic ages (negative, >120)
- NO malformed dates

OUTPUT FORMAT:
Return ONLY a valid JSON array of exactly ${batchSize} records. No markdown, no explanation, no commentary.
Each record must have ALL specified fields with realistic, coordinated values.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }]
  });

  const textContent = response.content.find(block => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonText = textContent.text.trim();
  
  try {
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(jsonText);
  } catch (parseError) {
    console.error("Failed to parse batch response:", jsonText.substring(0, 500));
    throw new Error("Failed to parse generated data batch");
  }
}

export async function generateSyntheticDataWithLLM(
  request: SyntheticDataRequest
): Promise<Record<string, any>[]> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("LLM generation unavailable: AI Integrations not configured");
  }

  const { domain, subDomain, fields, customFields, recordCount, dataPrefix } = request;

  const allRecords: Record<string, any>[] = [];
  const numBatches = Math.ceil(recordCount / BATCH_SIZE);

  console.log(`Generating ${recordCount} records in ${numBatches} batch(es)...`);

  for (let batch = 0; batch < numBatches; batch++) {
    const remainingRecords = recordCount - allRecords.length;
    const currentBatchSize = Math.min(BATCH_SIZE, remainingRecords);

    console.log(`Generating batch ${batch + 1}/${numBatches} (${currentBatchSize} records)...`);

    try {
      const batchRecords = await generateBatch(
        client,
        domain,
        subDomain,
        fields,
        customFields,
        currentBatchSize,
        batch + 1,
        dataPrefix
      );
      
      allRecords.push(...batchRecords);
      console.log(`Batch ${batch + 1} complete. Total records: ${allRecords.length}`);
      
    } catch (error: any) {
      console.error(`Batch ${batch + 1} failed:`, error.message);
      
      if (allRecords.length > 0) {
        console.log(`Returning ${allRecords.length} records generated before failure`);
        return allRecords;
      }
      throw error;
    }
  }
  
  return allRecords.slice(0, recordCount);
}

export async function generateFieldSuggestions(
  domain: string,
  subDomain: string,
  existingFields: string[]
): Promise<string[]> {
  const client = getAnthropicClient();
  if (!client) {
    console.log("Field suggestions unavailable: AI Integrations not configured");
    return [];
  }

  const prompt = `For a ${domain} ${subDomain} dataset that already has these fields: ${existingFields.join(", ")}

Suggest 5-10 additional relevant fields that would complement this dataset for testing purposes. Consider:
- Fields commonly used in ${domain} ${subDomain} applications
- Fields that would help test edge cases and validations
- Fields that have logical relationships with existing ones

Return ONLY a JSON array of field names in Title_Case_Underscore format, nothing else.

Example: ["Customer_Segment", "Risk_Score", "Policy_Duration_Years"]`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }]
    });

    const textContent = response.content.find(block => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      return [];
    }

    const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error("Field suggestion error:", error);
    return [];
  }
}
