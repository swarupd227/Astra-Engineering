import { useState, useRef, useEffect } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  HelpCircle, BookOpen, Video, Keyboard, MessageCircle, Search, Play,
  Zap, Target, BarChart3, ArrowUpDown, Eye, Database, Bot, ChevronRight,
  ExternalLink, Mail, CheckCircle2, AlertCircle, Info, Lightbulb,
  ArrowRight, FileText, Globe, Settings, Shield, Code2, Layers, GitBranch,
  Upload, Download, Sparkles, Clock, Users, X, List, Hash
} from "lucide-react";
// Demo video is not bundled in the repo (kept out of source control for size).
// Drop a file at client/public/product-tour.mp4 to enable it, or set a CDN URL.
const productTourVideo = "/product-tour.mp4";

/* ─────────────────── DOCUMENTATION CONTENT ─────────────────── */

interface DocSection {
  type: "intro" | "steps" | "tip" | "warning" | "info" | "subheading" | "list" | "code";
  title?: string;
  content?: string;
  items?: string[];
  code?: string;
}

interface FeatureDoc {
  id: string;
  icon: any;
  title: string;
  description: string;
  color: string;
  bgColor: string;
  badgeLabel: string;
  sections: DocSection[];
}

// NAT-imp-tools: ids listed here are kept in `featureDocs` (full doc content
// preserved) but filtered out of the Feature Guides grid. Remove an id from
// this set to re-enable the corresponding guide in the UI.
const HIDDEN_FEATURE_DOC_IDS: ReadonlySet<string> = new Set([
  "execution",
  "visual",
]);

const featureDocs: FeatureDoc[] = [
  {
    id: "autonomous",
    icon: Zap,
    title: "Autonomous Testing",
    description: "Generate test cases from website analysis",
    color: "text-amber-500",
    bgColor: "bg-amber-50",
    badgeLabel: "AI Crawl",
    sections: [
      {
        type: "intro",
        content: "Autonomous Testing uses AI agents to crawl a live website, discover all interactive elements, and automatically generate a comprehensive suite of test cases — with zero manual authoring required."
      },
      {
        type: "subheading",
        title: "Prerequisites"
      },
      {
        type: "list",
        items: [
          "A live website URL (must be publicly accessible or reachable from the server)",
          "A project created in NAT 2.0 (Settings → Projects)",
          "At least Tester role permissions"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Running an Autonomous Test"
      },
      {
        type: "steps",
        items: [
          "Navigate to Autonomous Testing from the sidebar.",
          "Select your project from the Project dropdown at the top.",
          "Enter the target website URL in the URL field (e.g. https://your-app.com).",
          "Choose a Domain (Insurance, Healthcare, Finance, E-Commerce, General) for context-aware test generation.",
          "Optionally upload a Product Description document (PDF/DOCX) to enrich the AI context.",
          "Click Start Crawl. The AI agents will open the page, discover all links, forms, buttons and inputs.",
          "Watch the agent progress panel — Crawler → Analyzer → Generator agents activate in sequence.",
          "When complete, the test cases appear in the results panel grouped by category (Functional, Negative, Edge Case, Security, Accessibility).",
          "Select individual test cases or use Select All, then click Save to Project to persist them.",
          "From Execution Mode you can now run these saved test cases against the live URL."
        ]
      },
      {
        type: "tip",
        title: "Pro Tip: Domain Selection",
        content: "Choosing the right domain unlocks domain-specific test patterns. For example, the Insurance domain generates tests around premium calculation, policy lifecycle, and coverage validation — not just generic UI tests."
      },
      {
        type: "subheading",
        title: "What the AI Crawl Discovers"
      },
      {
        type: "list",
        items: [
          "All navigable pages and sub-pages via link following",
          "Form fields with their types, labels, placeholders, and validation rules",
          "Interactive buttons, dropdowns, modals, and accordions",
          "API calls triggered by user interactions (XHR/Fetch)",
          "Accessibility violations (missing alt text, ARIA labels, contrast)",
          "JavaScript errors during interaction"
        ]
      },
      {
        type: "info",
        title: "Crawl Depth",
        content: "The default crawl follows up to 3 levels of links. For large SPAs, the crawler intelligently prioritizes pages with more interactive elements."
      },
      {
        type: "subheading",
        title: "Understanding Test Categories"
      },
      {
        type: "list",
        items: [
          "Functional — Happy path scenarios for all discovered user flows",
          "Negative — Invalid inputs, boundary violations, error state triggers",
          "Edge Case — Unusual combinations, concurrent operations, empty states",
          "Security — XSS, SQL injection probes, auth bypass attempts, CORS checks",
          "Accessibility — WCAG 2.1 compliance, keyboard navigation, screen reader support"
        ]
      },
      {
        type: "warning",
        title: "Security Tests Advisory",
        content: "Security test cases generated by NAT 2.0 are descriptive test scenarios, not active exploit scripts. Always run security tests only on environments you own or have explicit permission to test."
      }
    ]
  },
  {
    id: "stories",
    icon: Target,
    title: "Generate from User Stories",
    description: "Create tests from user stories and sprints",
    color: "text-violet-500",
    bgColor: "bg-violet-50",
    badgeLabel: "Sprint Agent",
    sections: [
      {
        type: "intro",
        content: "The Sprint Agent reads your user stories and acceptance criteria, then uses a multi-agent AI pipeline to generate structured, traceable test cases categorised by functional area — ready for both manual testing and Playwright automation."
      },
      {
        type: "subheading",
        title: "Prerequisites"
      },
      {
        type: "list",
        items: [
          "A project created in NAT 2.0",
          "A sprint created under the project",
          "At least one user story with Title + Description + Acceptance Criteria",
          "Optional: Azure DevOps / Jira integration for automatic story import",
          "Optional: Golden Repository path for context-enriched generation",
          "Optional: BRD / Spec documents (PDF/DOCX) for richer test coverage"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Generating from User Stories"
      },
      {
        type: "steps",
        items: [
          "Go to Generate from User Stories in the sidebar.",
          "Select a Project, then select or create a Sprint.",
          "Add a User Story: click + Add Story and fill in the Title, Description, and Acceptance Criteria fields.",
          "Optionally upload supporting documents (BRDs, spec PDFs) by clicking Upload Context Docs.",
          "Optionally enter the Golden Repository path if your codebase is configured (Settings → Agent Config).",
          "Select the user story and click Generate Test Cases.",
          "Watch the 6-stage Agentic AI Pipeline: Orchestrator → Story Analyzer → Planner → Generator → QA Refiner → Script Generator.",
          "Once complete, review generated test cases in the results panel. Each test shows its category, priority (P0–P3), 6-step workflow, and traceability link.",
          "Use Category Filter and Priority Filter to focus on specific test types.",
          "Click Save to Project to persist the test cases, or Export to download as Excel/JSON/PDF."
        ]
      },
      {
        type: "subheading",
        title: "The 6-Stage Agentic Pipeline"
      },
      {
        type: "list",
        items: [
          "Orchestrator — Coordinates all agents, manages handoffs and error recovery",
          "Story Analyzer — Extracts entities, roles, fields, actions, and downstream effects from the story text",
          "Planner — Decides category distribution and test count targets based on story complexity",
          "Generator — Produces test cases per category using Claude AI with story-faithful prompts",
          "QA Refiner — Validates coverage completeness, removes duplicates, checks step clarity",
          "Script Generator — Scaffolds Gherkin feature files and Playwright step definitions"
        ]
      },
      {
        type: "tip",
        title: "Write Better Acceptance Criteria",
        content: "Use the Given/When/Then format in your acceptance criteria for best results. Example: 'Given a user is on the login page, When they enter valid credentials, Then they should be redirected to the dashboard.' The AI extracts these directly into test steps."
      },
      {
        type: "subheading",
        title: "Test Case Structure"
      },
      {
        type: "list",
        items: [
          "Test Case ID — Prefixed by category (FUN-1, NEG-3, EDG-2, SEC-1, ACC-1)",
          "Title — Descriptive scenario name with [Happy Path] / [Negative] prefix",
          "Objective — Single-sentence goal statement",
          "Preconditions — System state required before test starts",
          "Steps 1–6 — Action + Expected Behavior pairs (Step 6 always verifies final system state)",
          "Expected Result — Overall pass condition",
          "Test Data — Sample values for all input fields",
          "Priority — P0 (critical) → P3 (low), mapped from acceptance criteria importance",
          "Traceability — Direct quote from the user story that this test validates"
        ]
      },
      {
        type: "subheading",
        title: "Importing from Azure DevOps / Jira"
      },
      {
        type: "steps",
        items: [
          "Go to Integration Management (sidebar) and set up your Azure DevOps or Jira connection.",
          "In Generate from User Stories, click Import from ADO or Import from Jira.",
          "Select the project and sprint/iteration to pull stories from.",
          "Stories are imported with their work item IDs preserved for traceability.",
          "Generated test cases can be pushed back to ADO/Jira as test items after generation."
        ]
      },
      {
        type: "info",
        title: "Golden Repository Context",
        content: "When a repo path is configured, the Context Enricher agent scans your actual codebase to find real API endpoint names, database field names, and existing test patterns. This produces test cases that reference your actual implementation, not generic placeholders."
      }
    ]
  },
  {
    id: "execution",
    icon: Play,
    title: "Execution Mode",
    description: "Run tests with Playwright automation",
    color: "text-emerald-500",
    bgColor: "bg-emerald-50",
    badgeLabel: "Playwright",
    sections: [
      {
        type: "intro",
        content: "Execution Mode runs your saved test cases against a live application using Playwright automation. An AI agent orchestrator coordinates 5 specialist agents (Navigator, Executor, Validator, Reporter) to execute each test step and capture results, screenshots, and video recordings."
      },
      {
        type: "subheading",
        title: "Prerequisites"
      },
      {
        type: "list",
        items: [
          "Test cases saved to a project (from Sprint Agent or Autonomous Testing)",
          "A live target URL (the application to test)",
          "Node.js with Playwright installed on the server (auto-configured by NAT 2.0)",
          "Network access from the NAT 2.0 server to the target application"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Running an Execution"
      },
      {
        type: "steps",
        items: [
          "Navigate to Execution Mode from the sidebar.",
          "Select Test Source: Sprint Agent (test cases from user stories), Autonomous Testing (crawl-generated), or Jira User Stories.",
          "Select a Project to filter available test cases.",
          "Optionally filter by Sprint or Category to narrow the test set.",
          "Enter the Target URL — the live application endpoint Playwright will navigate to.",
          "Check the test cases you want to run, or use Select All for the full suite.",
          "Toggle Record Video and Generate BDD Files options as needed.",
          "Click Start Execution. An execution run is created and the AI agent orchestrator starts.",
          "Monitor the 5 agent panels in real-time: Orchestrator, Navigator, Executor, Validator, Reporter.",
          "View live Playwright logs filtered by category (browser, navigation, action, assertion).",
          "When complete, the results panel shows pass/fail per test case with detailed step logs.",
          "Download the HTML Execution Report, Feature File, or Step Definitions from the BDD Artifacts panel."
        ]
      },
      {
        type: "subheading",
        title: "The 5 Execution Agents"
      },
      {
        type: "list",
        items: [
          "Orchestrator — Manages the overall test run, sequences tests, handles retries on flaky steps",
          "Navigator — Handles page navigation, URL routing, and wait-for-load-state logic",
          "Executor — Fills forms, clicks elements, selects options using ELEMENT_MAP locators",
          "Validator — Runs expect() assertions after each step, captures screenshots on failure",
          "Reporter — Compiles results into HTML report, generates BDD artifacts, writes execution log"
        ]
      },
      {
        type: "tip",
        title: "Element Discovery for Better Locators",
        content: "Before running execution, the system crawls the target URL to build an ELEMENT_MAP — a dictionary of named XPath and CSS selectors for all interactive elements. This makes Playwright scripts resilient to minor DOM changes."
      },
      {
        type: "subheading",
        title: "BDD Artifacts Explained"
      },
      {
        type: "list",
        items: [
          "HTML Report — Full execution report with pass/fail, step details, screenshots, viewable in any browser",
          "Feature File (.feature) — Gherkin scenarios: Given/When/Then mapped from test steps, one Scenario per test case",
          "Step Definitions (.ts) — Playwright + Cucumber bindings for all Given/When/Then patterns, ready to extend"
        ]
      },
      {
        type: "info",
        title: "Headless vs Headed Mode",
        content: "Execution currently runs in headless mode (no visible browser window) for speed. Video recordings are captured even in headless mode. Headed mode (visible browser) will be available in a future release."
      },
      {
        type: "warning",
        title: "Authentication-Gated Pages",
        content: "If your application requires login, add a pre-test login step to your test cases' preconditions. Alternatively, configure a session cookie or auth token in Integration Management → Execution Settings."
      }
    ]
  },
  {
    id: "visual",
    icon: Eye,
    title: "Visual Regression",
    description: "Compare Figma designs with live sites",
    color: "text-cyan-500",
    bgColor: "bg-cyan-50",
    badgeLabel: "AI Vision",
    sections: [
      {
        type: "intro",
        content: "Visual Regression uses AI vision to compare your Figma design files against the live deployed application. It identifies pixel-level differences, layout shifts, colour mismatches, and missing components — giving you an automated design QA layer."
      },
      {
        type: "subheading",
        title: "Prerequisites"
      },
      {
        type: "list",
        items: [
          "A Figma file URL with view access (public or via Figma API token)",
          "The corresponding live website URL",
          "Figma API token configured in Integration Management (for private files)"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Running Visual Regression"
      },
      {
        type: "steps",
        items: [
          "Go to Visual Regression from the sidebar.",
          "Enter the Figma File URL (e.g. https://www.figma.com/file/xxxx/MyDesign).",
          "Enter the Live Website URL to compare against.",
          "Optionally specify which Figma frames/pages to compare (defaults to all).",
          "Click Start Comparison. The AI takes screenshots of both sources.",
          "The comparison engine overlays the Figma export with the live screenshot.",
          "Differences are highlighted with bounding boxes — colour coded by severity (critical, moderate, minor).",
          "Review each difference in the results panel: component name, deviation type, pixel diff percentage.",
          "Export the Visual Regression Report as PDF for design review sign-off."
        ]
      },
      {
        type: "subheading",
        title: "Types of Differences Detected"
      },
      {
        type: "list",
        items: [
          "Layout — Component position, spacing, margin/padding deviations",
          "Typography — Font size, weight, line height, letter spacing mismatches",
          "Colour — Background, text, border colour differences (hex level precision)",
          "Missing Elements — Components present in Figma but absent in the live app",
          "Extra Elements — Elements on the live site not in the Figma design",
          "Responsive — Layout breakpoint differences at mobile/tablet/desktop viewports"
        ]
      },
      {
        type: "tip",
        title: "Best Comparison Results",
        content: "For highest accuracy, use Figma frames exported at 2x resolution and ensure the live site is viewed at the same viewport width as the Figma frame. Use the viewport width setting in the comparison options to match exactly."
      }
    ]
  },
  {
    id: "reports",
    icon: BarChart3,
    title: "Reports & Analytics",
    description: "View testing metrics and insights",
    color: "text-orange-500",
    bgColor: "bg-orange-50",
    badgeLabel: "Analytics",
    sections: [
      {
        type: "intro",
        content: "Reports & Analytics gives QA leads and project managers a real-time view of test coverage, execution trends, defect rates, and team velocity. All metrics are derived from your actual test generation and execution activity in NAT 2.0."
      },
      {
        type: "subheading",
        title: "Available Report Types"
      },
      {
        type: "list",
        items: [
          "Coverage Report — Test cases per user story, category breakdown, priority distribution",
          "Execution Report — Pass/fail rates, flaky tests, average execution time per test",
          "Trend Report — Week-over-week test generation and pass rate trends",
          "Defect Density — Failure rate by module, sprint, or tester",
          "Sprint Summary — All test activity for a sprint: stories tested, cases generated, executed, passed"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Generating a Report"
      },
      {
        type: "steps",
        items: [
          "Go to Reports & Analytics from the sidebar.",
          "Select the Report Type from the dropdown (Coverage, Execution, Trend, Sprint Summary).",
          "Choose the Project and date range filter.",
          "Optionally filter by Sprint, Category, or Priority.",
          "Click Generate Report. Charts and tables populate within seconds.",
          "Use the Export button to download as PDF or Excel.",
          "Share the report link with stakeholders for direct browser access."
        ]
      },
      {
        type: "subheading",
        title: "Key Metrics Explained"
      },
      {
        type: "list",
        items: [
          "Test Coverage % — (Stories with test cases / Total stories) × 100",
          "Pass Rate % — (Passed executions / Total executions) × 100",
          "Flaky Test Index — Tests that alternate pass/fail across 3+ consecutive runs",
          "P0 Coverage — % of P0 (critical) test cases that have been executed",
          "Automation Rate — % of test cases with Playwright scripts vs manual-only"
        ]
      },
      {
        type: "tip",
        title: "Dashboard Widgets",
        content: "Pin your most-used reports to the Dashboard by clicking the Pin icon on any report. This gives you a real-time stats view every time you log in."
      }
    ]
  },
  {
    id: "import-export",
    icon: ArrowUpDown,
    title: "Import / Export",
    description: "Transfer test cases between tools",
    color: "text-blue-500",
    bgColor: "bg-blue-50",
    badgeLabel: "Integration",
    sections: [
      {
        type: "intro",
        content: "The Import/Export Center is the integration hub for NAT 2.0. Import test cases from external tools like Azure DevOps, Jira, TestRail, and Excel. Export to any of these platforms or download as structured files for offline use."
      },
      {
        type: "subheading",
        title: "Supported Export Formats"
      },
      {
        type: "list",
        items: [
          "Excel (.xlsx) — Test cases formatted as rows with all fields: ID, title, steps, expected result, priority",
          "CSV — Flat format compatible with any test management tool",
          "JSON — Structured format for developer tooling and CI/CD pipeline integration",
          "PDF — Formatted test case document for review meetings and sign-off",
          "Azure DevOps — Push directly to ADO Test Plans as Test Cases with traceability links",
          "Jira Xray — Export as Xray-compatible test cases linked to Jira issues",
          "TestRail — Export to TestRail test suites via TestRail API",
          "BDD (.feature) — Gherkin feature files + Playwright step definitions"
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Exporting Test Cases"
      },
      {
        type: "steps",
        items: [
          "Go to Import/Export from the sidebar.",
          "Select Export tab.",
          "Choose the Project and optionally filter by Sprint, Category, or Priority.",
          "Select the destination format (Excel, JSON, PDF, Azure DevOps, etc.).",
          "For platform exports (ADO, Jira), ensure the integration is configured in Integration Management.",
          "Click Export. A download link or confirmation of the platform push appears.",
          "For ADO/Jira: test cases appear in the configured Test Plan/project within seconds."
        ]
      },
      {
        type: "subheading",
        title: "Step-by-Step: Importing Test Cases"
      },
      {
        type: "steps",
        items: [
          "Go to Import/Export → Import tab.",
          "Select the import source (Excel, CSV, Azure DevOps, Jira, TestRail).",
          "For file imports: upload the file and map columns to NAT 2.0 fields using the column mapper.",
          "For platform imports: select the project, test plan/suite, and click Fetch.",
          "Review the import preview — check field mapping and resolve any validation errors.",
          "Click Confirm Import. Test cases are saved to your selected project."
        ]
      },
      {
        type: "tip",
        title: "Excel Import Template",
        content: "Download the NAT 2.0 Excel template from the Import tab to ensure your spreadsheet has the correct column structure. The template includes dropdown validation for Category and Priority fields."
      },
      {
        type: "info",
        title: "Bi-Directional ADO Sync",
        content: "When connected to Azure DevOps, NAT 2.0 supports bi-directional sync. Test case status updates in ADO (Pass/Fail after a test run) are reflected back in NAT 2.0 execution reports automatically."
      }
    ]
  }
];

/* ─────────────────── FAQ DATA ─────────────────── */

const faqs = [
  // Setup & Configuration
  {
    category: "Setup & Configuration",
    question: "How do I connect to Azure DevOps?",
    answer: "Navigate to Integration Management from the sidebar. Select Azure DevOps, enter your Organization URL (e.g. https://dev.azure.com/yourorg), Personal Access Token (PAT) with Read/Write access to Test Plans and Work Items, and your Project name. Click Test Connection — a green tick confirms success. Click Save. Your ADO projects and sprints will now appear in the Sprint Agent story import."
  },
  {
    category: "Setup & Configuration",
    question: "How do I connect to Jira?",
    answer: "Go to Integration Management → Jira. Enter your Jira Instance URL (e.g. https://yourcompany.atlassian.net), your Email, and an API Token (generated from Atlassian Account Settings → Security → API Tokens). Select the projects you want to sync. Click Test Connection and Save."
  },
  {
    category: "Setup & Configuration",
    question: "What is the Golden Repository and how do I set it up?",
    answer: "The Golden Repository is your application's source code. When configured, NAT 2.0 scans it to extract real API endpoint paths, database field names, existing test patterns, and service names — producing test cases that reference your actual implementation rather than generic placeholders. To set it up: Go to Settings → Framework Config, set the Repository Path to the local or mounted path of your codebase (e.g. C:/projects/my-app), and save. The Sprint Agent will use it automatically on the next test generation."
  },
  {
    category: "Setup & Configuration",
    question: "How do I configure a Playwright framework catalog?",
    answer: "A Framework Catalog lets you register your reusable Playwright helper functions (e.g. loginAsUser(), navigateToPolicy(), fillClaimForm()). Go to Settings → Framework Config → Add Function. Enter the function name, parameters, description, and code snippet. When generating test scripts, NAT 2.0 references these functions in step definitions instead of raw Playwright code — making scripts much shorter and more maintainable."
  },
  // Test Generation
  {
    category: "Test Generation",
    question: "What is the difference between Autonomous Testing and Generate from User Stories?",
    answer: "Autonomous Testing crawls a live website URL to discover and test what's actually there — ideal for testing existing applications without documentation. Generate from User Stories reads your written requirements (acceptance criteria) and generates tests for what the system should do — ideal for sprint-based development, BDD, and requirement traceability. Both can produce Playwright automation scripts."
  },
  {
    category: "Test Generation",
    question: "How many test cases are generated per user story?",
    answer: "The Sprint Agent generates between 30–50 test cases per user story by default, distributed across 5 categories: Functional (8–12), Negative (6–8), Edge Case (5–7), Security (4–6), and Accessibility (4–6). The exact count adapts to story complexity — stories with more acceptance criteria produce more tests. You can filter and select any subset before saving."
  },
  {
    category: "Test Generation",
    question: "How do I upload BRD or spec documents to improve test generation?",
    answer: "In the Generate from User Stories page, click the Upload Context Docs button (paperclip icon) next to the Generate button. Select one or more PDF or DOCX files. The Document Enricher agent extracts requirements, business rules, and data constraints from the documents and uses them to produce more domain-accurate test cases. Documents are processed only for the current generation session and are not stored permanently."
  },
  {
    category: "Test Generation",
    question: "Can I regenerate test cases for a specific category only?",
    answer: "Yes. In the Sprint Agent results view, click the Regenerate button on any category card (e.g. Regenerate Security Tests). This runs the AI generator only for that category using the same user story context, without affecting the other categories."
  },
  {
    category: "Test Generation",
    question: "Why do some test cases have [Happy Path] and others have [Negative] in their title?",
    answer: "These prefixes indicate the test scenario type. [Happy Path] = the system behaves correctly with valid inputs. [Negative] = the system correctly handles invalid inputs or error conditions. [Edge Case] = unusual but valid scenarios at the boundaries of the specification. This makes it easy to see test intent at a glance without reading the full test steps."
  },
  {
    category: "Test Generation",
    question: "What does P0, P1, P2, P3 priority mean?",
    answer: "Priority maps to business criticality: P0 = Core acceptance criteria (must pass before release), P1 = Important secondary behaviours (should pass for release), P2 = Standard coverage (nice to have for release), P3 = Low-risk regression and edge cases (run in non-blocking suites). P0 tests are always generated first and should be included in every CI/CD gate."
  },
  // Execution
  {
    category: "Execution Mode",
    question: "What browsers are supported for test execution?",
    answer: "Execution Mode uses Playwright, which supports Chromium (Chrome/Edge), Firefox, and WebKit (Safari). The default is Chromium headless. Browser selection will be available as a configuration option in a future release. For cross-browser testing, export the Playwright .spec.ts files and run them locally using npx playwright test --project=firefox."
  },
  {
    category: "Execution Mode",
    question: "My test execution fails with a navigation error. What should I do?",
    answer: "Navigation errors typically mean the target URL was unreachable from the NAT 2.0 server, or the page requires authentication. Check: (1) The URL is correct and accessible from the server network. (2) If authentication is required, add login steps to your test preconditions. (3) If using a VPN-gated internal app, ensure the server is on the same VPN. (4) Check the Playwright log panel for the specific error — it shows the exact URL and HTTP status code."
  },
  {
    category: "Execution Mode",
    question: "How do I view the video recording of a test run?",
    answer: "After execution completes, go to the execution run in the Recent Runs panel (right side of Execution Mode). Click View Run to open the run detail. If Record Video was enabled, a Download Video button appears for each test case that was executed. Videos are retained for 7 days by default."
  },
  {
    category: "Execution Mode",
    question: "Can I run a subset of test cases without re-selecting every time?",
    answer: "Yes. Use the Category Filter and Priority Filter dropdowns to pre-filter the test case list, then click Select All to select all filtered results. For example: set Category = Functional + Priority = P0 to select only your critical functional tests. Your filter state is remembered for the session."
  },
  // Visual Regression
  {
    category: "Visual Regression",
    question: "How do I provide a Figma URL for Visual Regression?",
    answer: "Open your Figma file, click Share in the top right, and copy the link (it will look like https://www.figma.com/file/ABC123/FileName). For private files, you also need a Figma API token: go to Figma → Account Settings → Personal Access Tokens → Generate New Token. Enter both the URL and token in Integration Management → Figma."
  },
  {
    category: "Visual Regression",
    question: "What viewport sizes are compared in Visual Regression?",
    answer: "By default, NAT 2.0 compares at desktop (1440px), tablet (768px), and mobile (375px) viewports. You can configure custom viewport widths in the Visual Regression settings panel before starting the comparison."
  },
  // Reports & Import/Export
  {
    category: "Reports & Export",
    question: "Can I export test cases to TestRail?",
    answer: "Yes. Go to Import/Export → Export, select TestRail as the destination. You need to configure the TestRail connection first in Integration Management → TestRail (enter your TestRail URL, username, and API key). Then select the target TestRail project and suite, and click Export. Test cases are created with all steps, expected results, and custom fields mapped."
  },
  {
    category: "Reports & Export",
    question: "How do I share a report with stakeholders who don't have a NAT 2.0 account?",
    answer: "From any report view, click the Export as PDF button. This generates a formatted PDF with all charts and test case tables included. For the HTML Execution Report, click Download HTML Report in the BDD Artifacts panel after execution — this is a self-contained HTML file that can be shared via email or uploaded to Confluence/SharePoint."
  },
  // General
  {
    category: "General",
    question: "Is my data secure? Are test cases stored on NOUS servers?",
    answer: "NAT 2.0 is deployed on your organization's infrastructure (on-premises or private cloud). Test cases, user stories, and execution data are stored in your own database. The only external calls are to the Claude AI API (Anthropic) for AI generation — only the user story text and acceptance criteria are sent, never your codebase or credentials."
  },
  {
    category: "General",
    question: "Can multiple team members work on the same project simultaneously?",
    answer: "Yes. All project data is shared in real-time across team members. Multiple users can generate test cases from different user stories in the same sprint concurrently. Test case edits are saved immediately and visible to all users with project access. Role-based permissions (Admin, Lead, Tester, Viewer) control who can edit vs. read-only."
  }
];

/* ─────────────────── KEYBOARD SHORTCUTS ─────────────────── */

const keyboardShortcuts = [
  { category: "Navigation", shortcuts: [
    { keys: ["G", "D"], description: "Go to Dashboard" },
    { keys: ["G", "A"], description: "Go to Autonomous Testing" },
    { keys: ["G", "U"], description: "Go to Generate from User Stories" },
    { keys: ["G", "E"], description: "Go to Execution Mode" },
    { keys: ["G", "R"], description: "Go to Reports" },
    { keys: ["G", "H"], description: "Go to Help & Guidance" },
  ]},
  { category: "Actions", shortcuts: [
    { keys: ["Ctrl", "K"], description: "Global search" },
    { keys: ["Ctrl", "N"], description: "New item (context-aware)" },
    { keys: ["Ctrl", "S"], description: "Save current" },
    { keys: ["Ctrl", "E"], description: "Export" },
    { keys: ["Ctrl", "Enter"], description: "Add step below (in test case edit)" },
    { keys: ["Ctrl", "G"], description: "Generate test cases" },
  ]},
  { category: "General", shortcuts: [
    { keys: ["?"], description: "Show keyboard shortcuts" },
    { keys: ["Escape"], description: "Cancel / Close modal" },
    { keys: ["Enter"], description: "Confirm / Submit" },
    { keys: ["Tab"], description: "Move to next field" },
    { keys: ["Ctrl", "Z"], description: "Undo last action" },
  ]},
];

const faqCategories = [...new Set(faqs.map(f => f.category))];

/* ─────────────────── SECTION RENDERER ─────────────────── */

function DocSectionRenderer({ section }: { section: DocSection }) {
  switch (section.type) {
    case "intro":
      return (
        <p className="text-sm text-gray-600 leading-relaxed border-l-4 border-indigo-400 pl-4 bg-indigo-50 py-3 pr-3 rounded-r-lg">
          {section.content}
        </p>
      );
    case "subheading":
      return (
        <h3 className="text-sm font-700 text-gray-900 mt-5 mb-2 flex items-center gap-2 font-bold">
          <span className="w-1.5 h-4 bg-primary rounded-full inline-block" />
          {section.title}
        </h3>
      );
    case "steps":
      return (
        <ol className="space-y-2">
          {section.items?.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="space-y-1.5">
          {section.items?.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2" />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      );
    case "tip":
      return (
        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-700 mb-1">{section.title}</p>
            <p className="text-xs text-amber-800 leading-relaxed">{section.content}</p>
          </div>
        </div>
      );
    case "warning":
      return (
        <div className="flex gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-red-700 mb-1">{section.title}</p>
            <p className="text-xs text-red-800 leading-relaxed">{section.content}</p>
          </div>
        </div>
      );
    case "info":
      return (
        <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-700 mb-1">{section.title}</p>
            <p className="text-xs text-blue-800 leading-relaxed">{section.content}</p>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/* ─────────────────── MAIN COMPONENT ─────────────────── */

const playbackSpeeds = [
  { value: 1, label: "1x" },
  { value: 1.2, label: "1.2x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeDocFeature, setActiveDocFeature] = useState<FeatureDoc | null>(null);
  const [faqCategory, setFaqCategory] = useState<string>("All");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, showVideoModal]);

  const filteredFaqs = faqs.filter(faq => {
    const matchesSearch =
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = faqCategory === "All" || faq.category === faqCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <>
      <DashboardHeader />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">

            {/* PAGE HEADER */}
            <div className="text-center">
              <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-3">
                <HelpCircle className="w-9 h-9 text-primary" />
                Help & Guidance
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
                Comprehensive guides, step-by-step walkthroughs, and answers to common questions
              </p>
            </div>

            {/* GETTING STARTED */}
            <Card className="border-primary/20" style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.04))" }}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">New to NAT 2.0?</h2>
                      <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                        Watch the 5-minute platform tour to see Autonomous Testing, Sprint Agent, and Execution Mode in action before diving into the detailed guides below.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="lg"
                    data-testid="button-start-tour"
                    onClick={() => setShowVideoModal(true)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Watch Platform Tour
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* QUICK LINKS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className="border border-gray-200 hover:border-indigo-400 transition-colors cursor-pointer hover:shadow-sm"
                onClick={() => setShowVideoModal(true)}
                data-testid="card-video-tutorials"
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <Video className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Video Tutorials</p>
                    <p className="text-xs text-gray-500 mt-0.5">Step-by-step walkthroughs</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                </CardContent>
              </Card>
              <Card className="border border-gray-200 hover:border-indigo-400 transition-colors cursor-pointer hover:shadow-sm">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-violet-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Documentation</p>
                    <p className="text-xs text-gray-500 mt-0.5">Comprehensive guides below</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                </CardContent>
              </Card>
              <Card className="border border-gray-200 hover:border-indigo-400 transition-colors cursor-pointer hover:shadow-sm">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <MessageCircle className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Support</p>
                    <p className="text-xs text-gray-500 mt-0.5">Get help from our team</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                </CardContent>
              </Card>
            </div>

            {/* FEATURE GUIDES */}
            <Card className="border border-gray-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-500" />
                  Feature Guides
                </CardTitle>
                <CardDescription className="text-xs">Click any feature to open the full step-by-step documentation</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {featureDocs.filter((doc) => !HIDDEN_FEATURE_DOC_IDS.has(doc.id)).map((doc) => (
                    <button
                      key={doc.id}
                      className="p-4 rounded-xl bg-gray-50 border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all text-left flex items-start gap-3 group"
                      data-testid={`button-guide-${doc.id}`}
                      onClick={() => setActiveDocFeature(doc)}
                    >
                      <div className={`w-10 h-10 rounded-lg ${doc.bgColor} flex items-center justify-center flex-shrink-0`}>
                        <doc.icon className={`w-5 h-5 ${doc.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900 text-sm group-hover:text-indigo-600 transition-colors">{doc.title}</p>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-200 text-gray-500">{doc.badgeLabel}</Badge>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">{doc.description}</p>
                        <p className="text-xs text-indigo-500 mt-2 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Read guide <ArrowRight className="w-3 h-3" />
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* KEYBOARD SHORTCUTS */}
            <Card className="border border-gray-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-indigo-500" />
                  Keyboard Shortcuts
                </CardTitle>
                <CardDescription className="text-xs">Speed up your workflow with these shortcuts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {keyboardShortcuts.map((category) => (
                    <div key={category.category}>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{category.category}</p>
                      <div className="space-y-1.5">
                        {category.shortcuts.map((shortcut, index) => (
                          <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                            <span className="text-xs text-gray-700">{shortcut.description}</span>
                            <div className="flex gap-1 flex-shrink-0">
                              {shortcut.keys.map((key, keyIndex) => (
                                <kbd
                                  key={keyIndex}
                                  className="px-2 py-0.5 text-[10px] font-mono bg-white rounded border border-gray-300 text-gray-700 shadow-sm"
                                >
                                  {key}
                                </kbd>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* FAQs */}
            <Card className="border border-gray-200">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-indigo-500" />
                      Frequently Asked Questions
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {faqs.length} questions across {faqCategories.length} topics
                    </CardDescription>
                  </div>
                  <div className="relative w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <Input
                      placeholder="Search FAQs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs border-gray-200"
                      data-testid="input-search-faq"
                    />
                  </div>
                </div>
                {/* Category filter pills */}
                <div className="flex gap-2 flex-wrap mt-3">
                  {["All", ...faqCategories].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFaqCategory(cat)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        faqCategory === cat
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-white text-gray-600 border-gray-200 hover:border-primary/50 hover:text-primary"
                      }`}
                    >
                      {cat}
                      {cat !== "All" && (
                        <span className={`ml-1 ${faqCategory === cat ? "text-indigo-200" : "text-gray-400"}`}>
                          ({faqs.filter(f => f.category === cat).length})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="space-y-2">
                  {filteredFaqs.map((faq, index) => (
                    <AccordionItem
                      key={index}
                      value={`faq-${index}`}
                      className="border border-gray-200 rounded-xl px-4 bg-white"
                    >
                      <AccordionTrigger className="text-left hover:no-underline py-3.5">
                        <div className="flex items-start gap-3 pr-2">
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-indigo-200 text-indigo-600 bg-indigo-50 flex-shrink-0 mt-0.5">
                            {faq.category}
                          </Badge>
                          <span className="text-sm font-medium text-gray-900">{faq.question}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-gray-600 pb-4 leading-relaxed pl-1">
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                {filteredFaqs.length === 0 && (
                  <div className="text-center py-10 text-gray-400">
                    <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No matching questions found</p>
                    <p className="text-xs mt-1">Try a different search term or category</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CONTACT SUPPORT */}
            <Card className="border border-gray-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-indigo-500" />
                  Contact Support
                </CardTitle>
                <CardDescription className="text-xs">Need more help? Reach out to our team</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <div className="flex items-center gap-3 mb-2">
                      <Mail className="w-4 h-4 text-indigo-500" />
                      <p className="font-semibold text-gray-900 text-sm">Email Support</p>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">Get help via email within 24 hours. Include your project name and a screenshot if possible.</p>
                    <Button variant="outline" size="sm" className="text-xs border-gray-200" data-testid="button-email-support">
                      <Mail className="w-3.5 h-3.5 mr-1.5" />
                      Send Email
                    </Button>
                  </div>
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <div className="flex items-center gap-3 mb-2">
                      <ExternalLink className="w-4 h-4 text-indigo-500" />
                      <p className="font-semibold text-gray-900 text-sm">Full Documentation</p>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">Browse the complete NAT 2.0 knowledge base including API reference, release notes, and architecture docs.</p>
                    <Button variant="outline" size="sm" className="text-xs border-gray-200" data-testid="button-view-docs">
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      View Docs
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

        </div>
      </main>

      {/* ── FEATURE DOC DRAWER ── */}
      <Dialog open={!!activeDocFeature} onOpenChange={(open) => { if (!open) setActiveDocFeature(null); }}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0" data-testid="dialog-feature-doc">
          {activeDocFeature && (
            <>
              {/* Drawer header */}
              <div className={`p-5 border-b border-gray-100 ${activeDocFeature.bgColor} rounded-t-xl`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center`}>
                      <activeDocFeature.icon className={`w-5 h-5 ${activeDocFeature.color}`} />
                    </div>
                    <div>
                      <DialogTitle className="text-base font-bold text-gray-900 mb-0.5">
                        {activeDocFeature.title}
                      </DialogTitle>
                      <p className="text-xs text-gray-500">{activeDocFeature.description}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs border-gray-300 text-gray-600 bg-white/60">
                    {activeDocFeature.badgeLabel}
                  </Badge>
                </div>
              </div>

              {/* Drawer body */}
              <ScrollArea className="flex-1 overflow-auto">
                <div className="p-6 space-y-4">
                  {activeDocFeature.sections.map((section, i) => (
                    <DocSectionRenderer key={i} section={section} />
                  ))}
                </div>
              </ScrollArea>

              {/* Drawer footer */}
              <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex items-center justify-between">
                <p className="text-xs text-gray-400">NAT 2.0 Documentation · {activeDocFeature.title}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveDocFeature(null)}
                  className="text-xs border-gray-200"
                >
                  Close
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── VIDEO MODAL ── */}
      <Dialog open={showVideoModal} onOpenChange={(open) => {
        setShowVideoModal(open);
        if (!open) setPlaybackSpeed(1);
      }}>
        <DialogContent className="max-w-4xl w-full" data-testid="dialog-product-tour">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-indigo-500" />
                Platform Tour
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 mr-1">Speed:</span>
                {playbackSpeeds.map((speed) => (
                  <Button
                    key={speed.value}
                    size="sm"
                    variant={playbackSpeed === speed.value ? "default" : "outline"}
                    onClick={() => setPlaybackSpeed(speed.value)}
                    data-testid={`button-speed-${speed.label}`}
                    className="px-2.5 py-1 h-7 text-xs"
                    style={playbackSpeed === speed.value ? { background: "#4f46e5" } : {}}
                  >
                    {speed.label}
                  </Button>
                ))}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={productTourVideo}
              controls
              autoPlay
              className="w-full h-full"
              data-testid="video-product-tour"
              onLoadedMetadata={() => {
                if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
