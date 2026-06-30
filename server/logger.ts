/**
 * Structured server logging — one JSON object per line on stdout/stderr.
 * Set STRUCTURED_LOGS=false to restore native console formatting (e.g. local debugging).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel()];
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Error) {
    return serializeValue(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

function safeStringify(entry: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(entry, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return jsonReplacer(key, value);
  });
}

/** Native console — used for output so patched console does not recurse. */
const nativeConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function emitLine(level: LogLevel, line: string): void {
  switch (level) {
    case "error":
      nativeConsole.error(line);
      break;
    case "warn":
      nativeConsole.warn(line);
      break;
    case "debug":
      nativeConsole.debug(line);
      break;
    default:
      nativeConsole.log(line);
  }
}

export function writeLog(level: LogLevel, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };

  emitLine(level, safeStringify(entry));
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(source: string): Logger {
  const withSource = (fields?: LogFields): LogFields => ({
    source,
    ...fields,
  });

  return {
    debug: (message, fields) => writeLog("debug", message, withSource(fields)),
    info: (message, fields) => writeLog("info", message, withSource(fields)),
    warn: (message, fields) => writeLog("warn", message, withSource(fields)),
    error: (message, fields) => writeLog("error", message, withSource(fields)),
  };
}

/** Default app logger (source: "app"). */
export const logger = createLogger("app");

const BRACKET_SOURCE_RE = /^\[([^\]]+)\]\s*/;

function parseBracketSource(message: string): { source?: string; message: string } {
  const match = message.match(BRACKET_SOURCE_RE);
  if (!match) {
    return { message };
  }
  return {
    source: match[1],
    message: message.slice(match[0].length).trim() || message,
  };
}

function parseConsoleArgs(args: unknown[]): { message: string; fields: LogFields } {
  if (args.length === 0) {
    return { message: "", fields: {} };
  }

  const textParts: string[] = [];
  const objects: unknown[] = [];
  let err: Error | undefined;

  for (const arg of args) {
    if (arg instanceof Error) {
      err = arg;
      textParts.push(arg.message);
    } else if (typeof arg === "string") {
      textParts.push(arg);
    } else if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
      textParts.push(String(arg));
    } else if (arg === null || arg === undefined) {
      textParts.push(String(arg));
    } else {
      objects.push(arg);
    }
  }

  const combined = textParts.join(" ").trim();
  const { source: bracketSource, message: stripped } = parseBracketSource(combined);

  const fields: LogFields = {};
  if (bracketSource) {
    fields.source = bracketSource;
  }
  if (err) {
    fields.error = serializeValue(err);
  }
  if (objects.length === 1 && typeof objects[0] === "object" && objects[0] !== null && !Array.isArray(objects[0])) {
    Object.assign(fields, objects[0] as Record<string, unknown>);
  } else if (objects.length > 0) {
    fields.data = objects.map(serializeValue);
  }

  return {
    message: stripped || combined || "(empty log)",
    fields,
  };
}

function consoleLevel(method: "log" | "info" | "warn" | "error" | "debug"): LogLevel {
  switch (method) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "debug":
      return "debug";
    default:
      return "info";
  }
}

let structuredConsoleInstalled = false;

/** Route all console.* calls through single-line JSON (unless STRUCTURED_LOGS=false). */
export function installStructuredConsole(): void {
  if (structuredConsoleInstalled) {
    return;
  }
  structuredConsoleInstalled = true;

  if (process.env.STRUCTURED_LOGS === "false") {
    return;
  }

  const wrap =
    (method: "log" | "info" | "warn" | "error" | "debug") =>
    (...args: unknown[]) => {
      const level = consoleLevel(method);
      const { message, fields } = parseConsoleArgs(args);
      writeLog(level, message, fields);
    };

  console.log = wrap("log");
  console.info = wrap("info");
  console.warn = wrap("warn");
  console.error = wrap("error");
  console.debug = wrap("debug");
}
