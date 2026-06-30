/**
 * Prompt Sanitizer
 *
 * Strips / masks patterns in user-provided code that trigger Azure OpenAI's
 * content management filters (Responsible AI policy).
 *
 * Common triggers:
 *   - SRI integrity hashes (long base64 strings)
 *   - Connection strings with embedded passwords
 *   - Bearer / API tokens & secrets
 *   - Anti-forgery / CSRF hidden-field values
 *   - Long hex strings (machine keys, validation keys, decryption keys)
 *   - Long base64 blobs (encoded binary data, certificates)
 *   - Minified JS bundles (opaque strings)
 *   - Binary content read as text (garbled non-printable characters)
 *   - XML encrypted config sections
 *   - .resx embedded binary data
 *
 * The sanitization preserves the *structure* of the code so the LLM still
 * understands what attributes / config keys exist; only the opaque values
 * are replaced with human-readable placeholders.
 */

// ── Regex patterns ──────────────────────────────────────────────────────────

const SRI_HASH_RE =
  /integrity\s*=\s*["'](sha(?:256|384|512)-[A-Za-z0-9+/=]{20,})["']/gi;

const LONG_BASE64_RE =
  /(?<![A-Za-z0-9])([A-Za-z0-9+/]{40,}={0,3})(?![A-Za-z0-9])/g;

const LONG_HEX_RE =
  /(?<![A-Za-z0-9])([0-9A-Fa-f]{40,})(?![A-Za-z0-9])/g;

const CONNECTION_STRING_PASSWORD_RE =
  /((?:Password|Pwd)\s*=\s*)([^;'"\n]{3,})/gi;

const CONNECTION_STRING_SECRET_RE =
  /((?:AccountKey|SharedAccessKey|SharedAccessSignature|Secret|ApiKey|AccessKey)\s*=\s*)([^;'"\n]{3,})/gi;

const BEARER_TOKEN_RE =
  /(Bearer\s+)([A-Za-z0-9._\-+/]{40,})/gi;

const API_KEY_VALUE_RE =
  /((?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[=:]\s*["']?)([A-Za-z0-9._\-+/]{20,})["']?/gi;

const ANTIFORGERY_VALUE_RE =
  /(__RequestVerificationToken[^>]*value\s*=\s*["'])([A-Za-z0-9+/=_\-]{20,})(["'])/gi;

const HIDDEN_TOKEN_INPUT_RE =
  /(<input[^>]*type\s*=\s*["']hidden["'][^>]*value\s*=\s*["'])([A-Za-z0-9+/=_\-]{40,})(["'][^>]*>)/gi;

const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g;

const CERTIFICATE_BLOCK_RE =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const INLINE_MINIFIED_JS_RE =
  /(<script[^>]*>)((?:(?!<\/script>)[\s\S]){2000,})(<\/script>)/gi;

const MACHINE_KEY_RE =
  /(<machineKey[^>]*)((?:validationKey|decryptionKey)\s*=\s*["'])([^"']+)(["'])/gi;

const XML_ENCRYPTED_DATA_RE =
  /<EncryptedData[\s\S]*?<\/EncryptedData>/gi;

const RESX_BINARY_DATA_RE =
  /(<data[^>]*type\s*=\s*["'][^"']*[Bb]inary[^"']*["'][^>]*>[\s\S]*?<value>)([\s\S]*?)(<\/value>)/gi;

const RESX_MIMETYPE_DATA_RE =
  /(<data[^>]*mimetype\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<value>)([\s\S]*?)(<\/value>)/gi;

// Detect binary / garbled content: any line with a high ratio of non-printable characters
const NON_PRINTABLE_RE = /[\x00-\x08\x0E-\x1F\x7F]/;

// ── Public API ──────────────────────────────────────────────────────────────

export type SanitizationLevel = "standard" | "aggressive";

/**
 * Returns true if the content appears to be binary (read as text) rather than
 * human-readable source code. Such content must be stripped entirely because
 * it triggers Azure content filters and is useless for code upgrades anyway.
 */
function isBinaryContent(content: string): boolean {
  if (content.length < 10) return false;
  const sample = content.slice(0, 2000);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) || code === 0x7F) {
      nonPrintable++;
    }
  }
  return (nonPrintable / sample.length) > 0.05;
}

/**
 * Sanitize code content to prevent Azure OpenAI content filter rejections.
 *
 * `standard`   – replaces known trigger patterns (SRI hashes, secrets,
 *                connection strings, tokens, hex keys, encrypted blocks)
 *                while preserving code structure.
 * `aggressive` – all of the above PLUS strips long base64/hex blobs,
 *                inline minified JS, private keys, certificates, and
 *                any remaining non-printable sequences.
 */
export function sanitizeForContentFilter(
  content: string,
  level: SanitizationLevel = "standard",
): string {
  // Fast path: empty or binary content
  if (!content) return content;
  if (isBinaryContent(content)) {
    return "[BINARY-CONTENT-REMOVED — file contained non-text data]";
  }

  let result = content;

  // SRI hashes → placeholder (these are the #1 trigger)
  result = result.replace(
    SRI_HASH_RE,
    'integrity="[SRI-HASH-REMOVED]"',
  );

  // Machine keys (validationKey, decryptionKey — long hex in web.config)
  result = result.replace(
    MACHINE_KEY_RE,
    "$1$2[KEY-REDACTED]$4",
  );

  // XML encrypted config sections
  result = result.replace(
    XML_ENCRYPTED_DATA_RE,
    "<!-- [ENCRYPTED-CONFIG-SECTION-REMOVED] -->",
  );

  // .resx binary data values
  result = result.replace(RESX_BINARY_DATA_RE, "$1[BINARY-DATA-REMOVED]$3");
  result = result.replace(RESX_MIMETYPE_DATA_RE, "$1[ENCODED-DATA-REMOVED]$3");

  // Connection string passwords/secrets
  result = result.replace(
    CONNECTION_STRING_PASSWORD_RE,
    "$1[PASSWORD-REDACTED]",
  );
  result = result.replace(
    CONNECTION_STRING_SECRET_RE,
    "$1[SECRET-REDACTED]",
  );

  // Bearer tokens
  result = result.replace(BEARER_TOKEN_RE, "$1[TOKEN-REDACTED]");

  // API key values
  result = result.replace(API_KEY_VALUE_RE, "$1[KEY-REDACTED]");

  // Anti-forgery / CSRF token values
  result = result.replace(ANTIFORGERY_VALUE_RE, "$1[ANTIFORGERY-TOKEN]$3");
  result = result.replace(HIDDEN_TOKEN_INPUT_RE, "$1[HIDDEN-VALUE-REDACTED]$3");

  // Private key blocks
  result = result.replace(PRIVATE_KEY_BLOCK_RE, "[PRIVATE-KEY-REMOVED]");

  // Certificate blocks
  result = result.replace(CERTIFICATE_BLOCK_RE, "[CERTIFICATE-REMOVED]");

  // Long hex strings (machine keys, thumbprints, hash values)
  result = result.replace(LONG_HEX_RE, "[HEX-DATA-REDACTED]");

  // Long base64 blobs (always strip these — they're the second most common trigger)
  result = result.replace(LONG_BASE64_RE, "[BASE64-DATA-REMOVED]");

  if (level === "aggressive") {
    // Inline minified JS blocks (obfuscated code triggers heuristic filters)
    result = result.replace(
      INLINE_MINIFIED_JS_RE,
      "$1/* [MINIFIED-JS-REMOVED] */$3",
    );

    // Strip any remaining non-printable characters (belt-and-suspenders)
    result = result.replace(/[\x00-\x08\x0E-\x1F\x7F]/g, "");

    // Strip very long lines (>2000 chars) that are likely minified/encoded data
    result = result.split("\n").map(line =>
      line.length > 2000
        ? line.slice(0, 200) + " /* [LINE-TRUNCATED — " + line.length + " chars] */"
        : line
    ).join("\n");
  }

  return result;
}

/**
 * Sanitize all message contents in an LLM message array.
 * Returns a new array (does not mutate the original).
 */
export function sanitizeMessages(
  messages: Array<{ role: string; content: string }>,
  level: SanitizationLevel = "standard",
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({
    ...m,
    content: sanitizeForContentFilter(m.content, level),
  }));
}

/**
 * Restore sanitized credential/token placeholders from the original content.
 *
 * After the LLM returns modified code, certain redacted values need to be
 * restored so the final output is functional. SRI hashes are intentionally
 * NOT restored — during a CDN version upgrade the old hash is invalid and
 * should be regenerated or removed.
 */
export function restoreSanitizedPlaceholders(
  modified: string,
  original: string,
): string {
  let result = modified;

  function execAll(re: RegExp, text: string): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    const cloned = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = cloned.exec(text)) !== null) matches.push(m);
    return matches;
  }

  // Restore connection-string passwords
  for (const m of execAll(CONNECTION_STRING_PASSWORD_RE, original)) {
    const placeholder = `${m[1]}[PASSWORD-REDACTED]`;
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, m[0]);
    }
  }

  // Restore connection-string secrets (AccountKey, etc.)
  for (const m of execAll(CONNECTION_STRING_SECRET_RE, original)) {
    const placeholder = `${m[1]}[SECRET-REDACTED]`;
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, m[0]);
    }
  }

  // Restore bearer tokens
  for (const m of execAll(BEARER_TOKEN_RE, original)) {
    const placeholder = `${m[1]}[TOKEN-REDACTED]`;
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, m[0]);
    }
  }

  // Restore anti-forgery token values
  for (const m of execAll(ANTIFORGERY_VALUE_RE, original)) {
    const placeholder = `${m[1]}[ANTIFORGERY-TOKEN]${m[3]}`;
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, m[0]);
    }
  }

  // Restore machine keys
  for (const m of execAll(MACHINE_KEY_RE, original)) {
    const placeholder = `${m[1]}${m[2]}[KEY-REDACTED]${m[4]}`;
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, m[0]);
    }
  }

  return result;
}

/**
 * Check whether an error is an Azure OpenAI content filter rejection.
 */
export function isContentFilterError(err: any): boolean {
  if (!err) return false;
  if (err.code === "content_filter") return true;
  if (err.error?.code === "content_filter") return true;
  if (err.status === 400 && err.error?.innererror?.code === "ResponsibleAIPolicyViolation") return true;
  const msg = (err.message || err.error?.message || "").toLowerCase();
  return msg.includes("content management policy") || msg.includes("content_filter");
}
