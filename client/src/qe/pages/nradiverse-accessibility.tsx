import { useState, useEffect, useRef, useCallback } from "react";
import { pdf } from '@react-pdf/renderer';
import { AccessibilityReportPDF } from '@/components/accessibility-report-pdf';
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AccessibilityViolation, WCAGCriterion } from "@shared/qe-schema";
import { 
  Accessibility, 
  Play,
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Download,
  Eye,
  Keyboard,
  Palette,
  Volume2,
  Shield,
  FileText,
  ExternalLink,
  Info,
  Brain,
  Clock,
  Lightbulb,
  Target,
  Wrench,
  History,
  Trash2,
  X,
  ChevronRight
} from "lucide-react";

interface AccessibilityAIAnalysis {
  summary: string;
  prioritizedIssues: {
    issue: string;
    impact: string;
    affectedUsers: string;
    remediation: string;
    codeExample?: string;
  }[];
  complianceStatus: {
    wcag21AA: boolean;
    section508: boolean;
    adaCompliance: boolean;
  };
  recommendations: string[];
  estimatedFixTime: string;
}

const wcagPrinciples = [
  { id: "perceivable", name: "Perceivable", icon: Eye, color: "text-violet-400", bgColor: "bg-violet-500/20" },
  { id: "operable", name: "Operable", icon: Keyboard, color: "text-cyan-400", bgColor: "bg-cyan-500/20" },
  { id: "understandable", name: "Understandable", icon: FileText, color: "text-emerald-400", bgColor: "bg-emerald-500/20" },
  { id: "robust", name: "Robust", icon: Shield, color: "text-amber-400", bgColor: "bg-amber-500/20" },
];

const sampleViolations: AccessibilityViolation[] = [
  {
    id: "color-contrast",
    impact: "serious",
    description: "Elements must have sufficient color contrast",
    help: "Ensure the contrast ratio between the foreground and background colors is at least 4.5:1 for normal text and 3:1 for large text.",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.4/color-contrast",
    tags: ["wcag2aa", "wcag143"],
    nodes: [
      { html: '<p class="subtitle">Low contrast text</p>', target: [".subtitle"], failureSummary: "Element has insufficient color contrast of 2.5:1 (foreground: #888, background: #fff). Expected 4.5:1." }
    ]
  },
  {
    id: "image-alt",
    impact: "critical",
    description: "Images must have alternate text",
    help: "All images must have an alt attribute that describes the image content.",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.4/image-alt",
    tags: ["wcag2a", "wcag111"],
    nodes: [
      { html: '<img src="logo.png">', target: ["img.logo"], failureSummary: "Element has no alt attribute" }
    ]
  },
  {
    id: "label",
    impact: "critical",
    description: "Form elements must have labels",
    help: "Ensure every form element has a corresponding label.",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.4/label",
    tags: ["wcag2a", "wcag412"],
    nodes: [
      { html: '<input type="text" name="search">', target: ["input[name='search']"], failureSummary: "Form element does not have an associated label" }
    ]
  }
];

const sampleWCAGCriteria: WCAGCriterion[] = [
  { id: "1.1.1", level: "A", principle: "perceivable", status: "fail", violations: 2 },
  { id: "1.3.1", level: "A", principle: "perceivable", status: "pass" },
  { id: "1.4.3", level: "AA", principle: "perceivable", status: "fail", violations: 5 },
  { id: "1.4.11", level: "AA", principle: "perceivable", status: "pass" },
  { id: "2.1.1", level: "A", principle: "operable", status: "pass" },
  { id: "2.1.2", level: "A", principle: "operable", status: "pass" },
  { id: "2.4.3", level: "A", principle: "operable", status: "incomplete" },
  { id: "2.4.6", level: "AA", principle: "operable", status: "pass" },
  { id: "3.1.1", level: "A", principle: "understandable", status: "pass" },
  { id: "3.2.1", level: "A", principle: "understandable", status: "pass" },
  { id: "3.3.1", level: "A", principle: "understandable", status: "fail", violations: 1 },
  { id: "4.1.1", level: "A", principle: "robust", status: "pass" },
  { id: "4.1.2", level: "A", principle: "robust", status: "fail", violations: 3 },
];

interface WCAGTestCase {
  id: string;
  criterion: string;
  level: "A" | "AA";
  principle: "perceivable" | "operable" | "understandable" | "robust";
  name: string;
  description: string;
  testProcedure: string[];
  expectedResult: string;
  automatable: boolean;
  tools: string[];
}

const wcagAATestCases: WCAGTestCase[] = [
  {
    id: "TC-1.1.1-01",
    criterion: "1.1.1",
    level: "A",
    principle: "perceivable",
    name: "Non-text Content - Images",
    description: "All images must have appropriate alt text that describes the image content",
    testProcedure: [
      "Identify all <img> elements on the page",
      "Check each image for an alt attribute",
      "Verify alt text accurately describes the image",
      "For decorative images, verify alt=\"\" is used"
    ],
    expectedResult: "All images have appropriate alt text or are marked as decorative",
    automatable: true,
    tools: ["axe-core", "WAVE", "Claude Vision AI"]
  },
  {
    id: "TC-1.1.1-02",
    criterion: "1.1.1",
    level: "A",
    principle: "perceivable",
    name: "Non-text Content - Icons",
    description: "Icons conveying information must have text alternatives",
    testProcedure: [
      "Identify all icon elements (SVG, icon fonts)",
      "Check for aria-label or aria-labelledby",
      "Verify screen readers announce the icon purpose"
    ],
    expectedResult: "All informative icons have accessible names",
    automatable: true,
    tools: ["axe-core", "Screen reader"]
  },
  {
    id: "TC-1.3.1-01",
    criterion: "1.3.1",
    level: "A",
    principle: "perceivable",
    name: "Info and Relationships - Headings",
    description: "Content structure must be programmatically determinable through proper heading hierarchy",
    testProcedure: [
      "Check heading elements (h1-h6) are used",
      "Verify heading levels don't skip (h1->h3)",
      "Ensure headings accurately describe content",
      "Check only one h1 exists per page"
    ],
    expectedResult: "Headings follow proper hierarchy without skipping levels",
    automatable: true,
    tools: ["axe-core", "HeadingsMap extension"]
  },
  {
    id: "TC-1.3.1-02",
    criterion: "1.3.1",
    level: "A",
    principle: "perceivable",
    name: "Info and Relationships - Form Labels",
    description: "Form inputs must be programmatically associated with labels",
    testProcedure: [
      "Check each form input has a label",
      "Verify label for= matches input id",
      "Or verify aria-labelledby is used correctly"
    ],
    expectedResult: "All form inputs are properly labeled",
    automatable: true,
    tools: ["axe-core", "WAVE"]
  },
  {
    id: "TC-1.3.1-03",
    criterion: "1.3.1",
    level: "A",
    principle: "perceivable",
    name: "Info and Relationships - Tables",
    description: "Data tables must have proper header cells and associations",
    testProcedure: [
      "Identify all data tables",
      "Check for <th> elements in headers",
      "Verify scope attribute is used",
      "Check for caption if needed"
    ],
    expectedResult: "Data tables are properly structured with headers",
    automatable: true,
    tools: ["axe-core", "Table Inspector"]
  },
  {
    id: "TC-1.4.1-01",
    criterion: "1.4.1",
    level: "A",
    principle: "perceivable",
    name: "Use of Color",
    description: "Color must not be the only means of conveying information",
    testProcedure: [
      "Identify elements using color to convey info",
      "Verify additional indicators exist (icons, text, patterns)",
      "Test with grayscale simulation",
      "Check error/success states"
    ],
    expectedResult: "Information is conveyed through multiple means, not just color",
    automatable: false,
    tools: ["Claude Vision AI", "Colorblind simulator"]
  },
  {
    id: "TC-1.4.3-01",
    criterion: "1.4.3",
    level: "AA",
    principle: "perceivable",
    name: "Contrast (Minimum) - Normal Text",
    description: "Normal text must have contrast ratio of at least 4.5:1",
    testProcedure: [
      "Identify all normal text elements (<18pt or <14pt bold)",
      "Calculate contrast ratio for each",
      "Verify ratio meets 4.5:1 minimum",
      "Check text on images/gradients"
    ],
    expectedResult: "All normal text has 4.5:1 contrast ratio or higher",
    automatable: true,
    tools: ["axe-core", "Color Contrast Analyzer", "Claude Vision AI"]
  },
  {
    id: "TC-1.4.3-02",
    criterion: "1.4.3",
    level: "AA",
    principle: "perceivable",
    name: "Contrast (Minimum) - Large Text",
    description: "Large text (18pt+ or 14pt+ bold) must have contrast ratio of at least 3:1",
    testProcedure: [
      "Identify large text elements (>=18pt or >=14pt bold)",
      "Calculate contrast ratio",
      "Verify ratio meets 3:1 minimum"
    ],
    expectedResult: "All large text has 3:1 contrast ratio or higher",
    automatable: true,
    tools: ["axe-core", "Color Contrast Analyzer"]
  },
  {
    id: "TC-1.4.4-01",
    criterion: "1.4.4",
    level: "AA",
    principle: "perceivable",
    name: "Resize Text",
    description: "Text can be resized up to 200% without loss of content or functionality",
    testProcedure: [
      "Zoom page to 200%",
      "Check all text remains visible",
      "Verify no content overlap",
      "Ensure functionality remains usable"
    ],
    expectedResult: "All content readable and functional at 200% zoom",
    automatable: false,
    tools: ["Browser zoom", "Claude Vision AI"]
  },
  {
    id: "TC-1.4.10-01",
    criterion: "1.4.10",
    level: "AA",
    principle: "perceivable",
    name: "Reflow",
    description: "Content can reflow at 320px width without horizontal scrolling",
    testProcedure: [
      "Set viewport to 320px width",
      "Check for horizontal scrolling",
      "Verify all content is accessible",
      "Test interactive elements"
    ],
    expectedResult: "No horizontal scrolling required at 320px width",
    automatable: false,
    tools: ["Browser DevTools", "Responsive test tool"]
  },
  {
    id: "TC-1.4.11-01",
    criterion: "1.4.11",
    level: "AA",
    principle: "perceivable",
    name: "Non-text Contrast",
    description: "UI components and graphical objects must have 3:1 contrast",
    testProcedure: [
      "Identify buttons, inputs, icons",
      "Calculate contrast against background",
      "Check focus indicators",
      "Verify graphical objects have sufficient contrast"
    ],
    expectedResult: "All UI components have 3:1 contrast ratio",
    automatable: true,
    tools: ["axe-core", "Claude Vision AI"]
  },
  {
    id: "TC-1.4.12-01",
    criterion: "1.4.12",
    level: "AA",
    principle: "perceivable",
    name: "Text Spacing",
    description: "Text remains readable when line height, letter/word spacing are increased",
    testProcedure: [
      "Apply 1.5x line height",
      "Apply 0.12em letter spacing",
      "Apply 0.16em word spacing",
      "Verify no content loss"
    ],
    expectedResult: "Text readable with increased spacing settings",
    automatable: false,
    tools: ["Text Spacing bookmarklet"]
  },
  {
    id: "TC-2.1.1-01",
    criterion: "2.1.1",
    level: "A",
    principle: "operable",
    name: "Keyboard - All Functionality",
    description: "All functionality must be operable via keyboard",
    testProcedure: [
      "Tab through all interactive elements",
      "Verify all elements are reachable",
      "Test Enter/Space for activation",
      "Check arrow key navigation where appropriate"
    ],
    expectedResult: "All functionality accessible via keyboard",
    automatable: false,
    tools: ["Keyboard testing", "axe-core"]
  },
  {
    id: "TC-2.1.2-01",
    criterion: "2.1.2",
    level: "A",
    principle: "operable",
    name: "No Keyboard Trap",
    description: "Keyboard focus must not become trapped in any element",
    testProcedure: [
      "Tab through page elements",
      "Enter modals/dialogs",
      "Verify ability to exit",
      "Check custom widgets"
    ],
    expectedResult: "Focus can always be moved away from any element",
    automatable: false,
    tools: ["Keyboard testing"]
  },
  {
    id: "TC-2.4.3-01",
    criterion: "2.4.3",
    level: "A",
    principle: "operable",
    name: "Focus Order",
    description: "Focus order must follow a logical reading sequence",
    testProcedure: [
      "Tab through page elements",
      "Verify order matches visual layout",
      "Check dynamically added content",
      "Test modal dialogs"
    ],
    expectedResult: "Focus order is logical and predictable",
    automatable: false,
    tools: ["Keyboard testing"]
  },
  {
    id: "TC-2.4.4-01",
    criterion: "2.4.4",
    level: "A",
    principle: "operable",
    name: "Link Purpose (In Context)",
    description: "Link purpose must be determinable from link text or context",
    testProcedure: [
      "Identify all links",
      "Check link text is descriptive",
      "Avoid 'click here', 'read more'",
      "Verify programmatic context if needed"
    ],
    expectedResult: "All links have clear, descriptive text",
    automatable: true,
    tools: ["axe-core", "WAVE"]
  },
  {
    id: "TC-2.4.6-01",
    criterion: "2.4.6",
    level: "AA",
    principle: "operable",
    name: "Headings and Labels",
    description: "Headings and labels must describe topic or purpose",
    testProcedure: [
      "Review all headings for clarity",
      "Check form labels are descriptive",
      "Verify headings match content",
      "Test with screen reader"
    ],
    expectedResult: "All headings and labels are descriptive",
    automatable: false,
    tools: ["Manual review", "Screen reader"]
  },
  {
    id: "TC-2.4.7-01",
    criterion: "2.4.7",
    level: "AA",
    principle: "operable",
    name: "Focus Visible",
    description: "Keyboard focus indicator must be visible",
    testProcedure: [
      "Tab through all focusable elements",
      "Verify focus indicator is visible",
      "Check indicator has sufficient contrast",
      "Test in both light/dark modes"
    ],
    expectedResult: "All focusable elements have visible focus indicator",
    automatable: true,
    tools: ["Claude Vision AI", "Keyboard testing"]
  },
  {
    id: "TC-3.1.1-01",
    criterion: "3.1.1",
    level: "A",
    principle: "understandable",
    name: "Language of Page",
    description: "The default language of the page must be programmatically identified",
    testProcedure: [
      "Check <html> element for lang attribute",
      "Verify language code is valid",
      "Check lang matches content language"
    ],
    expectedResult: "HTML element has valid lang attribute",
    automatable: true,
    tools: ["axe-core", "WAVE"]
  },
  {
    id: "TC-3.2.1-01",
    criterion: "3.2.1",
    level: "A",
    principle: "understandable",
    name: "On Focus",
    description: "Receiving focus must not cause unexpected context change",
    testProcedure: [
      "Tab to each focusable element",
      "Verify no automatic form submissions",
      "Check no unexpected navigation",
      "Ensure no popup windows on focus"
    ],
    expectedResult: "No context changes occur on focus alone",
    automatable: false,
    tools: ["Keyboard testing"]
  },
  {
    id: "TC-3.2.2-01",
    criterion: "3.2.2",
    level: "A",
    principle: "understandable",
    name: "On Input",
    description: "Changing form settings must not cause unexpected context change",
    testProcedure: [
      "Test form inputs and select elements",
      "Verify no auto-submit on change",
      "Check checkboxes/radios behavior",
      "Ensure user-initiated submission"
    ],
    expectedResult: "No unexpected context changes on input",
    automatable: false,
    tools: ["Manual testing"]
  },
  {
    id: "TC-3.3.1-01",
    criterion: "3.3.1",
    level: "A",
    principle: "understandable",
    name: "Error Identification",
    description: "Form errors must be identified and described in text",
    testProcedure: [
      "Submit forms with invalid data",
      "Check error messages are displayed",
      "Verify errors identify the field",
      "Ensure errors are perceivable"
    ],
    expectedResult: "All form errors are clearly identified in text",
    automatable: false,
    tools: ["Manual testing", "Screen reader"]
  },
  {
    id: "TC-3.3.2-01",
    criterion: "3.3.2",
    level: "A",
    principle: "understandable",
    name: "Labels or Instructions",
    description: "Labels or instructions are provided for user input",
    testProcedure: [
      "Check all form fields have labels",
      "Verify required fields are indicated",
      "Check format instructions are provided",
      "Test with screen reader"
    ],
    expectedResult: "All inputs have clear labels and instructions",
    automatable: true,
    tools: ["axe-core", "Manual review"]
  },
  {
    id: "TC-3.3.3-01",
    criterion: "3.3.3",
    level: "AA",
    principle: "understandable",
    name: "Error Suggestion",
    description: "Error messages provide suggestions for correction when possible",
    testProcedure: [
      "Trigger form validation errors",
      "Check for helpful error suggestions",
      "Verify format examples are provided",
      "Test different error scenarios"
    ],
    expectedResult: "Error messages include correction suggestions",
    automatable: false,
    tools: ["Manual testing"]
  },
  {
    id: "TC-4.1.1-01",
    criterion: "4.1.1",
    level: "A",
    principle: "robust",
    name: "Parsing",
    description: "HTML must be well-formed without duplicate IDs or improper nesting",
    testProcedure: [
      "Run HTML validator",
      "Check for duplicate IDs",
      "Verify proper element nesting",
      "Check for complete start/end tags"
    ],
    expectedResult: "HTML is well-formed and valid",
    automatable: true,
    tools: ["axe-core", "W3C Validator"]
  },
  {
    id: "TC-4.1.2-01",
    criterion: "4.1.2",
    level: "A",
    principle: "robust",
    name: "Name, Role, Value",
    description: "Custom UI components must have accessible name, role, and value",
    testProcedure: [
      "Identify custom widgets",
      "Check ARIA roles are appropriate",
      "Verify accessible names exist",
      "Check state changes are announced"
    ],
    expectedResult: "All custom components have proper ARIA attributes",
    automatable: true,
    tools: ["axe-core", "Screen reader"]
  }
];

export default function NRadiVerseAccessibilityPage() {
  const [activeTab, setActiveTab] = useState("scan");
  const [scanUrl, setScanUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [violations, setViolations] = useState<AccessibilityViolation[]>([]);
  const [wcagCriteria, setWcagCriteria] = useState<WCAGCriterion[]>([]);
  const [overallScore, setOverallScore] = useState(0);
  const [aiAnalysis, setAiAnalysis] = useState<AccessibilityAIAnalysis | null>(null);
  const [scanMetadata, setScanMetadata] = useState<{ browser: string; scanDuration: number; axeVersion: string } | null>(null);
  // Enhanced scan state
  const [screenReaderResult, setScreenReaderResult] = useState<any>(null);
  const [visualTestResult, setVisualTestResult] = useState<any>(null);
  const [agentStates, setAgentStates] = useState<Record<string, { status: string; message: string; progress: number }>>({});
  const [scanMode, setScanMode] = useState<"standard" | "enhanced">("enhanced");
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();

  // Fetch scan history
  const { data: historyData, refetch: refetchHistory } = useQuery<{ success: boolean; scans: any[] }>({
    queryKey: ["/api/nradiverse/accessibility-scan/history"],
    enabled: showHistory,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const { toast } = useToast();

  // Cleanup SSE on unmount
  useEffect(() => () => { eventSourceRef.current?.close(); }, []);

  const runAccessibilityScan = async () => {
    if (!scanUrl) {
      toast({ title: "Missing URL", description: "Please enter a URL to scan.", variant: "destructive" });
      return;
    }

    setIsScanning(true);
    setScanComplete(false);
    setAiAnalysis(null);
    setScreenReaderResult(null);
    setVisualTestResult(null);
    setAgentStates({});

    if (scanMode === "enhanced") {
      // SSE-based enhanced scan with agents
      const es = new EventSource(
        `/api/nradiverse/accessibility-scan/stream?url=${encodeURIComponent(scanUrl)}&wcagLevel=AA&phases=axe,screenreader,visual`
      );
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "final_result") {
            // Final aggregated result
            if (data.data?.axeResult) {
              setViolations(data.data.axeResult.violations || []);
              setWcagCriteria(data.data.axeResult.wcagCriteria || []);
              setOverallScore(data.data.combinedScore || data.data.axeResult.overallScore || 0);
              setAiAnalysis(data.data.axeResult.aiAnalysis || null);
              setScanMetadata(data.data.axeResult.metadata || null);
            }
            if (data.data?.screenReaderResult) setScreenReaderResult(data.data.screenReaderResult);
            if (data.data?.visualTestResult) setVisualTestResult(data.data.visualTestResult);
          } else if (data.agent) {
            // Agent progress update
            setAgentStates((prev) => ({
              ...prev,
              [data.agent]: { status: data.status, message: data.message, progress: data.progress || 0 },
            }));
            // Merge intermediate data
            if (data.agent === "axe-scanner" && data.status === "completed" && data.data) {
              setViolations(data.data.violations || []);
              setWcagCriteria(data.data.wcagCriteria || []);
              setOverallScore(data.data.overallScore || 0);
              setAiAnalysis(data.data.aiAnalysis || null);
              setScanMetadata(data.data.metadata || null);
            }
            if (data.agent === "screen-reader" && data.status === "completed" && data.data) {
              setScreenReaderResult(data.data);
            }
            if (data.agent === "visual-tester" && data.status === "completed" && data.data) {
              setVisualTestResult(data.data);
            }
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };

      es.addEventListener("complete", () => {
        es.close();
        setScanComplete(true);
        setIsScanning(false);
        toast({ title: "Enhanced Scan Complete", description: "All accessibility agents finished" });
      });

      es.onerror = () => {
        es.close();
        setScanComplete(true);
        setIsScanning(false);
      };
    } else {
      // Standard scan (existing behavior)
      try {
        const response = await fetch("/api/nradiverse/accessibility-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: scanUrl, wcagLevel: "AA" }),
        });
        if (response.ok) {
          const result = await response.json();
          setViolations(result.violations || []);
          setWcagCriteria(result.wcagCriteria || []);
          setOverallScore(result.overallScore || 0);
          setAiAnalysis(result.aiAnalysis || null);
          setScanMetadata(result.metadata || null);
          toast({ title: "Scan Complete", description: `Found ${result.violations?.length || 0} accessibility issues` });
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || "Scan failed");
        }
      } catch (error: any) {
        console.error("Accessibility scan error:", error);
        toast({ title: "Scan Failed", description: error.message, variant: "destructive" });
        setViolations(sampleViolations);
        setWcagCriteria(sampleWCAGCriteria);
        setOverallScore(76);
      }
      setScanComplete(true);
      setIsScanning(false);
    }
  };

  const loadHistoryScan = async (scanId: string) => {
    try {
      const res = await fetch(`/api/nradiverse/accessibility-scan/history/${scanId}`);
      const data = await res.json();
      if (data.success && data.scan) {
        const s = data.scan;
        setScanUrl(s.url);
        setViolations(s.violations || []);
        setWcagCriteria(s.wcagCriteria || []);
        setOverallScore(s.overallScore || 0);
        setAiAnalysis(s.aiAnalysis || null);
        setScanMetadata(s.metadata || null);
        setScreenReaderResult(s.screenReaderResult || null);
        setVisualTestResult(s.visualTestResult || null);
        setScanComplete(true);
        setIsScanning(false);
        setShowHistory(false);
        // Set all agents to done for display
        const agentIds = ["axe-scanner", "screen-reader", "heading-checker", "landmark-checker", "focus-tester", "visual-tester", "ai-analyzer"];
        const doneStates: Record<string, any> = {};
        agentIds.forEach(id => { doneStates[id] = { status: "completed", message: "Loaded from history", progress: 100 }; });
        setAgentStates(doneStates);
        toast({ title: "Scan Loaded", description: `Loaded results for ${s.url}` });
      }
    } catch (err: any) {
      toast({ title: "Load Failed", description: err.message, variant: "destructive" });
    }
  };

  const deleteHistoryScan = async (scanId: string) => {
    try {
      await fetch(`/api/nradiverse/accessibility-scan/history/${scanId}`, { method: "DELETE" });
      refetchHistory();
      toast({ title: "Deleted", description: "Scan removed from history" });
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    }
  };

  // Also refetch history after scan completes
  useEffect(() => {
    if (scanComplete && showHistory) refetchHistory();
  }, [scanComplete]);

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "critical": return "text-red-400 bg-red-500/20 border-red-500/50";
      case "serious": return "text-orange-400 bg-orange-500/20 border-orange-500/50";
      case "moderate": return "text-amber-400 bg-amber-500/20 border-amber-500/50";
      default: return "text-blue-400 bg-blue-500/20 border-blue-500/50";
    }
  };

  const criticalCount = violations.filter(v => v.impact === "critical").length;
  const seriousCount = violations.filter(v => v.impact === "serious").length;
  const moderateCount = violations.filter(v => v.impact === "moderate").length;
  const minorCount = violations.filter(v => v.impact === "minor").length;

  // Agent definitions for the pipeline
  const AGENTS = [
    { id: "axe-scanner", name: "Axe Scanner", icon: Shield, color: "#8b5cf6", desc: "WCAG 2.1 AA violations" },
    { id: "screen-reader", name: "Screen Reader", icon: Volume2, color: "#06b6d4", desc: "What blind users hear" },
    { id: "heading-checker", name: "Headings", icon: FileText, color: "#10b981", desc: "H1→H2→H3 hierarchy" },
    { id: "landmark-checker", name: "Landmarks", icon: Target, color: "#f59e0b", desc: "nav/main/footer structure" },
    { id: "focus-tester", name: "Focus Order", icon: Keyboard, color: "#3b82f6", desc: "Tab key navigation" },
    { id: "visual-tester", name: "Visual Tests", icon: Eye, color: "#f43f5e", desc: "Contrast, resize, reflow" },
    { id: "ai-analyzer", name: "AI Analysis", icon: Brain, color: "#a855f7", desc: "Claude Vision audit" },
  ];

  const totalIssues = criticalCount + seriousCount + moderateCount + minorCount;
  const srIssues = screenReaderResult?.issueCount || 0;
  const vtFails = visualTestResult?.failCount || 0;
  const allIssues = totalIssues + srIssues + vtFails;

  return (
    <>
      <DashboardHeader />

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">

            {/* ─── HEADER ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 shadow-lg shadow-emerald-500/10">
                    <Accessibility className="w-7 h-7 text-emerald-400" />
                  </div>
                  Accessibility Compliance
                </h1>
                <p className="text-muted-foreground mt-1">
                  WCAG 2.1 Level AA • Screen Reader Simulation • Visual Accessibility Tests
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => { setShowHistory(!showHistory); if (!showHistory) refetchHistory(); }}>
                  <History className="w-4 h-4 mr-2" />
                  {showHistory ? "Hide History" : "View History"}
                </Button>
                {scanComplete && (
                  <Button variant="outline" onClick={async () => {
                    try {
                      toast({ title: "Generating PDF...", description: "Please wait" });
                      const doc = <AccessibilityReportPDF
                        url={scanUrl}
                        overallScore={overallScore}
                        violations={violations}
                        wcagCriteria={wcagCriteria}
                        screenReaderResult={screenReaderResult}
                        visualTestResult={visualTestResult}
                        aiAnalysis={aiAnalysis}
                        generatedAt={new Date().toLocaleString()}
                      />;
                      const blob = await pdf(doc).toBlob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `accessibility-report-${new Date().toISOString().slice(0, 10)}.pdf`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast({ title: "Report Downloaded", description: "PDF saved to your downloads" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
                    }
                  }}>
                    <Download className="w-4 h-4 mr-2" />
                    Export Report
                  </Button>
                )}
              </div>
            </div>

            {/* ─── HISTORY PANEL ──────────────────────────────────── */}
            {showHistory && (
              <Card className="border-blue-500/20 bg-blue-500/5">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="w-5 h-5 text-blue-400" />
                      Scan History
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {!historyData?.scans?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No scan history yet. Run a scan to see results here.</p>
                  ) : (
                    <ScrollArea className="h-[250px]">
                      <div className="space-y-2">
                        {historyData.scans.map((scan: any) => {
                          const scoreColor = scan.overallScore >= 80 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" :
                            scan.overallScore >= 50 ? "text-amber-400 border-amber-500/30 bg-amber-500/10" :
                            "text-red-400 border-red-500/30 bg-red-500/10";
                          return (
                            <div key={scan.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                              {/* Score badge */}
                              <div className={`w-12 h-12 rounded-lg flex items-center justify-center border ${scoreColor} flex-shrink-0`}>
                                <span className="text-lg font-bold">{scan.overallScore || 0}</span>
                              </div>
                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate">{scan.url}</p>
                                <p className="text-xs text-muted-foreground">
                                  {scan.violationsCount || 0} violations
                                  {scan.criticalCount > 0 && <span className="text-red-400"> • {scan.criticalCount} critical</span>}
                                  {scan.seriousCount > 0 && <span className="text-orange-400"> • {scan.seriousCount} serious</span>}
                                  <span className="ml-2">• {new Date(scan.createdAt).toLocaleString()}</span>
                                </p>
                              </div>
                              {/* Actions */}
                              <div className="flex gap-1 flex-shrink-0">
                                <Button variant="outline" size="sm" onClick={() => loadHistoryScan(scan.id)}>
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteHistoryScan(scan.id)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ─── SCAN INPUT ─────────────────────────────────────── */}
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1">Website URL</Label>
                    <Input
                      placeholder="https://apple.com"
                      value={scanUrl}
                      onChange={(e) => setScanUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runAccessibilityScan()}
                      className="h-11"
                    />
                  </div>
                  <Button onClick={runAccessibilityScan} disabled={isScanning} className="h-11 px-8 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700">
                    {isScanning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    {isScanning ? "Scanning..." : "Run Scan"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ─── AGENT PIPELINE — HORIZONTAL CARDS WITH CONNECTORS ─── */}
            {(isScanning || scanComplete) && (
              <div className="space-y-3">
                {/* Pipeline row */}
                <div className="flex items-stretch gap-0">
                  {AGENTS.map((agent, idx) => {
                    const state = agentStates[agent.id] || { status: "idle", message: "", progress: 0 };
                    const isActive = state.status === "working";
                    const isDone = state.status === "completed" || state.status === "complete" || state.status === "done";
                    const isError = state.status === "error";
                    const Icon = agent.icon;
                    const pct = isDone ? 100 : state.progress;

                    return (
                      <div key={agent.id} className="flex items-center" style={{ flex: 1 }}>
                        {/* Agent card */}
                        <div className={`relative flex-1 rounded-xl border-2 p-3 transition-all duration-500 ${
                          isDone ? "border-emerald-500/40 bg-emerald-500/5" :
                          isActive ? "border-transparent bg-card shadow-xl" :
                          isError ? "border-red-500/40 bg-red-500/5" :
                          "border-transparent bg-muted/20 opacity-50"
                        }`}
                        style={isActive ? { borderColor: agent.color + '60', boxShadow: `0 0 24px ${agent.color}20` } : {}}>

                          {/* Animated top progress bar */}
                          <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl overflow-hidden bg-muted/20">
                            <div
                              className="h-full rounded-full transition-all duration-700 ease-out"
                              style={{
                                width: `${pct}%`,
                                background: isDone ? '#10b981' : isError ? '#ef4444' : agent.color,
                              }}
                            />
                          </div>

                          {/* Spinning indicator for active */}
                          {isActive && (
                            <div className="absolute -top-1 -right-1 w-5 h-5">
                              <svg className="w-full h-full animate-spin" style={{ animationDuration: "1.5s" }} viewBox="0 0 20 20">
                                <circle cx="10" cy="10" r="8" fill="none" stroke={agent.color} strokeWidth="2" strokeDasharray="12 38" strokeLinecap="round" />
                              </svg>
                            </div>
                          )}

                          <div className="flex items-center gap-2.5">
                            {/* Icon */}
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                              isDone ? "bg-emerald-500/15" :
                              isActive ? "bg-white/10" :
                              isError ? "bg-red-500/15" :
                              "bg-muted/30"
                            }`} style={isActive ? { background: agent.color + '15' } : {}}>
                              {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                               isError ? <XCircle className="w-4 h-4 text-red-400" /> :
                               <Icon className="w-4 h-4" style={{ color: isActive ? agent.color : '#64748b' }} />}
                            </div>
                            {/* Text */}
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold truncate" style={{ color: isDone ? '#10b981' : isActive ? agent.color : '#94a3b8' }}>
                                {agent.name}
                              </p>
                              <p className="text-[9px] text-muted-foreground truncate">
                                {isActive ? `${Math.round(pct)}%` : isDone ? "✓ Complete" : isError ? "✗ Failed" : agent.desc}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Connector arrow */}
                        {idx < AGENTS.length - 1 && (
                          <div className="flex items-center px-1 flex-shrink-0">
                            <div className={`w-4 h-[2px] transition-colors duration-500 ${isDone ? "bg-emerald-500/50" : "bg-muted/20"}`} />
                            <div className={`w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[5px] transition-colors duration-500 ${isDone ? "border-l-emerald-500/50" : "border-l-muted/20"}`} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Live status bar */}
                {isScanning && (
                  <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/20 border border-border/20">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <p className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {(() => {
                        const active = Object.entries(agentStates).find(([_, s]) => s.status === "working");
                        return active ? active[1].message : "Initializing agents...";
                      })()}
                    </p>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {Object.values(agentStates).filter(s => s.status === "completed" || s.status === "complete" || s.status === "done").length}/{AGENTS.length} complete
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ─── VERDICT BANNER (after scan) ────────────────────── */}
            {scanComplete && (
              <Card className={`border-2 ${allIssues === 0 ? "border-emerald-500/50 bg-emerald-500/5" : allIssues <= 5 ? "border-amber-500/50 bg-amber-500/5" : "border-red-500/50 bg-red-500/5"}`}>
                <CardContent className="p-6">
                  <div className="flex items-center gap-6">
                    {/* Score circle */}
                    <div className="relative w-20 h-20 flex-shrink-0">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" fill="none" strokeWidth="4" className="text-muted/20" stroke="currentColor" />
                        <circle cx="40" cy="40" r="35" fill="none" strokeWidth="4" strokeLinecap="round"
                          stroke={overallScore >= 80 ? "#10b981" : overallScore >= 50 ? "#f59e0b" : "#ef4444"}
                          strokeDasharray={`${(overallScore / 100) * 220} 220`} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-lg font-bold ${overallScore >= 80 ? "text-emerald-400" : overallScore >= 50 ? "text-amber-400" : "text-red-400"}`}>
                          {overallScore}
                        </span>
                      </div>
                    </div>
                    {/* Verdict text */}
                    <div className="flex-1">
                      <h2 className={`text-xl font-bold ${allIssues === 0 ? "text-emerald-400" : allIssues <= 5 ? "text-amber-400" : "text-red-400"}`}>
                        {allIssues === 0 ? "No Accessibility Issues Found" : `${allIssues} Accessibility Issues Found`}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        {criticalCount > 0 && <span className="text-red-400 font-semibold">{criticalCount} Critical</span>}
                        {criticalCount > 0 && seriousCount > 0 && " • "}
                        {seriousCount > 0 && <span className="text-orange-400 font-semibold">{seriousCount} Serious</span>}
                        {(criticalCount > 0 || seriousCount > 0) && moderateCount > 0 && " • "}
                        {moderateCount > 0 && <span className="text-amber-400">{moderateCount} Moderate</span>}
                        {srIssues > 0 && ` • ${srIssues} Screen Reader issues`}
                        {vtFails > 0 && ` • ${vtFails} Visual test failures`}
                      </p>
                    </div>
                    {/* Quick stats */}
                    <div className="flex gap-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-red-400">{criticalCount + seriousCount}</p>
                        <p className="text-[10px] text-muted-foreground">Critical+Serious</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-cyan-400">{srIssues}</p>
                        <p className="text-[10px] text-muted-foreground">Screen Reader</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-rose-400">{vtFails}</p>
                        <p className="text-[10px] text-muted-foreground">Visual Fails</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ─── RESULTS — ALL VISIBLE, NO TAB HUNTING ──────────── */}
            {scanComplete && (
              <div className="space-y-6">

                {/* Violations */}
                {violations.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-400" />
                        WCAG Violations ({violations.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px]">
                        <div className="space-y-2">
                          {violations.map((v, i) => (
                            <div key={i} className={`p-3 rounded-lg border ${getImpactColor(v.impact)}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className={`text-[10px] ${getImpactColor(v.impact)}`}>{v.impact}</Badge>
                                <span className="text-sm font-medium">{v.help || v.description}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">{v.description}</p>
                              {v.nodes?.[0] && (
                                <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 mt-2 overflow-x-auto">{v.nodes[0].html}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Screen Reader Results */}
                {screenReaderResult && (
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-7">
                      <Card>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Volume2 className="w-5 h-5 text-cyan-400" />
                              Screen Reader Transcript
                            </CardTitle>
                            <Badge variant="outline" className="text-xs">{screenReaderResult.transcript?.totalElements || 0} elements</Badge>
                          </div>
                          <CardDescription>What NVDA/JAWS users would hear navigating this page</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px]">
                            <div className="space-y-0.5 font-mono text-xs">
                              {screenReaderResult.transcript?.entries?.map((entry: any, i: number) => (
                                <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded ${entry.issues?.length ? "bg-red-500/10 border-l-2 border-red-500" : "hover:bg-muted/20"}`}
                                  style={{ paddingLeft: `${(entry.depth || 0) * 12 + 8}px` }}>
                                  {entry.landmark && <Badge variant="outline" className="text-[9px] bg-cyan-500/10 text-cyan-400 border-cyan-500/30 flex-shrink-0 py-0">{entry.landmark}</Badge>}
                                  <span className="text-muted-foreground">{entry.announcement}</span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </div>
                    <div className="col-span-5 space-y-4">
                      {/* Headings */}
                      <Card>
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm flex items-center gap-2">
                            Heading Hierarchy
                            <Badge variant={screenReaderResult.headingHierarchy?.pass ? "default" : "destructive"} className="text-[10px] ml-auto">
                              {screenReaderResult.headingHierarchy?.pass ? "✓ Pass" : "✗ Fail"}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <div className="space-y-1">
                            {screenReaderResult.headingHierarchy?.headings?.map((h: any, i: number) => (
                              <div key={i} className="flex items-center gap-1 text-xs" style={{ paddingLeft: `${(h.level - 1) * 10}px` }}>
                                <Badge variant="outline" className="text-[9px] w-6 justify-center py-0">H{h.level}</Badge>
                                <span className="text-muted-foreground truncate">{h.text}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      {/* Landmarks */}
                      <Card>
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm flex items-center gap-2">
                            Landmarks
                            <Badge variant={screenReaderResult.landmarks?.pass ? "default" : "destructive"} className="text-[10px] ml-auto">
                              {screenReaderResult.landmarks?.pass ? "✓ Pass" : `${screenReaderResult.landmarks?.missing?.length || 0} missing`}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <div className="space-y-1 text-xs">
                            {screenReaderResult.landmarks?.found?.map((l: any, i: number) => (
                              <div key={i} className="flex justify-between"><span className="text-emerald-400">✓ {l.role}</span><span className="text-muted-foreground">{l.count}×</span></div>
                            ))}
                            {screenReaderResult.landmarks?.missing?.map((m: string, i: number) => (
                              <div key={i} className="text-red-400">✗ {m} — missing</div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      {/* Focus + Links summary */}
                      <Card>
                        <CardContent className="p-4 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span>Focus Order</span>
                            <Badge variant={screenReaderResult.focusOrder?.pass ? "default" : "destructive"} className="text-[10px]">
                              {screenReaderResult.focusOrder?.issues?.length || 0} issues
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Links ({screenReaderResult.linksAnalysis?.totalLinks || 0} total)</span>
                            <Badge variant={screenReaderResult.linksAnalysis?.pass ? "default" : "destructive"} className="text-[10px]">
                              {screenReaderResult.linksAnalysis?.problematicLinks || 0} problematic
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>ARIA Validation</span>
                            <Badge variant={screenReaderResult.ariaValidation?.pass ? "default" : "destructive"} className="text-[10px]">
                              {screenReaderResult.ariaValidation?.issueCount || 0} issues
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}

                {/* Visual Tests Grid */}
                {visualTestResult && visualTestResult.tests?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Eye className="w-5 h-5 text-rose-400" />
                          Visual Accessibility Tests
                        </CardTitle>
                        <div className="flex gap-3 text-xs">
                          <span className="text-emerald-400 font-semibold">{visualTestResult.passCount} Passed</span>
                          <span className="text-red-400 font-semibold">{visualTestResult.failCount} Failed</span>
                          <span className="text-amber-400">{visualTestResult.warningCount} Warnings</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
                        {visualTestResult.tests.map((test: any) => (
                          <div key={test.testId} className={`rounded-xl border p-3 ${
                            test.status === "pass" ? "border-emerald-500/30 bg-emerald-500/5" :
                            test.status === "fail" ? "border-red-500/30 bg-red-500/5" :
                            "border-amber-500/30 bg-amber-500/5"
                          }`}>
                            {test.screenshotBase64 && (
                              <img src={`data:image/jpeg;base64,${test.screenshotBase64}`} alt={test.testName} className="w-full h-20 object-cover rounded-md mb-2 border border-border/30" />
                            )}
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold truncate">{test.testName}</span>
                              {test.status === "pass" ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> :
                               test.status === "fail" ? <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" /> :
                               <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                            </div>
                            <p className="text-[10px] text-muted-foreground">{test.wcagCriterion}</p>
                            {test.issues?.length > 0 && <p className="text-[10px] text-red-400 mt-1">{test.issues.length} issue{test.issues.length > 1 ? "s" : ""}</p>}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AI Analysis */}
                {aiAnalysis && (
                  <Card className="border-purple-500/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brain className="w-5 h-5 text-purple-400" />
                        AI Analysis
                        <Badge variant="outline" className="text-[10px] ml-2 bg-purple-500/10 text-purple-400 border-purple-500/30">Claude Vision</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">{aiAnalysis.summary}</p>
                      {aiAnalysis.prioritizedIssues?.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority Fixes</h4>
                          {aiAnalysis.prioritizedIssues.slice(0, 5).map((issue, i) => (
                            <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/30">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/30">#{i + 1}</Badge>
                                <span className="text-sm font-medium">{issue.issue}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">{issue.remediation}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

              </div>
            )}

            {/* ─── PRE-SCAN: What We Test ──────────────────────────── */}
            {!isScanning && !scanComplete && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Shield, color: "text-violet-400", bg: "bg-violet-500/10", title: "WCAG 2.1 AA", desc: "Axe-core engine with 90+ rules" },
                  { icon: Volume2, color: "text-cyan-400", bg: "bg-cyan-500/10", title: "Screen Reader Sim", desc: "Transcript of what users hear" },
                  { icon: Eye, color: "text-rose-400", bg: "bg-rose-500/10", title: "9 Visual Tests", desc: "Contrast, resize, reflow, focus" },
                  { icon: Brain, color: "text-purple-400", bg: "bg-purple-500/10", title: "AI Vision Analysis", desc: "Claude finds what tools miss" },
                ].map((card, i) => (
                  <Card key={i} className={`${card.bg} border-transparent`}>
                    <CardContent className="p-5">
                      <card.icon className={`w-8 h-8 ${card.color} mb-3`} />
                      <h4 className="font-semibold text-sm mb-1">{card.title}</h4>
                      <p className="text-xs text-muted-foreground">{card.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

        </div>
      </main>
    </>
  );
}

