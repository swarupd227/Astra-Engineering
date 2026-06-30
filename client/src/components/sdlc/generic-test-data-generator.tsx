import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { PRESET_ENTITIES_ALL_DOMAINS } from "../../lib/synthetic-preset-entities";
import { cn } from "@/lib/utils";
import { useDomain, DOMAIN_CONFIG } from "@/contexts/domain-context";
import JSZip from "jszip";
import mammoth from "mammoth";
import {
  Check,
  ChevronDown,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Link2,
  Plus,
  Shield,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

type TestDataRecord = Record<string, any>;

type SchemaObfuscationMapRow = {
  originalName: string;
  obfuscatedName: string;
  columns: Array<{ originalName: string; obfuscatedName: string; pii: boolean }>;
};

/**
 * Start a synthetic-data generation job and poll for completion.
 *
 * AWS API Gateway has a hard ~30s integration timeout that buffers responses
 * end-to-end, so LLM-backed generation can't return synchronously. The server
 * exposes /start (returns a jobId) and /status/:jobId (returns phase + result
 * once complete); this helper drives that loop and surfaces the final payload
 * to the caller as if it were a single synchronous request.
 *
 * Polling stops on completion, error, expiry (404), or after `maxWaitMs`. The
 * loop returns naturally when the component unmounts because nothing schedules
 * work outside of `await`.
 */
async function startAndPollSyntheticGenJob(
  startPath: "/api/testing/generate-test-data/start" | "/api/testing/generate-test-data-from-schema/start",
  body: unknown,
  opts?: { intervalMs?: number; maxWaitMs?: number },
): Promise<unknown> {
  const intervalMs = opts?.intervalMs ?? 1500;
  const maxWaitMs = opts?.maxWaitMs ?? 5 * 60 * 1000;

  const startRes = await fetch(getApiUrl(startPath), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!startRes.ok) {
    const errData = await startRes.json().catch(() => ({})) as { error?: string };
    throw new Error(
      errData.error
        || `Failed to start generation (HTTP ${startRes.status}${startRes.statusText ? ` ${startRes.statusText}` : ""})`,
    );
  }
  const startData = await startRes.json() as { success?: boolean; jobId?: string; error?: string };
  if (!startData.success || !startData.jobId) {
    throw new Error(startData.error || "Failed to start generation: server did not return a jobId");
  }
  const jobId = startData.jobId;
  const statusUrl = getApiUrl(`/api/testing/generate-test-data/status/${jobId}`);
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const statusRes = await fetch(statusUrl, { credentials: "include" });
    if (statusRes.status === 404) {
      throw new Error("Generation job expired before it completed. Please try again.");
    }
    if (!statusRes.ok) {
      throw new Error(`Polling failed (HTTP ${statusRes.status}${statusRes.statusText ? ` ${statusRes.statusText}` : ""})`);
    }
    const statusData = await statusRes.json() as {
      phase?: "processing" | "complete" | "error";
      result?: unknown;
      error?: string;
    };
    if (statusData.phase === "complete") {
      return statusData.result;
    }
    if (statusData.phase === "error") {
      throw new Error(statusData.error || "Generation failed on the server.");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Generation timed out. Please try again with fewer records or AI disabled.");
}

/** Derive display label from a key (e.g. "order_items" → "Order Items"). */
function deriveLabelFromKey(key: string): string {
  if (!key) return key;
  return key
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** T-SQL `[name]` → `"name"` so CREATE TABLE / INSERT parsing matches uniformly. */
function normalizeSqlServerBrackets(sql: string): string {
  return sql.replace(/\[([^\]]*)]/g, (_, inner: string) => `"${inner.replace(/"/g, '""')}"`);
}

/** Strip one SQL identifier segment of quotes / brackets / backticks */
function unquoteSqlIdentSegment(seg: string): string {
  const t = seg.trim();
  const bt = t.match(/^`([^`]+)`$/);
  if (bt) return bt[1].trim();
  const dq = t.match(/^"([^"]*)"$/);
  if (dq) return dq[1].trim();
  const br = t.match(/^\[([^\]]+)\]$/);
  if (br) return br[1].trim();
  const sq = t.match(/^'([^']+)'$/);
  if (sq) return sq[1].trim();
  return t;
}

/** Readable qualified name + lowercase key so CREATE TABLE and INSERT INTO match the same table */
function tableRefKeyAndDisplay(raw: string): { key: string; display: string } {
  const s = raw.trim();
  const parts = s.split(/\s*\.\s*/).map(unquoteSqlIdentSegment);
  const display = parts.filter(Boolean).join(".") || s.replace(/["`[\]]/g, "").trim();
  const key = display.toLowerCase();
  return { key, display };
}

/** Strip SQL comments + BOM before DDL parsing */
function preprocessSqlForSchemaParse(raw: string): string {
  let s = raw.replace(/^\uFEFF/, "");
  s = normalizeSqlServerBrackets(s);
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/--[^\n\r]*/g, "");
  s = s.replace(/#[^\n\r]*/g, "");
  return s;
}

/** Merge DDL + INSERT-inferred tables (union columns; preserve first-seen table/column casing). */
function mergeParsedSqlTables(
  a: Array<{ name: string; columns: Array<{ name: string }> }>,
  b: Array<{ name: string; columns: Array<{ name: string }> }>
): Array<{ name: string; columns: Array<{ name: string }> }> {
  const byTable = new Map<string, { displayName: string; cols: Map<string, string> }>();
  const ingest = (tables: typeof a) => {
    for (const t of tables) {
      const { key: tk, display } = tableRefKeyAndDisplay(t.name);
      let row = byTable.get(tk);
      if (!row) {
        row = { displayName: display, cols: new Map() };
        byTable.set(tk, row);
      }
      for (const { name } of t.columns) {
        const ck = name.toLowerCase();
        if (!row.cols.has(ck)) row.cols.set(ck, name);
      }
    }
  };
  ingest(a);
  ingest(b);
  return Array.from(byTable.values()).map(({ displayName, cols }) => ({
    name: displayName,
    columns: Array.from(cols.values()).map((name) => ({ name })),
  }));
}

/** Infer tables/columns from INSERT … (col1, col2) … VALUES|SELECT when DDL has no CREATE TABLE or to merge extras */
function parseSqlInsertColumnLists(sql: string): Array<{ name: string; columns: Array<{ name: string }> }> {
  const byTable = new Map<string, { displayTable: string; cols: Map<string, string> }>();
  const INSERT_HEAD =
    /\bINSERT\s+(?:IGNORE\s+|LOW_PRIORITY\s+|DELAYED\s+)?(?:OR\s+(?:REPLACE|IGNORE|ROLLBACK|ABORT|FAIL)\s+)?INTO\s+/gi;

  let ins: RegExpExecArray | null;
  while ((ins = INSERT_HEAD.exec(sql)) !== null) {
    let pos = ins.index + ins[0].length;
    while (pos < sql.length && /\s/.test(sql[pos])) pos++;

    let tableEnd = pos;
    let foundParen = false;
    let depth = 0;
    for (; tableEnd < sql.length; tableEnd++) {
      const ch = sql[tableEnd];
      if (ch === "(" && depth === 0) {
        foundParen = true;
        break;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (!foundParen) continue;

    let tableRaw = sql.slice(pos, tableEnd).trim().replace(/\s+AS\s+\w+$/i, "").trim();
    if (!tableRaw) continue;

    const inner = extractSqlParenGroup(sql, tableEnd);
    if (!inner || !inner.trim()) continue;

    let afterParen = tableEnd + inner.length + 2;
    while (afterParen < sql.length && /\s/.test(sql[afterParen])) afterParen++;
    const tail = sql.slice(afterParen, afterParen + 16).toUpperCase();
    if (!/^(VALUES|SELECT|WITH)\b/.test(tail)) continue;

    const colNames = splitSqlCreateDefinitionFragments(inner)
      .map((frag) => parseColumnNameFromCreateFragment(frag))
      .filter((n): n is string => !!n);

    if (colNames.length === 0) continue;

    const { key: tk, display } = tableRefKeyAndDisplay(tableRaw);
    let row = byTable.get(tk);
    if (!row) {
      row = { displayTable: display, cols: new Map() };
      byTable.set(tk, row);
    }
    for (const c of colNames) {
      const ck = c.toLowerCase();
      if (!row.cols.has(ck)) row.cols.set(ck, c);
    }
  }

  return Array.from(byTable.values()).map(({ displayTable, cols }) => ({
    name: displayTable,
    columns: Array.from(cols.values()).map((name) => ({ name })),
  }));
}

/** Match the closing `)` for the opening `(` at openIdx (nested-paren aware). */
function extractSqlParenGroup(sql: string, openIdx: number): string | null {
  if (openIdx < 0 || openIdx >= sql.length || sql[openIdx] !== "(") return null;
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    const c = sql[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return sql.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Split CREATE TABLE (...) body on commas not inside nested parentheses. */
function splitSqlCreateDefinitionFragments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** First column / index name from a CREATE TABLE clause; skip constraints. */
function parseColumnNameFromCreateFragment(fragment: string): string | null {
  const t = fragment.trim();
  if (!t || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|KEY|INDEX|FULLTEXT|SPATIAL|PARTITION)\b/i.test(t)) {
    return null;
  }
  const bracket = t.match(/^\[([^\]]+)\]/);
  if (bracket) return bracket[1].trim();
  const backtick = t.match(/^`([^`]+)`/);
  if (backtick) return backtick[1].trim();
  const dq = t.match(/^"([^"]+)"/);
  if (dq) return dq[1].trim();
  const sq = t.match(/^'([^']+)'/);
  if (sq) return sq[1].trim();
  const plain = t.match(/^([a-zA-Z_][a-zA-Z0-9_$#]*)\b/);
  if (plain) return plain[1];
  return null;
}

/** Parse SQL DDL: extract every CREATE TABLE with full column lists (handles VARCHAR(255), etc.). */
function parseSqlCreateTablesScript(cleanSql: string): Array<{ name: string; columns: Array<{ name: string }> }> {
  const parsedTables: Array<{ name: string; columns: Array<{ name: string }> }> = [];
  const re =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+)?(?:TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:[`"]([^`"]+)[`"]|([a-zA-Z_][a-zA-Z0-9_$#]*))\s*\.\s*)?(?:[`"]([^`"]+)[`"]|([a-zA-Z_][a-zA-Z0-9_$#]*))\s*\(/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(cleanSql)) !== null) {
    const schemaPart = (match[1] || match[2] || "").trim();
    const tablePart = (match[3] || match[4] || "").trim();
    const tableName = schemaPart ? `${schemaPart}.${tablePart}` : tablePart;
    if (!tableName) continue;
    const openParenIdx = match.index + match[0].length - 1;
    if (cleanSql[openParenIdx] !== "(") continue;
    const inner = extractSqlParenGroup(cleanSql, openParenIdx);
    if (!inner) continue;
    const fragments = splitSqlCreateDefinitionFragments(inner);
    const columns: Array<{ name: string }> = [];
    const seen = new Set<string>();
    for (const frag of fragments) {
      const colName = parseColumnNameFromCreateFragment(frag);
      if (colName) {
        const key = colName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          columns.push({ name: colName });
        }
      }
    }
    if (columns.length > 0) {
      parsedTables.push({ name: tableName, columns });
    }
  }
  return parsedTables;
}

const FALLBACK_MIN_RECORDS = 1;
const FALLBACK_MAX_RECORDS = 1_000_000;
const FALLBACK_DEFAULT_RECORDS = 100;
const FALLBACK_TOKEN_ESTIMATE = {
  inputPerBatch: 550,
  outputPerRecordMain: 28,
  outputPerRecordRoot: 20,
  batchSize: 40,
};

type EntityOption = { id: string; label: string; count: number; fields: string[] };

const ALL_PII_TYPES = [
  { id: "email", label: "Email Addresses" },
  { id: "phone", label: "Phone Numbers" },
  { id: "name", label: "Names" },
  { id: "ssn", label: "SSN" },
  { id: "address", label: "Addresses" },
  { id: "card", label: "Credit/Debit Cards" },
  { id: "dob", label: "Date of Birth" },
  { id: "ip", label: "IP Addresses" },
  { id: "account", label: "Account Numbers" },
  { id: "password", label: "Passwords" },
] as const;

const DEFAULT_ENTITIES: EntityOption[] = PRESET_ENTITIES_ALL_DOMAINS.map((e) => ({
  id: e.id,
  label: e.label,
  count: e.fields.length,
  fields: [...e.fields],
}));

function getPiiType(columnName: string): string | null {
  if (!columnName) return null;
  const spaced = columnName.replace(/([a-z])([A-Z])/g, '$1 $2');
  const norm = spaced.toLowerCase().replace(/[_\-\.]+/g, " ").trim();
  const tokens = norm.split(/\s+/);
  const has = (...words: string[]) => words.some(w => tokens.includes(w));

  if (/email/.test(norm)) return "email";
  if (has("phone", "mobile", "cell", "fax", "tel", "contact") || /phone|mobile|contact/.test(norm)) return "phone";
  if (has("ssn") || (has("social") && has("security", "sec"))) return "ssn";
  if (has("password", "passwd", "pwd", "passphrase") || /password|passwd/.test(norm)) return "password";
  if (((has("credit", "debit") && has("card")) || has("pan") || /\bcard\b/.test(norm)) && !has("type", "status", "network", "brand", "issuer", "provider", "name", "holder")) return "card";
  if (has("dob") || (has("date") && has("birth")) || (has("birth") && has("date"))) return "dob";
  if (has("ip") && !has("zip", "tip", "slip")) return "ip";
  if (has("address", "street", "addr", "location") || /address|street|location/.test(norm)) return "address";
  if ((has("account", "acct")) && !has("id", "status", "type")) return "account";
  if (has("name") || (has("first", "last", "full", "middle") && tokens.some(t => t === "name"))) return "name";
  return null;
}

type DataLimitsConfig = {
  minRecords: number;
  maxRecords: number;
  defaultRecords: number;
  tokenEstimate: {
    inputPerBatch: number;
    outputPerRecordMain: number;
    outputPerRecordRoot: number;
    batchSize: number;
  };
};

type GenericTestDataGeneratorProps = {
  /** Domain inferred from URL (e.g. from goldenRepoName). Used for first entity fetch so list matches golden-repo context. */
  initialDomainFromUrl?: string | null;
};

export function GenericTestDataGenerator({ initialDomainFromUrl }: GenericTestDataGeneratorProps = {}) {
  const { selectedDomain } = useDomain();
  const { toast } = useToast();
  const domainConfig = DOMAIN_CONFIG[selectedDomain];
  const domainForEntities = selectedDomain !== "all" ? selectedDomain : (initialDomainFromUrl ?? selectedDomain);
  const domainConfigForEntities = DOMAIN_CONFIG[domainForEntities as keyof typeof DOMAIN_CONFIG] ?? domainConfig;
  const [limitsConfig, setLimitsConfig] = useState<DataLimitsConfig | null>(null);
  const [entities, setEntities] = useState<EntityOption[]>(DEFAULT_ENTITIES);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.id === selectedEntityId) || entities[0],
    [entities, selectedEntityId]
  );

  const fetchEntities = useCallback(() => {
    setEntitiesLoading(true);
    setEntitiesError(null);
    fetch(getApiUrl("/api/testing/suggest-entities"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        domainKey: domainForEntities,
        domainLabel: domainConfigForEntities?.label ?? domainForEntities,
      }),
    })
      .then((res) => (res.ok ? res.json() : res.json().then((d) => Promise.reject(new Error(d.error || "Failed to load entities")))))
      .then((data) => {
        const list = Array.isArray(data?.entities) && data.entities.length > 0 ? data.entities : DEFAULT_ENTITIES;
        setEntities(list);
        setSelectedEntityId((prev) => {
          const stillValid = list.some((e: EntityOption) => e.id === prev);
          return stillValid ? prev : list[0]?.id ?? null;
        });
      })
      .catch((err) => {
        setEntitiesError(err instanceof Error ? err.message : "Could not load entities");
        setEntities(DEFAULT_ENTITIES);
        setSelectedEntityId(DEFAULT_ENTITIES[0]?.id ?? null);
      })
      .finally(() => setEntitiesLoading(false));
  }, [domainForEntities, domainConfigForEntities?.label]);

  useEffect(() => {
    fetch(getApiUrl("/api/testing/data-limits"), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load limits"))))
      .then((data) => {
        if (data && typeof data.minRecords === "number" && typeof data.maxRecords === "number") {
          setLimitsConfig({
            minRecords: data.minRecords,
            maxRecords: data.maxRecords,
            defaultRecords: typeof data.defaultRecords === "number" ? data.defaultRecords : FALLBACK_DEFAULT_RECORDS,
            tokenEstimate: data.tokenEstimate && typeof data.tokenEstimate === "object"
              ? {
                inputPerBatch: data.tokenEstimate.inputPerBatch ?? FALLBACK_TOKEN_ESTIMATE.inputPerBatch,
                outputPerRecordMain: data.tokenEstimate.outputPerRecordMain ?? FALLBACK_TOKEN_ESTIMATE.outputPerRecordMain,
                outputPerRecordRoot: data.tokenEstimate.outputPerRecordRoot ?? FALLBACK_TOKEN_ESTIMATE.outputPerRecordRoot,
                batchSize: data.tokenEstimate.batchSize ?? FALLBACK_TOKEN_ESTIMATE.batchSize,
              }
              : FALLBACK_TOKEN_ESTIMATE,
          });
        }
      })
      .catch(() => { /* use fallbacks */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEntitiesLoading(true);
    setEntitiesError(null);
    fetch(getApiUrl("/api/testing/suggest-entities"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        domainKey: domainForEntities,
        domainLabel: domainConfigForEntities?.label ?? domainForEntities,
      }),
    })
      .then((res) => (res.ok ? res.json() : res.json().then((d) => Promise.reject(new Error(d.error || "Failed to load entities")))))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.entities) && data.entities.length > 0 ? data.entities : DEFAULT_ENTITIES;
        setEntities(list);
        setSelectedEntityId((prev) => {
          const stillValid = list.some((e: EntityOption) => e.id === prev);
          return stillValid ? prev : list[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setEntitiesError(err instanceof Error ? err.message : "Could not load entities");
        setEntities(DEFAULT_ENTITIES);
        setSelectedEntityId(DEFAULT_ENTITIES[0]?.id ?? null);
      })
      .finally(() => {
        if (!cancelled) setEntitiesLoading(false);
      });
    return () => { cancelled = true; };
  }, [domainForEntities, domainConfigForEntities?.label]);

  const [recordCount, setRecordCount] = useState(100);
  const [presetPrefixMappings, setPresetPrefixMappings] = useState<Array<{ column: string, prefix: string }>>([{ column: "", prefix: "" }]);
  const [schemaPrefixMappings, setSchemaPrefixMappings] = useState<Array<{ column: string, prefix: string }>>([{ column: "", prefix: "" }]);
  const [enableMasking, setEnableMasking] = useState(true);
  const [selectedPiiTypes, setSelectedPiiTypes] = useState<Set<string>>(
    () => new Set(ALL_PII_TYPES.map((t) => t.id))
  );
  const [selectedPiiColumns, setSelectedPiiColumns] = useState<Set<string>>(new Set());
  const [seenPiiColumns, setSeenPiiColumns] = useState<Set<string>>(new Set());
  const [showPiiOptions, setShowPiiOptions] = useState(false);
  const [enableAiGeneration, setEnableAiGeneration] = useState(true);
  const [customFieldName, setCustomFieldName] = useState("");
  const [customFields, setCustomFields] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [records, setRecords] = useState<TestDataRecord[]>([]);
  const [relatedData, setRelatedData] = useState<Record<string, TestDataRecord[]>>({});
  const [includeDependencies, setIncludeDependencies] = useState(false);

  const [relatedEntitiesPreview, setRelatedEntitiesPreview] = useState<{ key: string; label?: string; fields: string[] }[]>([]);
  const [relatedEntitiesLoading, setRelatedEntitiesLoading] = useState(false);

  const [activeSheet, setActiveSheet] = useState<string>("main");
  const [downloadFormat, setDownloadFormat] = useState<"json" | "csv" | "sql">("json");
  const [isGenerating, setIsGenerating] = useState(false);
  const [dataSource, setDataSource] = useState<"preset" | "schema">("preset");
  const [uploadedSchema, setUploadedSchema] = useState<{
    tables: Array<{ name: string; columns: Array<{ name: string; type?: string }> }>;
  } | null>(null);

  const [selectedSchemaTables, setSelectedSchemaTables] = useState<Set<string>>(new Set());
  const [selectedSchemaColumns, setSelectedSchemaColumns] = useState<Map<string, Set<string>>>(new Map());
  const [manualMaskingColumns, setManualMaskingColumns] = useState<Set<string>>(new Set());
  const [extraColumnsMap, setExtraColumnsMap] = useState<Map<string, string[]>>(new Map());
  const [newColNames, setNewColNames] = useState<Record<string, string>>({});
  const [activeSchemaTable, setActiveSchemaTable] = useState<string>("");
  const [schemaTablesPopoverOpen, setSchemaTablesPopoverOpen] = useState(false);

  useEffect(() => {
    if (uploadedSchema?.tables && uploadedSchema.tables.length > 0) {
      setSelectedSchemaTables(new Set());
      const cols = new Map<string, Set<string>>();
      uploadedSchema.tables.forEach((t) => {
        cols.set(t.name, new Set(t.columns.map((c) => c.name)));
      });
      setSelectedSchemaColumns(cols);
      setManualMaskingColumns(new Set());
      setExtraColumnsMap(new Map());
      setNewColNames({});
      setActiveSchemaTable("");
      setSchemaTablesPopoverOpen(false);
    }
  }, [uploadedSchema]);

  const [obfuscationMap, setObfuscationMap] = useState<SchemaObfuscationMapRow[]>([]);

  useEffect(() => {
    if (!selectedEntity) return;
    setCustomFields([]);
    setSelectedFields(selectedEntity.fields);
    setRelatedData({});
    setActiveSheet("main");
  }, [selectedEntity?.id]);

  useEffect(() => {
    setSeenPiiColumns(new Set());
    setSelectedPiiColumns(new Set());
  }, [dataSource, selectedEntity?.id, uploadedSchema]);

  useEffect(() => {
    if (!selectedEntity || dataSource !== "preset" || !includeDependencies) {
      setRelatedEntitiesPreview([]);
      setRelatedEntitiesLoading(false);
      return;
    }
    let cancelled = false;
    setRelatedEntitiesLoading(true);
    fetch(getApiUrl("/api/testing/suggest-related-entities"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        domainKey: domainForEntities,
        domainLabel: domainConfigForEntities?.label ?? domainForEntities,
        entityLabel: selectedEntity.label,
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((data) => {
        if (!cancelled && data?.related) {
          setRelatedEntitiesPreview(data.related);
        }
      })
      .catch(() => {
        if (!cancelled) setRelatedEntitiesPreview([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedEntitiesLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedEntity?.label, domainForEntities, domainConfigForEntities?.label, includeDependencies, dataSource]);

  const availableFields = useMemo(() => {
    const baseFields = selectedEntity?.fields || [];
    return [...baseFields, ...customFields];
  }, [selectedEntity, customFields]);

  const previewSchemaTables = useMemo(() => {
    if (dataSource === "schema" && uploadedSchema?.tables) {
      return uploadedSchema.tables
        .filter(t => selectedSchemaTables.has(t.name))
        .map(t => {
          const baseCols = t.columns.map(c => c.name);
          const extraCols = extraColumnsMap.get(t.name) || [];
          const allCols = [...baseCols, ...extraCols];
          const selected = selectedSchemaColumns.get(t.name) || new Set();
          return {
            name: t.name,
            columns: allCols.filter(c => selected.has(c))
          };
        })
        .filter(t => t.columns.length > 0);
    }
    if (dataSource === "preset" && selectedEntity) {
      const tables = [{ name: selectedEntity.label, columns: selectedFields.length > 0 ? selectedFields : availableFields }];
      if (includeDependencies) {
        relatedEntitiesPreview.forEach(rel => {
          tables.push({ name: deriveLabelFromKey(rel.key), columns: rel.fields || [] });
        });
      }
      return tables;
    }
    return [];
  }, [dataSource, uploadedSchema, selectedEntity, selectedFields, availableFields, includeDependencies, relatedEntitiesPreview, selectedSchemaTables, selectedSchemaColumns, extraColumnsMap]);

  const detectedPiiTypes = useMemo(() => {
    const types = new Map<string, Set<string>>();
    previewSchemaTables.forEach(t => {
      t.columns.forEach(c => {
        const pii = getPiiType(c);
        if (pii) {
          if (!types.has(pii)) types.set(pii, new Set());
          types.get(pii)!.add(c);
        }
      });
    });
    return types;
  }, [previewSchemaTables]);

  useEffect(() => {
    setSelectedPiiColumns(prev => {
      const next = new Set(prev);
      let changed = false;
      const nextSeen = new Set(seenPiiColumns);
      detectedPiiTypes.forEach(colSet => {
        colSet.forEach(c => {
          if (!nextSeen.has(c)) {
            nextSeen.add(c);
            next.add(c);
            changed = true;
          }
        });
      });
      if (changed) {
        setSeenPiiColumns(nextSeen);
        return next;
      }
      return prev;
    });
  }, [detectedPiiTypes, seenPiiColumns]);

  const columns = useMemo(() => {
    const columnSet = new Set<string>();
    records.forEach((record) => {
      Object.keys(record || {}).forEach((key) => columnSet.add(key));
    });
    return Array.from(columnSet);
  }, [records]);

  const previewColumns = useMemo(() => columns, [columns]);
  const previewRows = useMemo(() => records, [records]);
  const hasData = records.length > 0;
  const fieldSelectionCount = useMemo(() => {
    if (dataSource === "schema") {
      return previewSchemaTables.reduce((acc, t) => acc + t.columns.length, 0);
    }
    return selectedFields.length;
  }, [dataSource, previewSchemaTables, selectedFields]);

  const sheets = useMemo(() => {
    if (obfuscationMap.length > 0) {
      const list: { id: string; label: string }[] = obfuscationMap.map((t, i) => ({
        id: i === 0 ? "main" : t.obfuscatedName,
        label: t.originalName || t.obfuscatedName,
      }));
      return list;
    }
    const list: { id: string; label: string }[] = [
      { id: "main", label: selectedEntity?.label ?? "Main data" },
    ];
    Object.entries(relatedData).forEach(([key]) => {
      const arr = relatedData[key];
      if (Array.isArray(arr) && arr.length > 0) {
        list.push({
          id: key,
          label: deriveLabelFromKey(key),
        });
      }
    });
    return list;
  }, [selectedEntity?.label, relatedData, obfuscationMap]);

  const activeSheetData = useMemo(() => {
    if (activeSheet === "main") return { rows: records, columns };
    const arr = relatedData[activeSheet] ?? [];
    const cols =
      arr.length > 0
        ? Array.from(new Set(arr.flatMap((r: TestDataRecord) => Object.keys(r ?? {}))))
        : [];
    return { rows: arr, columns: cols };
  }, [activeSheet, records, columns, relatedData]);

  useEffect(() => {
    if (sheets.length > 0 && !sheets.some((s) => s.id === activeSheet)) {
      setActiveSheet("main");
    }
  }, [sheets, activeSheet]);

  const minRecords = limitsConfig?.minRecords ?? FALLBACK_MIN_RECORDS;
  const maxRecords = limitsConfig?.maxRecords ?? FALLBACK_MAX_RECORDS;

  const handleGenerate = async () => {
    const normalizedCount = Math.min(
      Math.max(Number(recordCount) || minRecords, minRecords),
      maxRecords
    );
    const fieldsForRequest = selectedFields;
    setIsGenerating(true);
    try {
      const requestBody = {
        domain: domainConfig?.label ?? selectedDomain,
        domainKey: selectedDomain,
        entity: selectedEntity?.label,
        entityId: selectedEntity?.id ?? undefined,
        selectedFields: fieldsForRequest,
        useAi: enableAiGeneration,
        recordCount: normalizedCount,
        columnsToPrefix: Object.fromEntries(presetPrefixMappings.filter(m => m.column.trim() && m.prefix.trim()).map(m => [m.column.trim(), m.prefix.trim()])),
        enableMasking,
        piiColumnsToMask: enableMasking
          ? Array.from(manualMaskingColumns)
            .filter(k => k.startsWith("preset."))
            .map(k => k.slice(7))
          : undefined,
        includeDependencies: includeDependencies === true,
      };
      const data = await startAndPollSyntheticGenJob(
        "/api/testing/generate-test-data/start",
        requestBody,
      ) as {
        records?: TestDataRecord[];
        related?: Record<string, TestDataRecord[]>;
        syntheticGeneration?: { mode?: string; aiRequested?: boolean; llmConfigured?: boolean };
      };
      setRecords(Array.isArray(data.records) ? data.records : []);
      setRelatedData(data.related ?? {});
      const relatedCount = data.related
        ? Object.values(data.related).reduce(
          (sum: number, arr: unknown) => sum + (Array.isArray(arr) ? arr.length : 0),
          0
        )
        : 0;
      const sg = data.syntheticGeneration;
      const baseDesc =
        relatedCount > 0
          ? `Generated ${normalizedCount} main records + ${relatedCount} related (with dependencies).`
          : `Generated ${normalizedCount} records for ${domainConfig.label}.`;
      const sourceNote =
        sg?.mode === "llm"
          ? " Source: AI model."
          : sg?.aiRequested && !sg?.llmConfigured
            ? " Source: rule-based (no chat LLM configured on server — enable Azure OpenAI, Anthropic, or Bedrock)."
            : sg?.aiRequested && sg?.llmConfigured
              ? " Source: rule-based (AI response was unusable — check server logs; values match deterministic rules)."
              : " Source: rule-based.";
      toast({
        title: "Synthetic data generated",
        description: `${baseDesc}${sourceNote}`,
      });
    } catch (error) {
      console.error("[Test Data Generator] Error:", error);
      toast({
        title: "Generation failed",
        description:
          error instanceof Error ? error.message : "Unable to generate data.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddCustomField = () => {
    const trimmed = customFieldName.trim();
    if (!trimmed) return;
    if (availableFields.includes(trimmed)) {
      setCustomFieldName("");
      return;
    }
    setCustomFields((prev) => [...prev, trimmed]);
    setSelectedFields((prev) => [...prev, trimmed]);
    setCustomFieldName("");
  };

  const handleToggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field)
        ? prev.filter((item) => item !== field)
        : [...prev, field]
    );
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedFields(checked ? availableFields : []);
  };

  const handleDownload = (
    format: "json" | "csv" | "sql",
    relatedKey?: string
  ) => {
    const isRelated = Boolean(relatedKey);
    if (isRelated && !relatedKey) return;
    const data: TestDataRecord[] =
      isRelated && relatedKey
        ? relatedData[relatedKey] ?? []
        : records;
    const dataColumns: string[] =
      data.length > 0
        ? Array.from(
          new Set(
            data.flatMap((r: TestDataRecord) => Object.keys(r ?? {}))
          )
        )
        : columns;
    if (!isRelated && !hasData) return;
    if (isRelated && data.length === 0) return;
    const dateStamp = new Date().toISOString().split("T")[0];
    const suffix = isRelated && relatedKey ? `-${relatedKey}` : "";
    const baseName = `test-data-${selectedDomain}${suffix}-${dateStamp}`;
    if (format === "json") {
      downloadFile(
        `${baseName}.json`,
        "application/json",
        JSON.stringify(data, null, 2)
      );
      return;
    }
    if (format === "csv") {
      const csvContent = convertToCsv(data, dataColumns);
      downloadFile(`${baseName}.csv`, "text/csv", csvContent);
      return;
    }
    const tableName = sanitizeSqlIdentifier(
      selectedDomain === "all"
        ? `synthetic_data${suffix}`
        : `synthetic_${selectedDomain}${suffix}`
    );
    const sqlContent = convertToSql(data, dataColumns, tableName);
    downloadFile(`${baseName}.sql`, "text/plain", sqlContent);
  };

  const sanitizeForFilename = (name: string) =>
    name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase() || "data";

  const handleDownloadZip = async (format: "json" | "csv" | "sql") => {
    const dateStamp = new Date().toISOString().split("T")[0];
    const zip = new JSZip();
    const ext = format;
    const mainName = sanitizeForFilename(selectedEntity?.label ?? "main");
    const mainCols =
      records.length > 0
        ? Array.from(new Set(records.flatMap((r: TestDataRecord) => Object.keys(r ?? {}))))
        : columns;
    if (format === "json") {
      zip.file(`${mainName}.json`, JSON.stringify(records, null, 2));
    } else if (format === "csv") {
      zip.file(`${mainName}.csv`, convertToCsv(records, mainCols));
    } else {
      const mainTableName = sanitizeSqlIdentifier(
        selectedDomain === "all" ? "synthetic_data" : `synthetic_${selectedDomain}`
      );
      zip.file(`${mainName}.sql`, convertToSql(records, mainCols, mainTableName));
    }
    Object.entries(relatedData).forEach(([key, arr]) => {
      if (!Array.isArray(arr) || arr.length === 0) return;
      const label = deriveLabelFromKey(key);
      const fileBase = sanitizeForFilename(label);
      const cols = Array.from(new Set(arr.flatMap((r: TestDataRecord) => Object.keys(r ?? {}))));
      if (format === "json") {
        zip.file(`${fileBase}.json`, JSON.stringify(arr, null, 2));
      } else if (format === "csv") {
        zip.file(`${fileBase}.csv`, convertToCsv(arr, cols));
      } else {
        const tableName = sanitizeSqlIdentifier(`${selectedDomain === "all" ? "synthetic" : selectedDomain}_${key}`);
        zip.file(`${fileBase}.sql`, convertToSql(arr, cols, tableName));
      }
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `test-data-${selectedDomain}-all-tables-${dateStamp}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleDownloadClick = () => {
    handleDownloadZip(downloadFormat);
  };

  const toggleSchemaTable = (tableName: string) => {
    setSelectedSchemaTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  };

  const toggleSchemaColumn = (tableName: string, colName: string) => {
    setSelectedSchemaColumns(prev => {
      const next = new Map(prev);
      const cols = new Set<string>(next.get(tableName) || new Set<string>());
      if (cols.has(colName)) cols.delete(colName);
      else cols.add(colName);
      next.set(tableName, cols);
      return next;
    });
  };

  const toggleManualMasking = (tableName: string, colName: string) => {
    const key = `${tableName}.${colName}`;
    setManualMaskingColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAddExtraColumn = (tableName: string) => {
    const name = newColNames[tableName]?.trim();
    if (!name) return;
    setExtraColumnsMap(prev => {
      const next = new Map(prev);
      const list = [...(next.get(tableName) || []), name];
      next.set(tableName, Array.from(new Set(list)));
      return next;
    });
    setSelectedSchemaColumns(prev => {
      const next = new Map(prev);
      const cols = new Set<string>(next.get(tableName) || new Set<string>());
      cols.add(name);
      next.set(tableName, cols);
      return next;
    });
    setNewColNames(prev => ({ ...prev, [tableName]: "" }));
  };

  const handleSchemaFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      toast({ title: "File read failed", description: "Could not read the file", variant: "destructive" });
    };
    reader.onload = async () => {
      try {
        const buffer = (reader.result as ArrayBuffer);
        const ext = (file.name.split(".").pop() ?? "").toLowerCase();
        let text = "";

        if (ext === "docx") {
          const result = await mammoth.extractRawText({ arrayBuffer: buffer });
          text = result.value;
        } else {
          const decoder = new TextDecoder("utf-8");
          text = decoder.decode(buffer);
        }

        if (ext === "json") {
          const data = JSON.parse(text);
          let tables: Array<{ name: string; columns: Array<{ name: string; type?: string }> }> = [];
          const norm = (t: { name?: string; columns?: unknown[] }) => ({
            name: t?.name ?? "table",
            columns: (t?.columns ?? []).map((c: any) =>
              typeof c === "string" ? { name: c } : { name: String(c?.name ?? "col"), type: c?.type }
            ).filter((c: any) => c.name?.trim()),
          });
          if (Array.isArray(data)) {
            tables = data.map(norm).filter((t: any) => t.columns.length > 0);
          } else if (Array.isArray(data.tables)) {
            tables = data.tables.map(norm).filter((t: any) => t.columns.length > 0);
          } else if (data.table) {
            const t = data.table;
            const cols = (t?.columns ?? []).map((c: any) =>
              typeof c === "string" ? { name: c } : { name: String(c?.name ?? "col") }
            ).filter((c: any) => c.name?.trim());
            if (cols.length > 0) tables = [{ name: t?.name ?? "table", columns: cols }];
          } else if (data.columns) {
            const cols = (Array.isArray(data.columns) ? data.columns : []).map((c: any) =>
              typeof c === "string" ? { name: c } : { name: String(c?.name ?? "col") }
            ).filter((c: any) => c.name?.trim());
            if (cols.length > 0) tables = [{ name: data.name ?? "uploaded", columns: cols }];
          }
          if (!tables.length) {
            toast({ title: "No tables found", description: "JSON format invalid", variant: "destructive" });
            return;
          }
          setUploadedSchema({ tables });
        } else if (ext === "csv" || ext === "docx") {
          // Robust parsing for Word/CSV text
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length === 0) {
            toast({ title: "Empty file", description: "The file has no text data", variant: "destructive" });
            return;
          }

          const parseCsvLine = (line: string) => {
            const row: string[] = [];
            let curr = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                if (inQuotes && line[i + 1] === '"') { curr += '"'; i++; }
                else { inQuotes = !inQuotes; }
              } else if (char === "," && !inQuotes) {
                row.push(curr.trim());
                curr = "";
              } else { curr += char; }
            }
            row.push(curr.trim());
            return row;
          };

          const firstRow = parseCsvLine(lines[0]);
          const tableIdx = firstRow.findIndex(h => h.toLowerCase() === "table" || h.toLowerCase() === "entity");
          const columnIdx = firstRow.findIndex(h => h.toLowerCase() === "column" || h.toLowerCase() === "field" || h.toLowerCase() === "attribute");

          if (tableIdx !== -1 && columnIdx !== -1 && lines.length > 1) {
            const tableMap = new Map<string, Set<string>>();
            lines.slice(1).forEach(line => {
              const row = parseCsvLine(line);
              const tName = row[tableIdx]?.trim();
              const cName = row[columnIdx]?.trim();
              if (tName && cName) {
                if (!tableMap.has(tName)) tableMap.set(tName, new Set());
                tableMap.get(tName)!.add(cName);
              }
            });
            const tables = Array.from(tableMap.entries()).map(([name, cols]) => ({
              name,
              columns: Array.from(cols).map(c => ({ name: c }))
            }));
            if (tables.length > 0) {
              setUploadedSchema({ tables });
              return;
            }
          }

          // Fallback: list of columns
          const headers = (firstRow.length > 1) ? firstRow.filter(Boolean) : lines.filter(Boolean);
          if (headers.length > 0) {
            const fileName = file.name.replace(/\.[^/.]+$/, "") || "uploaded";
            setUploadedSchema({
              tables: [{ name: fileName, columns: headers.map((name) => ({ name })) }],
            });
          } else {
            toast({ title: "Detection failed", description: "Could not identify columns", variant: "destructive" });
          }
        } else if (ext === "xlsx") {
          const workbook = XLSX.read(buffer, { type: "array" });
          const tablesToSet: Array<{ name: string; columns: Array<{ name: string }> }> = [];

          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
            
            if (data.length > 0) {
              const firstRow = Array.isArray(data[0]) ? data[0] : [];
              const headers = firstRow.map((h, i) => {
                const s = String(h ?? "").trim();
                return s || `Column_${i + 1}`;
              });
              
              if (headers.length > 0) {
                const tableIdx = headers.findIndex((h) => h.toLowerCase() === "table" || h.toLowerCase() === "entity");
                const columnIdx = headers.findIndex((h) => h.toLowerCase() === "column" || h.toLowerCase() === "field" || h.toLowerCase() === "attribute");

                if (tableIdx !== -1 && columnIdx !== -1 && data.length > 1) {
                  const tableMap = new Map<string, Set<string>>();
                  for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (Array.isArray(row)) {
                      const tName = row[tableIdx]?.toString().trim();
                      const cName = row[columnIdx]?.toString().trim();
                      if (tName && cName) {
                        if (!tableMap.has(tName)) tableMap.set(tName, new Set());
                        tableMap.get(tName)!.add(cName);
                      }
                    }
                  }
                  Array.from(tableMap.entries()).forEach(([name, cols]) => {
                    tablesToSet.push({ name, columns: Array.from(cols).map(c => ({ name: c })) });
                  });
                } else {
                  tablesToSet.push({
                    name: sheetName,
                    columns: headers.map((name) => ({ name }))
                  });
                }
              }
            }
          });

          if (tablesToSet.length > 0) {
            setUploadedSchema({ tables: tablesToSet });
          } else {
            toast({ title: "No tables found", description: "Excel file has invalid format", variant: "destructive" });
          }
        } else if (ext === "sql") {
          const cleanSql = preprocessSqlForSchemaParse(text);
          const fromDdl = parseSqlCreateTablesScript(cleanSql);
          const fromInsert = parseSqlInsertColumnLists(cleanSql);
          const parsedTables =
            fromDdl.length > 0 ? mergeParsedSqlTables(fromDdl, fromInsert) : fromInsert;
          if (parsedTables.length > 0) {
            setUploadedSchema({ tables: parsedTables });
          } else {
            toast({
              title: "No tables found",
              description: "Could not find CREATE TABLE definitions or INSERT … (columns) lists in this SQL file.",
              variant: "destructive",
            });
          }
        } else {
          toast({ title: "Unsupported file", description: "Use .json, .csv, .docx, .xlsx, or .sql", variant: "destructive" });
        }
      } catch (err) {
        console.error("[Schema upload] Parse error:", err);
        toast({ title: "Invalid file", description: "Could not parse schema", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  };

  const handleGenerateFromSchema = async () => {
    if (!uploadedSchema?.tables?.length) {
      toast({ title: "No schema", description: "Upload a JSON, CSV, Excel, or SQL schema first", variant: "destructive" });
      return;
    }

    const effectiveTables = uploadedSchema.tables
      .filter(t => selectedSchemaTables.has(t.name))
      .map(t => {
        const base = t.columns.map(c => c.name);
        const extras = extraColumnsMap.get(t.name) || [];
        const all = [...base, ...extras];
        const selected = selectedSchemaColumns.get(t.name) || new Set();
        return {
          name: t.name,
          columns: all.filter(c => selected.has(c)).map(name => ({ name }))
        };
      })
      .filter(t => t.columns.length > 0);

    if (effectiveTables.length === 0) {
      toast({ title: "No selection", description: "Select at least one table and column to generate", variant: "destructive" });
      return;
    }

    const normalizedCount = Math.min(Math.max(Number(recordCount) || minRecords, minRecords), maxRecords);
    setIsGenerating(true);
    try {
      const requestBody = {
        schema: { tables: effectiveTables },
        recordCount: normalizedCount,
        columnsToPrefix: Object.fromEntries(schemaPrefixMappings.filter(m => m.column.trim() && m.prefix.trim()).map(m => [m.column.trim(), m.prefix.trim()])),
        enableMasking,
        columnsToMask: enableMasking ? Array.from(manualMaskingColumns).filter(k => !k.startsWith("preset.")) : undefined,
        useAi: enableAiGeneration,
      };
      const data = await startAndPollSyntheticGenJob(
        "/api/testing/generate-test-data-from-schema/start",
        requestBody,
      ) as {
        records?: TestDataRecord[];
        related?: Record<string, TestDataRecord[]>;
        recordsByTable?: Record<string, TestDataRecord[]>;
        obfuscationMap?: SchemaObfuscationMapRow[];
        syntheticGeneration?: { mode?: string; aiRequested?: boolean; llmConfigured?: boolean };
      };
      const map = Array.isArray(data.obfuscationMap) ? data.obfuscationMap : [];
      setObfuscationMap(map);
      const byTable = data.recordsByTable;
      if (byTable && typeof byTable === "object" && map.length > 0) {
        const tableNames = map.map((t) => t.obfuscatedName);
        const first = tableNames[0];
        const mainRecords = Array.isArray(byTable[first]) ? byTable[first] : [];
        const related: Record<string, TestDataRecord[]> = {};
        tableNames.slice(1).forEach((name: string) => {
          const arr = byTable[name];
          if (Array.isArray(arr)) related[name] = arr as TestDataRecord[];
        });
        setRecords(mainRecords as TestDataRecord[]);
        setRelatedData(related);
      } else {
        setRecords(Array.isArray(data.records) ? data.records : []);
        setRelatedData(data.related ?? {});
      }
      const sg = data.syntheticGeneration;
      const schemaSourceNote =
        sg?.mode === "llm"
          ? " Source: AI model."
          : sg?.aiRequested && !sg?.llmConfigured
            ? " Source: rule-based (no chat LLM on server)."
            : sg?.aiRequested && sg?.llmConfigured
              ? " Source: rule-based (AI response was unusable — check server logs)."
              : " Source: rule-based.";
      toast({
        title: "Data generated from schema",
        description: `Generated ${normalizedCount} records.${schemaSourceNote} PII masked where configured.`,
      });
    } catch (e) {
      console.error("[Generate from schema] Error:", e);
      toast({
        title: "Generation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const relatedEntries = Object.entries(relatedData).filter(
    ([_, arr]) => Array.isArray(arr) && arr.length > 0
  );
  const hasRelatedData = relatedEntries.length > 0;
  const canUseDependencies = true;
  const tokenEst = limitsConfig?.tokenEstimate ?? FALLBACK_TOKEN_ESTIMATE;
  const estimatedTokens = useMemo(() => {
    if (!enableAiGeneration) return 0;
    const { inputPerBatch, outputPerRecordMain, outputPerRecordRoot, batchSize } = tokenEst;

    // In schema mode, we generate 'recordCount' for EACH active table.
    const tableFactor = dataSource === "schema" ? previewSchemaTables.length : 1;
    const effectiveTotalRecords = recordCount * tableFactor;

    const mainBatches = Math.ceil(effectiveTotalRecords / batchSize);
    const mainInput = mainBatches * inputPerBatch;
    const mainOutput = effectiveTotalRecords * outputPerRecordMain;

    let total = mainInput + mainOutput;

    // Dependencies usually only apply to the main entity in preset mode
    if (dataSource === "preset" && includeDependencies) {
      const rootCount = Math.min(maxRecords, Math.max(recordCount, 50));
      const rootBatches = Math.ceil(rootCount / batchSize);
      total += rootBatches * inputPerBatch + rootCount * outputPerRecordRoot;
    }

    return Math.round(total);
  }, [enableAiGeneration, recordCount, includeDependencies, tokenEst, maxRecords, dataSource, previewSchemaTables.length]);

  const availablePrefixColumns = useMemo(() => {
    if (dataSource === "preset") {
      return availableFields;
    } else {
      if (!uploadedSchema?.tables) return [];
      const cols = new Set<string>();
      uploadedSchema.tables.forEach(t => {
        t.columns.forEach(c => cols.add(c.name));
        (extraColumnsMap.get(t.name) || []).forEach(c => cols.add(c));
      });
      return Array.from(cols);
    }
  }, [dataSource, availableFields, uploadedSchema, extraColumnsMap]);

  return (
    <div className="space-y-6 pt-6">
      <div className="rounded-xl border bg-card/60 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Domain:</span>
          <Badge variant="secondary" className="gap-1">
            <Database className="h-3.5 w-3.5" />
            {domainConfig.label}
          </Badge>
        </div>
        <div className="mt-4 space-y-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Data source
          </span>
          <Tabs
            value={dataSource}
            onValueChange={(v) => {
              if (v === "preset") {
                setDataSource("preset");
                setUploadedSchema(null);
                setObfuscationMap([]);
              } else if (v === "schema") {
                setDataSource("schema");
                setRecords([]);
                setRelatedData({});
                setObfuscationMap([]);
              }
            }}
          >
            <TabsList className="flex h-auto w-full max-w-lg items-stretch gap-0 rounded-none border border-border/80 bg-muted/30 p-0 shadow-none">
              <TabsTrigger
                value="preset"
                className="flex-1 gap-2 rounded-none border-0 border-b-2 border-transparent border-r border-border/60 bg-transparent py-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:border-b-primary data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Sparkles className="h-4 w-4 shrink-0 opacity-80" />
                Preset (entity)
              </TabsTrigger>
              <TabsTrigger
                value="schema"
                className="flex-1 gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent py-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:border-b-primary data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Upload className="h-4 w-4 shrink-0 opacity-80" />
                Upload my schema
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {dataSource === "preset" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-sm">Entity:</span>
            {entitiesLoading ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Suggesting entities for {domainConfig.label}…
              </span>
            ) : entitiesError ? (
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <span>{entitiesError}</span>
                <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={fetchEntities}>
                  Retry
                </Button>
              </span>
            ) : (
              entities.map((entity) => {
                const isActive = entity.id === selectedEntity?.id;
                return (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => setSelectedEntityId(entity.id)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${isActive
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                      }`}
                  >
                    {entity.label}
                  </button>
                );
              })
            )}
          </div>
        )}
        {dataSource === "schema" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="schema-file-input"
                type="file"
                accept=".json,.csv,.docx,.xlsx,.sql"
                onChange={handleSchemaFile}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("schema-file-input")?.click()}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Choose schema file
              </Button>
            </div>
            {uploadedSchema && (() => {
              const activeTable = activeSchemaTable
                ? uploadedSchema.tables.find((t) => t.name === activeSchemaTable)
                : undefined;
              const isTableSelected = activeTable ? selectedSchemaTables.has(activeTable.name) : false;
              const baseCols = activeTable?.columns.map((c) => c.name) ?? [];
              const extras = activeTable ? extraColumnsMap.get(activeTable.name) || [] : [];
              const allCols = [...baseCols, ...extras];
              const selectedCols = activeTable
                ? selectedSchemaColumns.get(activeTable.name) || new Set()
                : new Set<string>();

              return (
                <div className="space-y-6">
                  <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <Database className="h-3.5 w-3.5 text-primary" />
                      Schema Overview
                    </div>
                    <div className="grid gap-2.5 max-h-[min(480px,55vh)] overflow-y-auto pr-2 scrollbar-thin">
                      {uploadedSchema.tables.map((t, idx) => (
                        <div key={idx} className="text-[11px] leading-relaxed flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                          <span className="font-bold text-foreground whitespace-nowrap sm:min-w-[120px] shrink-0">
                            {t.name}
                            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                              ({t.columns.length})
                            </span>
                          </span>
                          <span className="hidden sm:inline text-muted-foreground shrink-0">—</span>
                          <span className="text-muted-foreground italic font-normal break-words min-w-0">
                            {t.columns.map((c) => c.name).join(", ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="text-sm font-semibold">
                      Schema configuration
                    </div>

                    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6">
                      <div className="flex w-full shrink-0 flex-col gap-2 rounded-xl border bg-card/50 p-4 lg:w-[min(100%,320px)] lg:self-start">
                        <div className="text-xs font-medium text-muted-foreground">
                          Tables
                        </div>
                        <p className="text-[10px] leading-snug text-muted-foreground">
                          Open the list to include tables or choose one to configure columns.
                        </p>
                        <Popover open={schemaTablesPopoverOpen} onOpenChange={setSchemaTablesPopoverOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              id="schema-tables-dropdown"
                              aria-haspopup="listbox"
                              aria-expanded={schemaTablesPopoverOpen}
                              className={cn(
                                "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-xs ring-offset-background",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                "hover:bg-muted/40"
                              )}
                            >
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate font-mono",
                                  activeSchemaTable ? "text-foreground" : "text-muted-foreground"
                                )}
                              >
                                {activeSchemaTable || "Select a table…"}
                              </span>
                              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            sideOffset={6}
                            className="p-0 min-w-[260px] w-[min(calc(100vw-2rem),320px)] max-w-[320px]"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <div className="border-b border-border/70 px-2 py-1.5">
                              <button
                                type="button"
                                className="w-full text-center text-[10px] font-semibold uppercase tracking-wide text-primary hover:underline"
                                onClick={() => {
                                  const total = uploadedSchema.tables.length;
                                  const allOn =
                                    total > 0 && selectedSchemaTables.size === total;
                                  if (allOn) {
                                    setSelectedSchemaTables(new Set());
                                  } else {
                                    setSelectedSchemaTables(
                                      new Set(uploadedSchema.tables.map((x) => x.name))
                                    );
                                  }
                                }}
                              >
                                {uploadedSchema.tables.length > 0 &&
                                selectedSchemaTables.size === uploadedSchema.tables.length
                                  ? "Deselect all"
                                  : "Select all"}
                              </button>
                            </div>
                            <div
                              role="listbox"
                              aria-label="Schema tables"
                              className="max-h-[min(280px,40vh)] overflow-y-auto p-0.5 scrollbar-thin"
                            >
                              {uploadedSchema.tables.map((t) => {
                                const rowIncluded = selectedSchemaTables.has(t.name);
                                const rowActive = activeSchemaTable === t.name;
                                return (
                                  <button
                                    key={t.name}
                                    type="button"
                                    role="option"
                                    aria-selected={rowActive}
                                    aria-pressed={rowIncluded}
                                    aria-label={`${rowIncluded ? "Remove" : "Include"} table ${t.name} in generation. ${rowActive ? "Currently selected for column configuration." : ""}`}
                                    className={cn(
                                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                                      rowActive
                                        ? "bg-primary/10 ring-1 ring-primary/25"
                                        : "hover:bg-muted/60"
                                    )}
                                    onClick={() => {
                                      toggleSchemaTable(t.name);
                                      setActiveSchemaTable(t.name);
                                    }}
                                  >
                                    <Checkbox
                                      className="h-4 w-4 shrink-0 pointer-events-none"
                                      checked={rowIncluded}
                                      aria-hidden
                                      tabIndex={-1}
                                    />
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1 truncate font-mono text-[11px] leading-tight",
                                        rowActive ? "font-medium text-foreground" : "text-foreground/90"
                                      )}
                                    >
                                      {t.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>

                        <div className="mt-3 flex min-h-[160px] flex-col border-t border-border/60 pt-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Selection summary
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1 mb-2 leading-snug">
                            Tables and columns included for generation (updates as you change selections).
                          </p>
                          {selectedSchemaTables.size === 0 ? (
                            <div className="flex flex-1 items-center rounded-md border border-dashed border-border/80 bg-muted/15 px-2 py-4 text-center text-[10px] text-muted-foreground">
                              No tables included yet. Open the list above and check tables to include them.
                            </div>
                          ) : (
                            <div className="max-h-[min(340px,45vh)] flex-1 space-y-2 overflow-y-auto pr-0.5 scrollbar-thin">
                              {uploadedSchema.tables
                                .filter((tb) => selectedSchemaTables.has(tb.name))
                                .map((tb) => {
                                  const baseNames = tb.columns.map((c) => c.name);
                                  const extras = extraColumnsMap.get(tb.name) || [];
                                  const allPossible = [...baseNames, ...extras];
                                  const sel = selectedSchemaColumns.get(tb.name) || new Set<string>();
                                  const cols = allPossible.filter((c) => sel.has(c));
                                  const isActive = activeSchemaTable === tb.name;
                                  return (
                                    <div
                                      key={tb.name}
                                      className={cn(
                                        "rounded-md border px-2 py-2 text-[10px] leading-snug",
                                        isActive
                                          ? "border-primary/35 bg-primary/8"
                                          : "border-border/70 bg-muted/25"
                                      )}
                                    >
                                      <div className="mb-1 flex items-baseline justify-between gap-1">
                                        <span
                                          className="truncate font-mono text-[11px] font-semibold text-foreground"
                                          title={tb.name}
                                        >
                                          {tb.name}
                                        </span>
                                        {isActive && (
                                          <span className="shrink-0 text-[9px] font-medium text-primary">Editing</span>
                                        )}
                                      </div>
                                      {cols.length === 0 ? (
                                        <p className="italic text-muted-foreground">No columns selected</p>
                                      ) : (
                                        <p className="break-words text-muted-foreground">{cols.join(", ")}</p>
                                      )}
                                      <p className="mt-1 tabular-nums text-[9px] text-muted-foreground">
                                        {cols.length} column{cols.length === 1 ? "" : "s"}
                                      </p>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        {!activeTable ? (
                          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center">
                            <Database className="h-10 w-10 text-muted-foreground/50 mb-3" />
                            <p className="text-sm font-medium text-foreground">Choose a table</p>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                              Open the Tables dropdown and select a table. Its columns and mask options will appear here.
                            </p>
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl border bg-background/50 p-0 overflow-hidden ${isTableSelected ? "border-primary/40" : "border-border opacity-90"}`}
                          >
                            <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2 min-w-0">
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">Columns — {activeTable.name}</span>
                              </h4>
                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground cursor-pointer">
                                  <Checkbox
                                    className="h-3 w-3"
                                    checked={allCols.length > 0 && selectedCols.size === allCols.length}
                                    disabled={!isTableSelected}
                                    onCheckedChange={(val) => {
                                      setSelectedSchemaColumns((prev) => {
                                        const next = new Map(prev);
                                        if (val) next.set(activeTable.name, new Set(allCols));
                                        else next.set(activeTable.name, new Set());
                                        return next;
                                      });
                                    }}
                                  />
                                  Include all columns
                                </label>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {selectedCols.size}/{allCols.length} selected
                                </span>
                              </div>
                            </div>

                            <div className="hidden sm:grid sm:grid-cols-[1fr_auto_auto] sm:gap-3 sm:items-center px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/40 bg-muted/20">
                              <span>Column</span>
                              <span className="text-center w-16">Include</span>
                              <span className="text-right w-24 pr-1">Mask</span>
                            </div>

                            <div className="max-h-[min(360px,50vh)] overflow-y-auto px-2 py-2 sm:px-4 sm:py-3 scrollbar-thin">
                              <div className="space-y-1.5">
                                {allCols.map((col) => {
                                  const isSelected = selectedCols.has(col);
                                  const isMasked = manualMaskingColumns.has(`${activeTable.name}.${col}`);
                                  const dimmed = !isTableSelected || !isSelected;
                                  const toggleInclude = () => {
                                    if (!isTableSelected) return;
                                    toggleSchemaColumn(activeTable.name, col);
                                  };
                                  return (
                                    <div
                                      key={col}
                                      className={`grid grid-cols-1 gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-2.5 text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-3 ${dimmed ? "opacity-40" : ""}`}
                                    >
                                      <button
                                        type="button"
                                        disabled={!isTableSelected}
                                        onClick={toggleInclude}
                                        className="truncate text-left font-medium text-foreground/90 pr-1 rounded-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background min-w-0 disabled:opacity-50"
                                        title={col}
                                      >
                                        {col}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!isTableSelected}
                                        onClick={toggleInclude}
                                        className="flex items-center justify-between gap-3 sm:justify-center sm:w-16 rounded-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                        aria-label={isSelected ? `Deselect column ${col}` : `Select column ${col}`}
                                      >
                                        <span className="text-[10px] font-semibold text-muted-foreground uppercase sm:hidden">
                                          Include
                                        </span>
                                        <Checkbox
                                          className="h-4 w-4 pointer-events-none"
                                          checked={isSelected}
                                          tabIndex={-1}
                                          aria-hidden
                                        />
                                      </button>
                                      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 sm:border-0 sm:pt-0 sm:justify-end sm:w-24">
                                        <span className="text-[10px] font-semibold text-muted-foreground uppercase sm:hidden">
                                          Mask
                                        </span>
                                        <Switch
                                          checked={isMasked}
                                          disabled={!isTableSelected || !isSelected}
                                          onCheckedChange={() => toggleManualMasking(activeTable.name, col)}
                                          className="h-3.5 w-7 shrink-0 data-[state=checked]:bg-primary"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center">
                              <Input
                                value={newColNames[activeTable.name] || ""}
                                onChange={(e) => setNewColNames((prev) => ({ ...prev, [activeTable.name]: e.target.value }))}
                                placeholder="Add custom column name…"
                                className="h-9 text-xs flex-1 bg-background"
                                disabled={!isTableSelected}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddExtraColumn(activeTable.name);
                                  }
                                }}
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-9 shrink-0 text-xs"
                                disabled={!isTableSelected}
                                onClick={() => handleAddExtraColumn(activeTable.name)}
                              >
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Add column
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
      <div className="grid gap-4 grid-cols-1">
        {dataSource === "preset" && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={fieldSelectionCount === availableFields.length}
                    onCheckedChange={(value) => handleToggleAll(value === true)}
                  />
                  Select All ({fieldSelectionCount}/{availableFields.length})
                </label>
              </div>
              <div className="mt-4 rounded-lg border bg-muted/40 p-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={enableAiGeneration}
                  onCheckedChange={(value) => setEnableAiGeneration(value === true)}
                />
                <div>
                  <div className="font-medium text-foreground flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    AI-Powered Generation
                  </div>
                  Use Claude AI for intelligent, context-aware data generation.
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Input
                  value={customFieldName}
                  onChange={(event) => setCustomFieldName(event.target.value)}
                  placeholder="Enter field name (e.g., Customer_Loyalty_Tier)"
                  className="h-8 text-xs flex-1 min-w-[220px]"
                />
                <Button size="sm" variant="secondary" onClick={handleAddCustomField}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {availableFields.map((field) => {
                  const checked = selectedFields.includes(field);
                  return (
                    <label
                      key={field}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => handleToggleField(field)} />
                      <span className="flex-1 truncate">{field}</span>
                      <div className={`flex items-center gap-1.5 py-0.5 px-1 rounded-md transition-colors ${checked ? 'hover:bg-muted/50 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                        <span className="text-[9px] font-bold uppercase text-muted-foreground/60">Mask</span>
                        <Switch
                          checked={checked && manualMaskingColumns.has(`preset.${field}`)}
                          onCheckedChange={(val) => {
                            if (checked) {
                              toggleManualMasking("preset", field);
                            }
                          }}
                          disabled={!checked}
                          className="h-3.5 w-7 scale-75"
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card/60 p-4 space-y-4">
            <div className="text-sm font-semibold">Configuration</div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div className="space-y-1.5 flex-none w-[140px]">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pl-0.5">Records</label>
                <Input
                  type="number"
                  min={minRecords}
                  max={maxRecords}
                  value={recordCount}
                  onChange={(event) =>
                    setRecordCount(Number(event.target.value) || minRecords)
                  }
                  className="h-9 text-xs bg-background/50"
                />
              </div>
              <div className="space-y-1.5 flex-none w-[160px]">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pl-0.5">Custom Prefixes</label>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full justify-between px-3 text-xs bg-background/50 border-dashed hover:border-primary/50 hover:bg-primary/5 transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span>Prefixes</span>
                      </div>
                      {(dataSource === "preset" ? presetPrefixMappings : schemaPrefixMappings).filter(m => m.column && m.prefix).length > 0 && (
                        <Badge variant="secondary" className="h-4.5 px-1.5 text-[9px] bg-primary/10 text-primary border-primary/20 font-bold">
                          {(dataSource === "preset" ? presetPrefixMappings : schemaPrefixMappings).filter(m => m.column && m.prefix).length}
                        </Badge>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md bg-card border-border shadow-2xl p-0 overflow-hidden">
                    <DialogHeader className="p-6 pb-0">
                      <DialogTitle className="flex items-center gap-2 text-lg">
                        <Link2 className="h-5 w-5 text-primary" />
                        {dataSource === "preset" ? "Preset" : "Schema"} Prefix Settings
                      </DialogTitle>
                      <DialogDescription className="text-xs text-muted-foreground mt-1">
                        Map unique prefixes to specific columns for {dataSource === "preset" ? "this entity" : "uploaded schema"}.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="p-6 space-y-4">
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                        {(dataSource === "preset" ? presetPrefixMappings : schemaPrefixMappings).map((pm, i) => (
                          <div key={i} className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border border-border/50 transition-all hover:border-border">
                            <Select
                              value={pm.column}
                              onValueChange={(val) => {
                                if (dataSource === "preset") {
                                  const newMap = [...presetPrefixMappings];
                                  newMap[i].column = val;
                                  setPresetPrefixMappings(newMap);
                                } else {
                                  const newMap = [...schemaPrefixMappings];
                                  newMap[i].column = val;
                                  setSchemaPrefixMappings(newMap);
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background flex-1">
                                <SelectValue placeholder="Select column..." />
                              </SelectTrigger>
                              <SelectContent>
                                {availablePrefixColumns.map(c => (
                                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              placeholder="Prefix"
                              value={pm.prefix}
                              onChange={(e) => {
                                if (dataSource === "preset") {
                                  const newMap = [...presetPrefixMappings];
                                  newMap[i].prefix = e.target.value;
                                  setPresetPrefixMappings(newMap);
                                } else {
                                  const newMap = [...schemaPrefixMappings];
                                  newMap[i].prefix = e.target.value;
                                  setSchemaPrefixMappings(newMap);
                                }
                              }}
                              className="h-8 text-xs bg-background w-[110px]"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                              onClick={() => {
                                if (dataSource === "preset") {
                                  setPresetPrefixMappings(presetPrefixMappings.filter((_, idx) => idx !== i));
                                } else {
                                  setSchemaPrefixMappings(schemaPrefixMappings.filter((_, idx) => idx !== i));
                                }
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {(dataSource === "preset" ? presetPrefixMappings : schemaPrefixMappings).length === 0 && (
                          <div className="text-center py-8 border-2 border-dashed border-border rounded-xl">
                            <p className="text-xs text-muted-foreground">No prefixes configured yet.</p>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="mt-2 text-[10px] h-7 hover:bg-primary/5 hover:text-primary"
                              onClick={() => {
                                if (dataSource === "preset") setPresetPrefixMappings([...presetPrefixMappings, { column: "", prefix: "" }]);
                                else setSchemaPrefixMappings([...schemaPrefixMappings, { column: "", prefix: "" }]);
                              }}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Add your first prefix
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <DialogFooter className="bg-muted/30 p-4 border-t border-border flex items-center justify-between sm:justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (dataSource === "preset") setPresetPrefixMappings([...presetPrefixMappings, { column: "", prefix: "" }]);
                          else setSchemaPrefixMappings([...schemaPrefixMappings, { column: "", prefix: "" }]);
                        }}
                        className="text-xs h-8"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add Mapping
                      </Button>
                      <DialogTrigger asChild>
                        <Button size="sm" className="text-xs h-8 px-6">Done</Button>
                      </DialogTrigger>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              {dataSource === "schema" && (
                <div className="space-y-1.5 flex-none">
                  <div className="h-[17px]" />
                  <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-border/50 bg-background/30 text-xs text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={enableAiGeneration}
                      onCheckedChange={(value) => setEnableAiGeneration(value === true)}
                    />
                    Use AI
                  </label>
                </div>
              )}
              <div className="flex-none w-[200px]">
                <Button
                  size="sm"
                  className="w-full h-9 shadow-sm"
                  onClick={dataSource === "schema" ? handleGenerateFromSchema : handleGenerate}
                  disabled={isGenerating || (dataSource === "schema" && !uploadedSchema?.tables?.length) || (dataSource === "preset" && selectedFields.length === 0)}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4 mr-2" />
                      {dataSource === "schema" ? "Generate Data" : "Generate Data"}
                    </>
                  )}
                </Button>
              </div>
              <div className="space-y-1.5 flex-none shrink-0 min-w-[270px]">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pl-0.5">Format</label>
                <div className="flex gap-2 items-center min-w-0">
                  <Select
                    value={downloadFormat}
                    onValueChange={(v) => setDownloadFormat(v as "json" | "csv" | "sql")}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1 min-w-[120px] whitespace-nowrap [&>span]:line-clamp-none [&>span]:whitespace-nowrap [&>span]:inline-flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json" className="text-xs">
                        <span className="flex items-center gap-2">
                          <FileJson className="h-3.5 w-3.5" />
                          JSON (ZIP)
                        </span>
                      </SelectItem>
                      <SelectItem value="csv" className="text-xs">
                        <span className="flex items-center gap-2">
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          CSV (ZIP)
                        </span>
                      </SelectItem>
                      <SelectItem value="sql" className="text-xs">
                        <span className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5" />
                          SQL (ZIP)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!hasData}
                    onClick={handleDownloadClick}
                    className="h-8 shrink-0"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-card/60 p-4 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide pr-4 border-r border-border min-w-[120px]">
              Selection Summary
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Domain:</span>
              <span className="font-medium">{domainConfig.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Entity:</span>
              <span className="font-medium text-foreground">
                {dataSource === "schema"
                  ? (previewSchemaTables.length === 1 ? previewSchemaTables[0].name : "Multiple Tables")
                  : (selectedEntity?.label || "-")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Fields:</span>
              <span className="font-semibold text-primary">{fieldSelectionCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Records:</span>
              <span className="font-medium">{records.length || recordCount}</span>
            </div>
            {enableAiGeneration && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Est. tokens:</span>
                <span className="font-medium">
                  ~{estimatedTokens.toLocaleString()}
                </span>
              </div>
            )}
            <div className="text-muted-foreground ml-auto">
              {hasData
                ? "Ready for download."
                : "No data generated."}
            </div>
          </div>
        </div>
      </div>
      {hasData && (
        <div className="rounded-xl border bg-card/60 p-4 space-y-3">
          <div className="text-sm font-semibold">Preview</div>
          {sheets.length > 1 && (
            <div className="flex gap-0 border-b border-border overflow-x-auto overflow-y-hidden">
              {sheets.map((sheet) => {
                const isActive = activeSheet === sheet.id;
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    onClick={() => setActiveSheet(sheet.id)}
                    className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition ${isActive
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                  >
                    {sheet.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-end">
            <span className="text-xs text-muted-foreground">
              {activeSheetData.rows.length} rows × {activeSheetData.columns.length} columns
            </span>
          </div>
          <div className="rounded-lg border bg-muted/20 overflow-hidden">
            <div className="overflow-auto max-h-[560px]">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {activeSheetData.columns.map((column) => (
                      <th
                        key={column}
                        className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheetData.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-border/60">
                      {activeSheetData.columns.map((column) => (
                        <td
                          key={`${rowIndex}-${column}`}
                          className="px-3 py-2 text-foreground whitespace-nowrap"
                        >
                          {formatPreviewValue(row?.[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function convertToCsv(records: TestDataRecord[], columns: string[]) {
  if (records.length === 0 || columns.length === 0) return "";
  const headerRow = columns.join(",");
  const rows = records.map((record) =>
    columns
      .map((column) => csvEscape(record?.[column]))
      .join(",")
  );
  return [headerRow, ...rows].join("\n");
}

function csvEscape(value: unknown) {
  const text = value === null || typeof value === "undefined" ? "" : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function convertToSql(
  records: TestDataRecord[],
  columns: string[],
  tableName: string
) {
  if (records.length === 0 || columns.length === 0) return "";
  const columnList = columns.map(sanitizeSqlIdentifier).join(", ");
  const values = records
    .map(
      (record) =>
        `(${columns.map((column) => formatSqlValue(record?.[column])).join(", ")})`
    )
    .join(",\n");
  return `INSERT INTO ${tableName} (${columnList}) VALUES\n${values};\n`;
}

function formatSqlValue(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "NULL";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

function sanitizeSqlIdentifier(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function formatPreviewValue(value: unknown) {
  if (value === null || typeof value === "undefined") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}