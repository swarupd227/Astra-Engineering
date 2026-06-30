/**
 * Form data generator for automated test form filling.
 * Reuses the shared syntheticValue utility (which powers the test-data-generation feature)
 * to produce realistic, deterministic values for each form field found in a DOM contract.
 *
 * Two paths:
 *   1. Rule-based (default): uses syntheticValue() to match field name/type/label patterns
 *   2. LLM-assisted: when websiteType context is available, produces contextually
 *      appropriate values by calling the configured LLM
 */

import { syntheticValue } from "../../utils/synthetic-value";
import { getSelectedLLM } from "../../llm-config";

export interface FormField {
  name?: string;
  type?: string;
  label?: string;
  required?: boolean;
  selector: string;
  xpath: string;
}

export interface FilledField {
  selector: string;
  xpath: string;
  value: string;
  action: "fill" | "check" | "select";
}

/**
 * Determine the best key to match patterns against for a given field.
 * Priority: label > name > type
 */
function fieldKey(field: FormField): string {
  return (field.label ?? field.name ?? field.type ?? "text").toLowerCase();
}

/**
 * Map HTML input type to a fill action.
 */
function fillAction(field: FormField): "fill" | "check" | "select" {
  const t = (field.type ?? "text").toLowerCase();
  if (t === "checkbox" || t === "radio") return "check";
  if (t === "select-one" || t === "select" || t === "select-multiple") return "select";
  return "fill";
}

/**
 * Generate fill data for all fields in a form using rule-based synthetic values.
 */
export function generateFormFillData(
  fields: FormField[],
  formIndex: number = 0
): FilledField[] {
  return fields.map((field, fieldIdx) => {
    const action = fillAction(field);
    const key = fieldKey(field);

    let value: string;
    if (action === "check" || action === "select") {
      value = action === "check" ? "__check__" : "__select__";
    } else {
      const raw = syntheticValue(key, formIndex * 100 + fieldIdx);
      value = String(raw);
    }

    return {
      selector: field.selector,
      xpath: field.xpath,
      value,
      action,
    };
  });
}

/**
 * Generate fill data for forms using LLM context when websiteType is known.
 * Falls back to rule-based generation if LLM fails or is unavailable.
 */
export async function generateFormFillDataWithContext(
  fields: FormField[],
  context: {
    websiteType?: string;
    pageTitle?: string;
    formName?: string;
    formIndex?: number;
  }
): Promise<FilledField[]> {
  const client = getSelectedLLM();
  if (!client || fields.length === 0) {
    return generateFormFillData(fields, context.formIndex ?? 0);
  }

  try {
    const fieldDescriptions = fields.map((f, i) => ({
      index: i,
      name: f.name ?? "",
      type: f.type ?? "text",
      label: f.label ?? "",
      required: f.required ?? false,
    }));

    const systemPrompt = `You are a QA test data expert. Given a web form's fields, generate realistic test values for each field.
Output ONLY valid JSON array with this exact shape (no markdown):
[{ "index": 0, "value": "test value here" }, ...]
- Use realistic but fake values appropriate for the website type and form context
- For password fields use: Test@1234!
- For email use: testuser@example.com
- Skip checkboxes and selects (omit them from output)
- Keep values concise and valid for the field type`;

    const userPrompt = `Website type: ${context.websiteType ?? "general web app"}
Page: ${context.pageTitle ?? "unknown"}
Form: ${context.formName ?? `Form ${(context.formIndex ?? 0) + 1}`}
Fields: ${JSON.stringify(fieldDescriptions, null, 2)}

Generate a test value for each text/input field. Return only the JSON array.`;

    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    } as any);

    const content = (response as any).choices?.[0]?.message?.content ?? "";
    const raw = content.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as Array<{ index: number; value: string }>;
    const valueByIndex = new Map(parsed.map((p) => [p.index, p.value]));

    return fields.map((field, i) => {
      const action = fillAction(field);
      let value: string;
      if (action === "check") {
        value = "__check__";
      } else if (action === "select") {
        value = "__select__";
      } else {
        value = valueByIndex.get(i) ?? String(syntheticValue(fieldKey(field), i));
      }
      return { selector: field.selector, xpath: field.xpath, value, action };
    });
  } catch (e) {
    console.warn("[form-data-generator] LLM fill failed, using rule-based fallback:", (e as Error)?.message);
    return generateFormFillData(fields, context.formIndex ?? 0);
  }
}

/**
 * Build a map of form fill data for all forms in a DOM contract.
 * Returns: formIndex → FilledField[]
 */
export async function buildFormFillMap(
  forms: Array<{ formIndex: number; name?: string; fields?: FormField[] }>,
  context: { websiteType?: string; pageTitle?: string }
): Promise<Map<number, FilledField[]>> {
  const result = new Map<number, FilledField[]>();
  for (const form of forms) {
    const fields = form.fields ?? [];
    if (fields.length === 0) continue;
    const filled = await generateFormFillDataWithContext(fields, {
      ...context,
      formName: form.name,
      formIndex: form.formIndex,
    });
    result.set(form.formIndex, filled);
  }
  return result;
}
