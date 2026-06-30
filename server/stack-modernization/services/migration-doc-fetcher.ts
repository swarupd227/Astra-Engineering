/**
 * Migration Doc Fetcher with Cache
 * Fetches official migration documentation at runtime, extracts breaking changes,
 * and caches locally. Provides version-specific migration guidance for the upgrade pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";

// ── Interfaces ──────────────────────────────────────────────────

export interface CachedMigrationDoc {
  fetchedAt: string;
  url: string;
  breakingChanges: string;
  removedAPIs: string[];
  deprecatedAPIs: string[];
  behaviorChanges: string[];
  ttlHours: number;
}

export interface MigrationDocResult {
  found: boolean;
  source: "cache" | "fetched" | "builtin" | "none";
  breakingChanges: string;
  removedAPIs: string[];
  deprecatedAPIs: string[];
  behaviorChanges: string[];
}

// ── Cache Directory ─────────────────────────────────────────────

// Use os.tmpdir() for cache — guaranteed writable on all deployment targets
// (Azure App Service, Azure Functions, Docker, local dev)
const CACHE_DIR = path.join(os.tmpdir(), "devx-migration-docs-cache");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath(stack: string, fromVersion: string, toVersion: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9.-]/g, "_");
  return path.join(CACHE_DIR, `${safe(stack)}_${safe(fromVersion)}_to_${safe(toVersion)}.json`);
}

function loadFromCache(cachePath: string): CachedMigrationDoc | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CachedMigrationDoc;
    const age = (Date.now() - new Date(data.fetchedAt).getTime()) / (1000 * 60 * 60);
    if (age > (data.ttlHours || 72)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveToCache(cachePath: string, doc: CachedMigrationDoc): void {
  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, JSON.stringify(doc, null, 2), "utf-8");
  } catch (err) {
    console.warn("[MigrationDocFetcher] Failed to save cache:", err instanceof Error ? err.message : err);
  }
}

// ── URL Registry ────────────────────────────────────────────────

interface MigrationDocSource {
  url: string;
  singlePage?: boolean;
}

const MIGRATION_DOC_REGISTRY: Record<string, Record<string, MigrationDocSource>> = {
  "dotnet": {
    "6-to-7": { url: "https://learn.microsoft.com/en-us/dotnet/core/compatibility/7.0" },
    "7-to-8": { url: "https://learn.microsoft.com/en-us/dotnet/core/compatibility/8.0" },
    "8-to-9": { url: "https://learn.microsoft.com/en-us/dotnet/core/compatibility/9.0" },
    "9-to-10": { url: "https://learn.microsoft.com/en-us/dotnet/core/compatibility/10.0" },
  },
  "bootstrap": {
    "3-to-4": { url: "https://getbootstrap.com/docs/4.0/migration/", singlePage: true },
    "4-to-5": { url: "https://getbootstrap.com/docs/5.0/migration/", singlePage: true },
  },
  "jquery": {
    "2-to-3": { url: "https://jquery.com/upgrade-guide/3.0/" },
    "3-to-4": { url: "https://jquery.com/upgrade-guide/4.0/" },
  },
  "spring-boot": {
    "2-to-3": { url: "https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide" },
    "3-to-4": { url: "https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-to-3.1-Migration-Guide" },
  },
  "react": {
    "16-to-17": { url: "https://legacy.reactjs.org/blog/2020/10/20/react-v17.html" },
    "17-to-18": { url: "https://react.dev/blog/2022/03/08/react-18-upgrade-guide" },
    "18-to-19": { url: "https://react.dev/blog/2024/12/05/react-19" },
  },
  "angular": {
    "14-to-15": { url: "https://angular.dev/update-guide" },
    "15-to-16": { url: "https://angular.dev/update-guide" },
    "16-to-17": { url: "https://angular.dev/update-guide" },
    "17-to-18": { url: "https://angular.dev/update-guide" },
    "18-to-19": { url: "https://angular.dev/update-guide" },
  },
  "django": {
    "2-to-3": { url: "https://docs.djangoproject.com/en/3.0/releases/3.0/" },
    "3-to-4": { url: "https://docs.djangoproject.com/en/4.0/releases/4.0/" },
    "4-to-5": { url: "https://docs.djangoproject.com/en/5.0/releases/5.0/" },
  },
  "entity-framework-core": {
    "6-to-7": { url: "https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/breaking-changes" },
    "7-to-8": { url: "https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/breaking-changes" },
    "8-to-9": { url: "https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes" },
  },
  "vue": {
    "2-to-3": { url: "https://v3-migration.vuejs.org/breaking-changes/", singlePage: true },
  },
  "express": {
    "4-to-5": { url: "https://expressjs.com/en/guide/migrating-5.html", singlePage: true },
  },
  "nextjs": {
    "12-to-13": { url: "https://nextjs.org/docs/app/building-your-application/upgrading/version-13" },
    "13-to-14": { url: "https://nextjs.org/docs/app/building-your-application/upgrading/version-14" },
    "14-to-15": { url: "https://nextjs.org/docs/app/building-your-application/upgrading/version-15" },
  },
  "flask": {
    "2-to-3": { url: "https://flask.palletsprojects.com/en/3.0.x/changes/#version-3-0-0" },
  },
  "rails": {
    "6-to-7": { url: "https://guides.rubyonrails.org/upgrading_ruby_on_rails.html" },
    "7-to-8": { url: "https://guides.rubyonrails.org/upgrading_ruby_on_rails.html" },
  },
  "laravel": {
    "9-to-10": { url: "https://laravel.com/docs/10.x/upgrade" },
    "10-to-11": { url: "https://laravel.com/docs/11.x/upgrade" },
  },
  "svelte": {
    "3-to-4": { url: "https://svelte.dev/docs/v4-migration-guide" },
    "4-to-5": { url: "https://svelte.dev/docs/svelte/v5-migration-guide" },
  },
  "typescript": {
    "4-to-5": { url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html" },
  },
  "fastapi": {
    "0-to-1": { url: "https://fastapi.tiangolo.com/release-notes/" },
  },
  "java": {
    "7-to-8": { url: "https://www.oracle.com/java/technologies/javase/8-compatibility-guide.html" },
    "8-to-11": { url: "https://docs.oracle.com/en/java/javase/11/migrate/index.html" },
    "11-to-17": { url: "https://docs.oracle.com/en/java/javase/17/migrate/index.html" },
    "17-to-21": { url: "https://docs.oracle.com/en/java/javase/21/migrate/index.html" },
  },
  "python": {
    "2-to-3": { url: "https://docs.python.org/3/howto/pyporting.html" },
    "9-to-10": { url: "https://docs.python.org/3/whatsnew/3.10.html" },
    "10-to-11": { url: "https://docs.python.org/3/whatsnew/3.11.html" },
    "11-to-12": { url: "https://docs.python.org/3/whatsnew/3.12.html" },
    "12-to-13": { url: "https://docs.python.org/3/whatsnew/3.13.html" },
  },
  "nodejs": {
    "14-to-16": { url: "https://nodejs.org/en/blog/release/v16.0.0" },
    "16-to-18": { url: "https://nodejs.org/en/blog/release/v18.0.0" },
    "18-to-20": { url: "https://nodejs.org/en/blog/release/v20.0.0" },
    "20-to-22": { url: "https://nodejs.org/en/blog/release/v22.0.0" },
  },
  "php": {
    "7-to-8": { url: "https://www.php.net/manual/en/migration80.php" },
    "8-to-81": { url: "https://www.php.net/manual/en/migration81.php" },
    "81-to-82": { url: "https://www.php.net/manual/en/migration82.php" },
    "82-to-83": { url: "https://www.php.net/manual/en/migration83.php" },
  },
  "tailwindcss": {
    "2-to-3": { url: "https://tailwindcss.com/docs/upgrade-guide" },
    "3-to-4": { url: "https://tailwindcss.com/docs/upgrade-guide" },
  },
  "hibernate": {
    "5-to-6": { url: "https://github.com/hibernate/hibernate-orm/blob/6.0/migration-guide.adoc" },
  },
  "nuxt": {
    "2-to-3": { url: "https://nuxt.com/docs/migration/overview" },
  },
  "webpack": {
    "4-to-5": { url: "https://webpack.js.org/migrate/5/" },
  },
};

// ── Built-in Migration Knowledge ────────────────────────────────
// Hardcoded breaking changes for common migrations when docs can't be fetched.

const BUILTIN_MIGRATION_KNOWLEDGE: Record<string, CachedMigrationDoc> = {
  "dotnet_7_to_8": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## .NET 7 to .NET 8 Breaking Changes
- BrowserLink middleware removed (Microsoft.VisualStudio.Web.BrowserLink no longer supported)
- Minimal APIs: Route handler return types validated more strictly
- Blazor: JavaScript interop calls require explicit error handling
- ASP.NET Core: UseRouting/UseEndpoints merged into app.MapControllers()
- EF Core 8: Sentinel values for optional properties changed
- System.Text.Json: Required keyword enforced for deserialization
- HttpClient: Default timeout changed`,
    removedAPIs: [
      "UseBrowserLink()",
      "Microsoft.VisualStudio.Web.BrowserLink",
      "BinaryFormatter (further restricted)",
      "System.Drawing.Common on non-Windows",
    ],
    deprecatedAPIs: [
      "UseRouting() + UseEndpoints() → use MapControllers() directly",
      "AddMvc() → AddControllersWithViews() or AddControllers()",
    ],
    behaviorChanges: [
      "Nullable reference types enabled by default in templates",
      "Trim-compatible APIs enforced for AOT",
      "Default serialization honors required keyword",
    ],
  },
  "dotnet_8_to_9": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## .NET 8 to .NET 9 Breaking Changes
- Blazor: Static SSR by default, interactive modes opt-in
- ASP.NET Core: Middleware pipeline ordering more strict
- EF Core 9: Query splitting default changed
- System.Text.Json: Polymorphic serialization changes`,
    removedAPIs: [],
    deprecatedAPIs: [
      "UseSwaggerUI() configuration changes",
    ],
    behaviorChanges: [
      "Kestrel: HTTP/3 enabled by default",
      "Blazor: Component rendering mode must be explicitly set",
    ],
  },
  "dotnet_7_to_10": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## .NET 7 to .NET 10 Breaking Changes (cumulative 7→8→9→10)
- BrowserLink middleware removed (Microsoft.VisualStudio.Web.BrowserLink)
- System.Drawing.Common restricted to Windows only
- BinaryFormatter completely removed
- UseRouting()/UseEndpoints() merged into MapControllers()
- Minimal APIs: Route handler return types validated more strictly
- EF Core: Sentinel values changed, query splitting default changed
- System.Text.Json: Required keyword enforced, polymorphic serialization changed
- Blazor: Static SSR by default, interactive modes opt-in
- Nullable reference types enabled by default
- HttpClient default timeout changed
- Kestrel: HTTP/3 enabled by default`,
    removedAPIs: [
      "UseBrowserLink()",
      "Microsoft.VisualStudio.Web.BrowserLink",
      "BinaryFormatter",
      "System.Drawing.Common (non-Windows)",
      "WebRequest/WebClient (further deprecated)",
    ],
    deprecatedAPIs: [
      "UseRouting() + UseEndpoints() pattern",
      "AddMvc() → AddControllersWithViews()",
      "UseSwaggerUI() signature changes",
    ],
    behaviorChanges: [
      "Nullable reference types enabled by default",
      "Default serialization honors required keyword",
      "Kestrel HTTP/3 enabled by default",
      "Component rendering mode must be explicitly set in Blazor",
      "AOT compatibility enforced for trimmed apps",
    ],
  },
  "bootstrap_4_to_5": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Bootstrap 4 to 5 Breaking Changes
- jQuery dependency removed (vanilla JS)
- data-* attributes renamed to data-bs-* (data-toggle → data-bs-toggle, data-dismiss → data-bs-dismiss, data-target → data-bs-target, data-ride → data-bs-ride, data-slide → data-bs-slide, data-parent → data-bs-parent)
- .close class → .btn-close
- .left/.right → .start/.end (RTL support)
- .float-left/.float-right → .float-start/.float-end
- .ml-*/.mr-* → .ms-*/.me-* (margin utilities)
- .pl-*/.pr-* → .ps-*/.pe-* (padding utilities)
- .text-left/.text-right → .text-start/.text-end
- .no-gutters → .g-0
- .badge-* → .bg-* + .text-* (badges)
- .jumbotron removed
- .media removed (use utilities instead)
- .form-group removed
- .form-row removed (use .row + .col)
- .custom-select → .form-select
- .custom-file → .form-control type="file"
- .custom-range → .form-range
- .custom-switch → .form-check .form-switch
- .input-group-prepend/.input-group-append removed
- .card-deck removed (use CSS grid)
- jQuery plugin initialization changed to vanilla JS (new bootstrap.Modal(element))`,
    removedAPIs: [
      "data-toggle (use data-bs-toggle)",
      "data-dismiss (use data-bs-dismiss)",
      "data-target (use data-bs-target)",
      "data-ride (use data-bs-ride)",
      "data-slide (use data-bs-slide)",
      "data-slide-to (use data-bs-slide-to)",
      "data-parent (use data-bs-parent)",
      "data-spy (use data-bs-spy)",
      "data-offset (use data-bs-offset)",
      ".jumbotron",
      ".media",
      ".form-group",
      ".form-row",
      ".card-deck",
      ".input-group-prepend",
      ".input-group-append",
      ".custom-select",
      ".custom-file",
      ".custom-range",
      ".custom-switch",
      "jQuery plugin methods ($().modal(), $().tooltip(), etc.)",
    ],
    deprecatedAPIs: [],
    behaviorChanges: [
      "All data attributes require bs prefix",
      "jQuery no longer required (vanilla JS only)",
      "RTL support via .start/.end instead of .left/.right",
      "Utility classes renamed for RTL support",
      "JavaScript plugins initialized via constructors (new bootstrap.Modal())",
      "Dropped IE 10 and 11 support",
    ],
  },
  "jquery_3_to_4": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## jQuery 3.x to 4.0 Breaking Changes
- Dropped IE support
- Removed deprecated .click(), .bind(), .unbind(), .delegate(), .undelegate() shortcuts
- Use .on() and .off() instead
- .ready() shorthand removed (use $(function() { ... }))
- jQuery.isArray() removed (use Array.isArray())
- jQuery.type() removed (use typeof)
- jQuery.isFunction() removed (use typeof x === 'function')
- jQuery.isWindow() removed
- jQuery.parseJSON() removed (use JSON.parse())
- jQuery.unique() renamed to jQuery.uniqueSort()
- $.ajax() transport changes
- Slim build available without ajax and effects`,
    removedAPIs: [
      ".click() shorthand (use .on('click'))",
      ".bind() (use .on())",
      ".unbind() (use .off())",
      ".delegate() (use .on())",
      ".undelegate() (use .off())",
      "jQuery.isArray()",
      "jQuery.type()",
      "jQuery.isFunction()",
      "jQuery.isWindow()",
      "jQuery.parseJSON()",
    ],
    deprecatedAPIs: [],
    behaviorChanges: [
      "Dropped IE support entirely",
      "Stricter selector parsing",
      "Promise A+ compliance",
    ],
  },
  "spring-boot_2_to_3": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Spring Boot 2 to 3 Breaking Changes
- Java 17 minimum required
- Jakarta EE 9+: javax.* → jakarta.* namespace migration
- Spring Security 6.0: SecurityFilterChain required, WebSecurityConfigurerAdapter removed
- Spring MVC: PathPatternParser by default
- Hibernate 6.x: Query changes, type system updated
- @ConstructorBinding location changed (now on constructor, not class)
- spring.factories replaced with META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
- Observability via Micrometer (replaces Spring Cloud Sleuth)`,
    removedAPIs: [
      "javax.* packages (use jakarta.*)",
      "WebSecurityConfigurerAdapter",
      "spring.factories for auto-configuration",
      "Spring Cloud Sleuth (use Micrometer Tracing)",
    ],
    deprecatedAPIs: [
      "@ConstructorBinding on class level",
    ],
    behaviorChanges: [
      "Java 17 minimum",
      "Jakarta EE 9+ namespace (javax → jakarta)",
      "PathPatternParser default for URL matching",
      "Hibernate 6.x type system",
    ],
  },
  "vue_2_to_3": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Vue 2 to 3 Breaking Changes
- new Vue() → createApp()
- Vue.component() → app.component()
- Vue.directive() → app.directive()
- Vue.mixin() → app.mixin()
- Vue.use() → app.use()
- Vue.prototype → app.config.globalProperties
- Vue.set() / Vue.delete() removed (reactive by default)
- $on, $off, $once removed (use mitt or tiny-emitter)
- Filters removed (use methods or computed)
- v-model changes: value prop → modelValue, input event → update:modelValue
- Multiple v-model bindings supported
- v-if/v-for precedence changed (v-if now higher)
- Transition class names: v-enter → v-enter-from, v-leave → v-leave-from
- keyCode modifiers removed (use key names)
- $listeners removed (merged into $attrs)
- $children removed
- Functional components: no more functional attribute`,
    removedAPIs: [
      "new Vue() (use createApp())",
      "Vue.set() (use direct assignment)",
      "Vue.delete() (use delete operator)",
      "$on / $off / $once (use mitt or tiny-emitter)",
      "Filters (use methods or computed)",
      "$listeners (use $attrs)",
      "$children",
      "keyCode modifiers (use key names)",
    ],
    deprecatedAPIs: [],
    behaviorChanges: [
      "v-model: value → modelValue, input → update:modelValue",
      "v-enter → v-enter-from, v-leave → v-leave-from",
      "v-if takes precedence over v-for (reversed from Vue 2)",
      "Functional components require plain function syntax",
    ],
  },
  "express_4_to_5": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Express 4 to 5 Breaking Changes
- Node.js 18+ required
- app.del() removed (use app.delete())
- req.param(name) removed (use req.params, req.body, or req.query)
- req.host returns host without port
- Path route matching: trailing slashes and regex changes
- Promise rejections in handlers automatically caught
- Brotli encoding supported by default
- res.jsonp() signature changed`,
    removedAPIs: [
      "app.del() (use app.delete())",
      "req.param() (use req.params, req.body, or req.query)",
    ],
    deprecatedAPIs: [],
    behaviorChanges: [
      "Node.js 18+ minimum",
      "Promise rejections auto-caught in route handlers",
      "req.host returns host without port",
      "Brotli encoding supported by default",
    ],
  },
  "nextjs_13_to_14": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Next.js 13 to 14 Breaking Changes
- Node.js 18.17+ minimum
- next export removed (use output: 'export' in next.config)
- next/image: alt prop now required
- Metadata API changes
- Server Actions stable`,
    removedAPIs: [
      "next export command (use output: 'export' in next.config.js)",
    ],
    deprecatedAPIs: [],
    behaviorChanges: [
      "Node.js 18.17+ minimum",
      "next/image: alt prop required",
      "Server Actions now stable",
    ],
  },
  "django_3_to_4": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Django 3 to 4 Breaking Changes
- USE_L10N setting removed (localization always enabled)
- url() removed from django.conf.urls (use re_path() or path())
- default_app_config in __init__.py deprecated
- DEFAULT_AUTO_FIELD must be set explicitly
- CSRF_TRUSTED_ORIGINS requires scheme (https://...)
- ugettext/ugettext_lazy → gettext/gettext_lazy`,
    removedAPIs: [
      "url() from django.conf.urls (use re_path() or path())",
      "USE_L10N setting",
      "ugettext (use gettext)",
      "ugettext_lazy (use gettext_lazy)",
    ],
    deprecatedAPIs: [
      "default_app_config in __init__.py",
    ],
    behaviorChanges: [
      "DEFAULT_AUTO_FIELD must be set explicitly (BigAutoField recommended)",
      "CSRF_TRUSTED_ORIGINS requires scheme prefix",
      "Localization always enabled",
    ],
  },
  "rails_6_to_7": {
    fetchedAt: "builtin",
    url: "builtin",
    ttlHours: 99999,
    breakingChanges: `## Rails 6 to 7 Breaking Changes
- Ruby 2.7+ required
- update_attributes/update_attributes! removed (use update/update!)
- ActiveRecord::Base.default_scope removed in some patterns
- Zeitwerk is the only autoloader (classic removed)
- to_s(:format) deprecated → to_formatted_s(:format) or to_fs(:format)
- Button elements generated by button_to have type="button" by default
- Encrypted attributes API changed`,
    removedAPIs: [
      "update_attributes (use update)",
      "update_attributes! (use update!)",
      "Classic autoloader (use Zeitwerk)",
    ],
    deprecatedAPIs: [
      "to_s(:format) (use to_fs(:format))",
    ],
    behaviorChanges: [
      "Ruby 2.7+ minimum",
      "Zeitwerk is the only autoloader",
      "button_to generates type='button' by default",
    ],
  },
};

// ── HTTP Fetch Utility ──────────────────────────────────────────

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

function fetchURL(url: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const options: any = {
      headers: { "User-Agent": "DevX-MigrationFetcher/2.0" },
    };
    if (url.startsWith("https")) {
      options.agent = tlsAgent;
    }

    const req = client.get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }

      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// ── HTML Parsing (lightweight) ──────────────────────────────────

function extractBreakingChangesFromHTML(html: string): {
  breakingChanges: string;
  removedAPIs: string[];
  deprecatedAPIs: string[];
  behaviorChanges: string[];
} {
  // Strip HTML tags but preserve structure
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level, content) => {
      return "\n" + "#".repeat(parseInt(level)) + " " + content.replace(/<[^>]+>/g, "").trim() + "\n";
    })
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Extract sections about breaking changes
  const breakingSections: string[] = [];
  const removedAPIs: string[] = [];
  const deprecatedAPIs: string[] = [];
  const behaviorChanges: string[] = [];

  const lines = text.split("\n");
  let inBreakingSection = false;
  let currentSection: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/^#{1,3}\s/.test(line) && (
      lower.includes("breaking") || lower.includes("removed") ||
      lower.includes("deprecated") || lower.includes("migration") ||
      lower.includes("changes") || lower.includes("upgrade")
    )) {
      if (currentSection.length > 0) {
        breakingSections.push(currentSection.join("\n"));
      }
      inBreakingSection = true;
      currentSection = [line];
      continue;
    }

    if (/^#{1,3}\s/.test(line) && inBreakingSection) {
      if (currentSection.length > 0) {
        breakingSections.push(currentSection.join("\n"));
      }
      inBreakingSection = false;
      currentSection = [];
    }

    if (inBreakingSection) {
      currentSection.push(line);
    }

    // Collect specific API changes from list items
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      if (lower.includes("removed") || lower.includes("no longer") || lower.includes("dropped")) {
        removedAPIs.push(item);
      } else if (lower.includes("deprecated") || lower.includes("obsolete")) {
        deprecatedAPIs.push(item);
      } else if (lower.includes("changed") || lower.includes("now ") || lower.includes("default")) {
        behaviorChanges.push(item);
      }
      // Detect rename patterns: "X → Y", "X -> Y", "X renamed to Y", "use Y instead of X"
      const renameMatch = item.match(/^(.+?)\s*[→→]\s*(.+)$/i)
        || item.match(/^(.+?)\s*->\s*(.+)$/i)
        || item.match(/^(.+?)\s+renamed?\s+to\s+(.+)$/i)
        || item.match(/^(.+?)\s*\(use\s+(.+?)\)$/i);
      if (renameMatch) {
        const cleanItem = `${renameMatch[1].trim()} (use ${renameMatch[2].trim()})`;
        if (!removedAPIs.includes(cleanItem) && !removedAPIs.includes(item)) {
          removedAPIs.push(cleanItem);
        }
      }
    }
  }

  if (currentSection.length > 0) {
    breakingSections.push(currentSection.join("\n"));
  }

  const breakingChanges = breakingSections.join("\n\n");
  const MAX_CHARS = 40000;
  const trimmed = breakingChanges.length > MAX_CHARS
    ? breakingChanges.slice(0, MAX_CHARS) + "\n\n... (truncated)"
    : breakingChanges;

  return {
    breakingChanges: trimmed || text.slice(0, MAX_CHARS),
    removedAPIs: removedAPIs.slice(0, 500),
    deprecatedAPIs: deprecatedAPIs.slice(0, 500),
    behaviorChanges: behaviorChanges.slice(0, 500),
  };
}

// ── Version Key Resolution ──────────────────────────────────────

function resolveVersionKey(fromMajor: number, toMajor: number): string {
  return `${fromMajor}-to-${toMajor}`;
}

/**
 * Validate that fetched HTML is actually a migration/changelog page and
 * not a 404, error page, or generic landing page.
 */
function validateFetchedContent(html: string): boolean {
  const lower = html.toLowerCase();
  const hasKeywords = ["breaking", "deprecated", "removed", "migration", "upgrade", "changelog", "what's new", "release note"]
    .some(k => lower.includes(k));
  const isSubstantial = html.length > 2000;
  const isNotError = !lower.includes("page not found") && !lower.includes("404 error") &&
                     !lower.includes("access denied") && !lower.includes("403 forbidden");
  return hasKeywords && isSubstantial && isNotError;
}

/**
 * Fetch with a single retry and a short delay between attempts.
 */
async function fetchWithRetry(url: string, maxRetries = 1, timeoutMs = 15000): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const html = await fetchURL(url, timeoutMs);
      if (!validateFetchedContent(html)) {
        throw new Error(`Fetched content from ${url} does not appear to be a migration doc`);
      }
      return html;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${url}`);
}

function resolveStackKey(packageName: string): string {
  const lower = packageName.toLowerCase();
  if (lower.includes(".net") || lower.includes("dotnet") || lower === "asp.net core") return "dotnet";
  if (lower.includes("bootstrap")) return "bootstrap";
  if (lower.includes("jquery") && !lower.includes("validation")) return "jquery";
  if (lower.includes("spring") || lower.includes("spring-boot")) return "spring-boot";
  if (lower.includes("react") && !lower.includes("react-") && !lower.includes("react native")) return "react";
  if (lower.includes("angular")) return "angular";
  if (lower.includes("django")) return "django";
  if (lower.includes("entity framework") || lower.includes("entityframework")) return "entity-framework-core";
  if (lower.includes("vue") || lower === "vuejs") return "vue";
  if (lower.includes("express")) return "express";
  if (lower.includes("next") || lower === "nextjs" || lower === "next.js") return "nextjs";
  if (lower.includes("flask")) return "flask";
  if (lower.includes("rails") || lower === "ruby on rails") return "rails";
  if (lower.includes("laravel")) return "laravel";
  if (lower.includes("svelte")) return "svelte";
  if (lower.includes("typescript") || lower === "ts") return "typescript";
  if (lower.includes("fastapi") || lower === "fast-api") return "fastapi";
  if (lower === "java" || lower === "jdk" || lower === "openjdk") return "java";
  if (lower === "python" || lower === "cpython") return "python";
  if (lower === "node" || lower === "nodejs" || lower === "node.js") return "nodejs";
  if (lower === "php") return "php";
  if (lower.includes("tailwind")) return "tailwindcss";
  if (lower.includes("hibernate")) return "hibernate";
  if (lower.includes("nuxt")) return "nuxt";
  if (lower.includes("webpack")) return "webpack";
  if (lower.includes("prisma")) return "prisma";
  if (lower.includes("typeorm")) return "typeorm";
  if (lower.includes("sequelize")) return "sequelize";
  if (lower.includes("vite")) return "vite";
  if (lower.includes("eslint")) return "eslint";
  if (lower.includes("jest")) return "jest";
  if (lower.includes("junit")) return "junit";
  if (lower.includes("nunit")) return "nunit";
  if (lower.includes("xunit")) return "xunit";
  if (lower === "go" || lower === "golang") return "go";
  if (lower === "rust" || lower === "cargo") return "rust";
  return lower.replace(/\s+/g, "-");
}

function getBuiltinKey(stack: string, fromMajor: number, toMajor: number): string {
  return `${stack}_${fromMajor}_to_${toMajor}`;
}

/**
 * Construct fallback URLs for stacks not in the registry.
 * Uses common migration doc URL patterns from popular documentation sites.
 */
function constructFallbackUrls(stack: string, packageName: string, fromMajor: number, toMajor: number): string[] {
  const urls: string[] = [];
  const lower = stack.toLowerCase();

  // npm packages: check CHANGELOG on GitHub or npm
  if (!["dotnet", "bootstrap", "jquery", "spring-boot", "angular", "react", "django", "vue", "express", "flask", "rails", "nextjs"].includes(lower)) {
    // Try GitHub release notes (most npm packages host changelogs there)
    urls.push(`https://github.com/${packageName}/${packageName}/releases/tag/v${toMajor}.0.0`);
    urls.push(`https://github.com/${packageName}/${packageName}/blob/main/CHANGELOG.md`);
    // Try npm package CHANGELOG
    urls.push(`https://unpkg.com/${packageName}/CHANGELOG.md`);
  }

  // PyPI packages: try readthedocs
  if (lower.includes("python") || lower.includes("flask") || lower.includes("django")) {
    urls.push(`https://${lower}.readthedocs.io/en/${toMajor}.0/changelog.html`);
    urls.push(`https://${lower}.readthedocs.io/en/latest/changelog.html`);
  }

  // RubyGems: try GitHub releases
  if (lower.includes("rails") || lower.includes("ruby")) {
    urls.push(`https://github.com/rails/rails/releases/tag/v${toMajor}.0.0`);
  }

  // Maven/Java: try GitHub wiki
  if (lower.includes("java") || lower.includes("spring")) {
    urls.push(`https://github.com/spring-projects/${lower}/wiki/Migration-Guide`);
  }

  return urls;
}

// ── Main API ────────────────────────────────────────────────────

/**
 * Fetch migration documentation for a specific version upgrade.
 * Tries: cache → online fetch → builtin knowledge → empty result.
 */
export async function fetchMigrationDoc(
  packageName: string,
  currentVersion: string,
  targetVersion: string,
): Promise<MigrationDocResult> {
  const stack = resolveStackKey(packageName);
  const fromMajor = parseInt(currentVersion.split(".")[0], 10);
  const toMajor = parseInt(targetVersion.split(".")[0], 10);

  if (isNaN(fromMajor) || isNaN(toMajor) || fromMajor === toMajor) {
    return { found: false, source: "none", breakingChanges: "", removedAPIs: [], deprecatedAPIs: [], behaviorChanges: [] };
  }

  const cachePath = getCachePath(stack, String(fromMajor), String(toMajor));

  // 1. Check cache
  const cached = loadFromCache(cachePath);
  if (cached) {
    return {
      found: true,
      source: "cache",
      breakingChanges: cached.breakingChanges,
      removedAPIs: cached.removedAPIs,
      deprecatedAPIs: cached.deprecatedAPIs,
      behaviorChanges: cached.behaviorChanges,
    };
  }

  // 2. For multi-version jumps (e.g., 7→10), collect docs for each step
  if (toMajor - fromMajor > 1) {
    const combined = await fetchCumulativeDocs(stack, fromMajor, toMajor);
    if (combined.found) return combined;
  }

  // 3. Try online fetch for direct version jump
  const versionKey = resolveVersionKey(fromMajor, toMajor);
  const registry = MIGRATION_DOC_REGISTRY[stack];
  const docSource = registry?.[versionKey];

  if (docSource) {
    try {
      const html = await fetchWithRetry(docSource.url);
      const parsed = extractBreakingChangesFromHTML(html);

      const doc: CachedMigrationDoc = {
        fetchedAt: new Date().toISOString(),
        url: docSource.url,
        ttlHours: 72,
        ...parsed,
      };
      saveToCache(cachePath, doc);

      return {
        found: true,
        source: "fetched",
        breakingChanges: parsed.breakingChanges,
        removedAPIs: parsed.removedAPIs,
        deprecatedAPIs: parsed.deprecatedAPIs,
        behaviorChanges: parsed.behaviorChanges,
      };
    } catch (err) {
      console.warn(`[MigrationDocFetcher] Fetch failed for ${docSource.url}:`, err instanceof Error ? err.message : err);
    }
  }

  // 4. Dynamic URL construction: try common migration doc URL patterns for unlisted stacks
  if (!docSource) {
    const fallbackUrls = constructFallbackUrls(stack, packageName, fromMajor, toMajor);
    for (const url of fallbackUrls) {
      try {
        const html = await fetchURL(url);
        if (html && html.length > 500) {
          const parsed = extractBreakingChangesFromHTML(html);
          if (parsed.breakingChanges.length > 100 || parsed.removedAPIs.length > 0) {
            const doc: CachedMigrationDoc = {
              fetchedAt: new Date().toISOString(),
              url,
              ttlHours: 72,
              ...parsed,
            };
            saveToCache(cachePath, doc);
            return {
              found: true,
              source: "fetched",
              breakingChanges: parsed.breakingChanges,
              removedAPIs: parsed.removedAPIs,
              deprecatedAPIs: parsed.deprecatedAPIs,
              behaviorChanges: parsed.behaviorChanges,
            };
          }
        }
      } catch {
        // Fallback URL didn't work, try next
      }
    }
  }

  // 5. Fall back to built-in knowledge
  const builtinKey = getBuiltinKey(stack, fromMajor, toMajor);
  const builtin = BUILTIN_MIGRATION_KNOWLEDGE[builtinKey];
  if (builtin) {
    saveToCache(cachePath, builtin);
    return {
      found: true,
      source: "builtin",
      breakingChanges: builtin.breakingChanges,
      removedAPIs: builtin.removedAPIs,
      deprecatedAPIs: builtin.deprecatedAPIs,
      behaviorChanges: builtin.behaviorChanges,
    };
  }

  return { found: false, source: "none", breakingChanges: "", removedAPIs: [], deprecatedAPIs: [], behaviorChanges: [] };
}

/**
 * For multi-version jumps, fetch docs for each step and combine.
 */
async function fetchCumulativeDocs(
  stack: string,
  fromMajor: number,
  toMajor: number,
): Promise<MigrationDocResult> {
  const allBreaking: string[] = [];
  const allRemoved: string[] = [];
  const allDeprecated: string[] = [];
  const allBehavior: string[] = [];
  let anyFound = false;

  for (let v = fromMajor; v < toMajor; v++) {
    const stepKey = resolveVersionKey(v, v + 1);
    const registry = MIGRATION_DOC_REGISTRY[stack];
    const source = registry?.[stepKey];

    // Try builtin first (faster)
    const builtinKey = getBuiltinKey(stack, v, v + 1);
    const builtin = BUILTIN_MIGRATION_KNOWLEDGE[builtinKey];
    if (builtin) {
      allBreaking.push(`### ${stack} ${v} → ${v + 1}\n${builtin.breakingChanges}`);
      allRemoved.push(...builtin.removedAPIs);
      allDeprecated.push(...builtin.deprecatedAPIs);
      allBehavior.push(...builtin.behaviorChanges);
      anyFound = true;
      continue;
    }

    // Try online fetch
    if (source) {
      try {
        const cachePath = getCachePath(stack, String(v), String(v + 1));
        const cached = loadFromCache(cachePath);
        if (cached) {
          allBreaking.push(`### ${stack} ${v} → ${v + 1}\n${cached.breakingChanges}`);
          allRemoved.push(...cached.removedAPIs);
          allDeprecated.push(...cached.deprecatedAPIs);
          allBehavior.push(...cached.behaviorChanges);
          anyFound = true;
          continue;
        }

        const html = await fetchURL(source.url);
        const parsed = extractBreakingChangesFromHTML(html);
        saveToCache(cachePath, {
          fetchedAt: new Date().toISOString(),
          url: source.url,
          ttlHours: 72,
          ...parsed,
        });
        allBreaking.push(`### ${stack} ${v} → ${v + 1}\n${parsed.breakingChanges}`);
        allRemoved.push(...parsed.removedAPIs);
        allDeprecated.push(...parsed.deprecatedAPIs);
        allBehavior.push(...parsed.behaviorChanges);
        anyFound = true;
      } catch {
        // Skip this step if fetch fails
      }
    }
  }

  // Also check for a direct cumulative builtin
  const directKey = getBuiltinKey(stack, fromMajor, toMajor);
  const directBuiltin = BUILTIN_MIGRATION_KNOWLEDGE[directKey];
  if (directBuiltin && !anyFound) {
    return {
      found: true,
      source: "builtin",
      breakingChanges: directBuiltin.breakingChanges,
      removedAPIs: directBuiltin.removedAPIs,
      deprecatedAPIs: directBuiltin.deprecatedAPIs,
      behaviorChanges: directBuiltin.behaviorChanges,
    };
  }

  if (!anyFound) {
    return { found: false, source: "none", breakingChanges: "", removedAPIs: [], deprecatedAPIs: [], behaviorChanges: [] };
  }

  // Save combined result to cache
  const combinedDoc: CachedMigrationDoc = {
    fetchedAt: new Date().toISOString(),
    url: "cumulative",
    ttlHours: 72,
    breakingChanges: allBreaking.join("\n\n"),
    removedAPIs: [...new Set(allRemoved)],
    deprecatedAPIs: [...new Set(allDeprecated)],
    behaviorChanges: [...new Set(allBehavior)],
  };
  saveToCache(getCachePath(stack, String(fromMajor), String(toMajor)), combinedDoc);

  return {
    found: true,
    source: "fetched",
    breakingChanges: combinedDoc.breakingChanges,
    removedAPIs: combinedDoc.removedAPIs,
    deprecatedAPIs: combinedDoc.deprecatedAPIs,
    behaviorChanges: combinedDoc.behaviorChanges,
  };
}

/**
 * Fetch migration docs for all user selections that have major version jumps.
 */
export async function fetchAllMigrationDocs(
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): Promise<Map<string, MigrationDocResult>> {
  const results = new Map<string, MigrationDocResult>();

  for (const sel of selections) {
    const fromMajor = parseInt(sel.currentVersion?.split(".")[0] || "0", 10);
    const toMajor = parseInt(sel.selectedVersion.split(".")[0], 10);

    if (isNaN(fromMajor) || isNaN(toMajor) || fromMajor >= toMajor) continue;

    try {
      const doc = await fetchMigrationDoc(sel.package, sel.currentVersion, sel.selectedVersion);
      if (doc.found) {
        results.set(sel.package, doc);
      }
    } catch (err) {
      console.warn(`[MigrationDocFetcher] Failed for ${sel.package}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

/**
 * Format migration docs for prompt injection.
 * @deprecated Use migration-doc-formatter.ts formatDocsForPlanning/formatDocsForTaskPlanning
 * /formatDocsForCodeUpgrade instead — they provide budget-aware, priority-ordered output.
 * Kept for backward compatibility only.
 */
export function formatMigrationDocsForPrompt(docs: Map<string, MigrationDocResult>): string {
  if (docs.size === 0) return "";

  const parts: string[] = ["## OFFICIAL MIGRATION DOCUMENTATION (use this as your primary reference)\n"];

  for (const [pkg, doc] of docs) {
    parts.push(`### ${pkg}`);

    if (doc.removedAPIs.length > 0) {
      parts.push(`**REMOVED APIs (MUST be removed/replaced):**`);
      for (const api of doc.removedAPIs) {
        parts.push(`  - ${api}`);
      }
    }

    if (doc.deprecatedAPIs.length > 0) {
      parts.push(`**DEPRECATED APIs (should be updated):**`);
      for (const api of doc.deprecatedAPIs) {
        parts.push(`  - ${api}`);
      }
    }

    if (doc.behaviorChanges.length > 0) {
      parts.push(`**BEHAVIOR CHANGES (verify compatibility):**`);
      for (const change of doc.behaviorChanges) {
        parts.push(`  - ${change}`);
      }
    }

    parts.push("");
  }

  return parts.join("\n");
}
