import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronUp, Search, AlertCircle, Target, Zap, Upload, Download, FileJson, FileSpreadsheet, FileText, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PushToPlatform } from "@/components/push-to-platform";

interface TestStep {
  step_number: number;
  action: string;
  expected_behavior: string;
  element_label?: string;
  selector?: string;
}

interface Scenario {
  id: string;
  title: string;
  description: string;
  businessValue: string;
  category: "workflow" | "text_validation" | "functional" | "negative" | "edge_case";
  priority: "P0" | "P1" | "P2" | "P3";
  userStory: string;
  acceptanceCriteria: string[];
  relatedElements: string[];
}

interface TestCase {
  id: string;
  scenarioId?: string;
  name: string;
  description?: string;
  category?: "text_validation" | "workflow" | "functional" | "negative" | "edge_case";
  type?: string;
  objective?: string;
  given: string;
  when: string;
  then: string;
  selector?: string;
  preconditions?: string[];
  test_steps?: TestStep[];
  postconditions?: string[];
  test_data?: Record<string, any>;
  test_type?: 'Functional' | 'Negative' | 'Boundary';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  expected_elements?: string[];
  workflow?: {
    id: string;
    name: string;
    type: string;
  };
}

interface TestCasesListProps {
  scenarios?: Scenario[];
  testCases: TestCase[];
  generationProgress?: { current: number; total: number; percentage: number; message: string } | null;
  onExport?: () => void;
  onExportText?: () => void;
  onExportPlaywright?: (mode?: 'xpath' | 'cli') => void;
  isExportingPlaywright?: boolean;
}

export function TestCasesList({ scenarios = [], testCases, generationProgress, onExport, onExportText, onExportPlaywright, isExportingPlaywright }: TestCasesListProps) {
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("id");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const itemsPerPage = 10;
  const { toast } = useToast();
  
  // Categorize test cases
  const categorizedTestCases = {
    text_validation: testCases.filter(tc => tc.category === 'text_validation'),
    workflow: testCases.filter(tc => tc.category === 'workflow'),
    functional: testCases.filter(tc => tc.category === 'functional' || (!tc.category && tc.type)),
    negative: testCases.filter(tc => tc.category === 'negative'),
    edge_case: testCases.filter(tc => tc.category === 'edge_case'),
  };
  
  const categoryLabels = {
    text_validation: 'Text Validation Tests',
    workflow: 'Workflow Tests',
    functional: 'Functional Tests',
    negative: 'Negative Tests',
    edge_case: 'Edge Case Tests',
  };

  const handleExportToAdo = async (testCase: TestCase) => {
    setExportingId(testCase.id);
    
    try {
      const response = await apiRequest('POST', '/api/export/ado/single', testCase) as unknown as {
        success: boolean;
        workItemId?: number;
        url?: string;
        error?: string;
      };
      
      if (response.success) {
        const description = response.workItemId 
          ? `Test case ${testCase.id} exported to Azure DevOps. Work Item ID: ${response.workItemId}`
          : `Test case ${testCase.id} exported to Azure DevOps successfully`;
        
        toast({
          title: "Export Successful",
          description,
        });
        
        if (response.url && typeof response.url === 'string' && response.url.startsWith('http')) {
          window.open(response.url, '_blank', 'noopener,noreferrer');
        }
      } else {
        toast({
          title: "Export Failed",
          description: response.error || "Failed to export test case",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Export Error",
        description: error.message || "An error occurred while exporting",
        variant: "destructive",
      });
    } finally {
      setExportingId(null);
    }
  };

  const handleExportExcel = async () => {
    try {
      const response = await fetch('/api/export-test-cases-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testCases: testCases,
          scenarios: scenarios,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate Excel file');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `test-cases-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export Successful",
        description: `Exported ${testCases.length} test cases to Excel`,
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export to Excel",
        variant: "destructive",
      });
    }
  };

  // Reset pagination when filter/search/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchTerm, sortBy]);

  const getPriorityValue = (priority: string) => {
    switch (priority) {
      case "P0":
      case "critical": return 4;
      case "P1":
      case "high": return 3;
      case "P2":
      case "medium": return 2;
      case "P3":
      case "low": return 1;
      default: return 0;
    }
  };

  const normalizeFilter = (priority: string, filterValue: string): boolean => {
    if (filterValue === "all") return true;
    
    // Support both old and new priority formats
    const priorityMap: Record<string, string[]> = {
      "P0": ["P0", "critical"],
      "P1": ["P1", "high"],
      "P2": ["P2", "medium"],
      "P3": ["P3", "low"],
      "critical": ["P0", "critical"],
      "high": ["P1", "high"],
      "medium": ["P2", "medium"],
      "low": ["P3", "low"],
    };
    
    const validPriorities = priorityMap[filterValue] || [filterValue];
    return validPriorities.includes(priority);
  };

  const filteredCases = testCases.filter(tc => {
    if (!normalizeFilter(tc.priority, filter)) return false;
    if (searchTerm && !tc.name.toLowerCase().includes(searchTerm.toLowerCase()) && !tc.id.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  const sortedCases = [...filteredCases].sort((a, b) => {
    switch (sortBy) {
      case "id": return a.id.localeCompare(b.id);
      case "type": return (a.type || a.category || "").localeCompare(b.type || b.category || "");
      case "priority": return getPriorityValue(b.priority) - getPriorityValue(a.priority);
      case "name": return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  const totalPages = Math.ceil(sortedCases.length / itemsPerPage);
  const paginatedCases = sortedCases.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "P0":
      case "critical": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "P1":
      case "high": return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "P2":
      case "medium": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "P3":
      case "low": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "P0":
      case "critical": return <AlertCircle className="w-3 h-3 mr-1" />;
      case "P1":
      case "high": return <Zap className="w-3 h-3 mr-1" />;
      case "P2":
      case "medium": return <Target className="w-3 h-3 mr-1" />;
      default: return null;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "form_submission": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "navigation_path": return "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
      case "cta_flow": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Test Cases ({sortedCases.length})</h3>
        <div className="flex items-center gap-2">
          <PushToPlatform 
            testCases={testCases.map(tc => ({
              id: tc.id,
              name: tc.name,
              category: tc.category,
              priority: tc.priority as string,
              test_steps: tc.test_steps,
              objective: tc.objective,
            }))}
            size="sm"
            disabled={testCases.length === 0}
          />
          {onExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              data-testid="button-export-json"
              disabled={testCases.length === 0}
            >
              <FileJson className="w-4 h-4 mr-2" />
              Export JSON
            </Button>
          )}
          {onExportText && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportText}
              data-testid="button-export-text"
              disabled={testCases.length === 0}
            >
              <FileText className="w-4 h-4 mr-2" />
              Export All Test Cases
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            data-testid="button-export-excel"
            disabled={testCases.length === 0}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
          {onExportPlaywright && (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportPlaywright('xpath')}
                data-testid="button-export-playwright-xpath"
                disabled={testCases.length === 0 || isExportingPlaywright}
              >
                {isExportingPlaywright ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    XPath Script
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportPlaywright('cli')}
                data-testid="button-export-playwright-cli"
                disabled={testCases.length === 0 || isExportingPlaywright}
              >
                {isExportingPlaywright ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    CLI Script
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by ID or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-tests"
            />
          </div>
        </div>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="P0">P0 (Critical)</SelectItem>
            <SelectItem value="P1">P1 (High)</SelectItem>
            <SelectItem value="P2">P2 (Medium)</SelectItem>
            <SelectItem value="P3">P3 (Low)</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[150px]" data-testid="select-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="id">By ID</SelectItem>
            <SelectItem value="type">By Type</SelectItem>
            <SelectItem value="priority">By Priority</SelectItem>
            <SelectItem value="name">By Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Test Cases Table */}
      <div className="space-y-2">
        {paginatedCases.map((tc) => (
          <div
            key={tc.id}
            className="border border-border rounded-md overflow-hidden hover-elevate transition-all"
            data-testid={`test-case-${tc.id}`}
          >
            <div
              className="p-4 cursor-pointer flex items-start gap-4"
              onClick={() => setExpandedId(expandedId === tc.id ? null : tc.id)}
            >
              <div className="font-mono text-sm font-bold w-24 flex-shrink-0 pt-0.5" data-testid={`test-id-${tc.id}`}>
                {tc.id}
              </div>
              <div className="flex-1 min-w-0 text-sm" data-testid={`test-name-${tc.id}`}>
                {tc.name}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge className={getTypeColor(tc.type || tc.category || "functional")} data-testid={`test-type-${tc.id}`}>
                  {(tc.category || tc.type || "functional").replace('_', ' ')}
                </Badge>
                <Badge className={getPriorityColor(tc.priority)} data-testid={`test-priority-${tc.id}`}>
                  {getPriorityIcon(tc.priority)}
                  {tc.priority}
                </Badge>
                {expandedId === tc.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>

            {expandedId === tc.id && (
              <div className="p-5 bg-muted/50 border-t border-border space-y-4" data-testid={`test-details-${tc.id}`}>
                {/* Test Case ID */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-1">Test Case ID:</div>
                  <div className="text-sm font-mono font-semibold">{tc.id}</div>
                </div>

                {/* Test Case Title */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-1">Test Case Title:</div>
                  <div className="text-sm font-semibold">{tc.name}</div>
                </div>

                {/* Description */}
                {tc.description && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground mb-1">Description:</div>
                    <div className="text-sm text-foreground">{tc.description}</div>
                  </div>
                )}

                {/* Objective */}
                {tc.objective && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground mb-1">Objective:</div>
                    <div className="text-sm text-foreground">{tc.objective}</div>
                  </div>
                )}

                {/* Preconditions */}
                {tc.preconditions && tc.preconditions.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground mb-2">Preconditions:</div>
                    <ul className="list-disc list-inside space-y-1 text-sm pl-2">
                      {tc.preconditions.map((pre, idx) => (
                        <li key={idx} className="text-foreground">{pre}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Test Steps with Expected Behavior */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-2">Test Steps:</div>
                  {tc.test_steps && tc.test_steps.length > 0 ? (
                    <div className="space-y-3 pl-2">
                      {tc.test_steps.map((step) => (
                        <div key={step.step_number} className="border-l-2 border-primary/30 pl-3">
                          <div className="flex gap-2 text-sm">
                            <span className="text-primary font-mono text-xs font-bold w-5 flex-shrink-0">
                              {step.step_number}.
                            </span>
                            <div className="flex-1">
                              <p className="font-medium text-foreground">{step.action}</p>
                              {step.expected_behavior && (
                                <p className="text-muted-foreground text-xs mt-1">
                                  <span className="font-semibold">Expected:</span> {step.expected_behavior}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ol className="list-decimal list-inside space-y-1 text-sm pl-2">
                      {tc.given && <li className="text-foreground">{tc.given}</li>}
                      {tc.when && <li className="text-foreground">{tc.when}</li>}
                    </ol>
                  )}
                </div>

                {/* Expected Result */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-2">Expected Results:</div>
                  <div className="text-sm text-foreground whitespace-pre-line bg-green-500/10 border border-green-500/20 rounded p-2">
                    {tc.then || (tc.test_steps && tc.test_steps.length > 0 
                      ? tc.test_steps.filter(s => s.expected_behavior).map(s => `• ${s.expected_behavior}`).join('\n')
                      : '[No expected result defined]'
                    )}
                  </div>
                </div>

                {/* Postconditions */}
                {tc.postconditions && tc.postconditions.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground mb-2">Postconditions:</div>
                    <ul className="list-disc list-inside space-y-1 text-sm pl-2">
                      {tc.postconditions.map((post, idx) => (
                        <li key={idx} className="text-foreground">{post}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actual Result */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-1">Actual Result:</div>
                  <div className="text-sm text-muted-foreground italic">[Pending execution]</div>
                </div>

                {/* Export to ADO Button */}
                <div className="pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportToAdo(tc);
                    }}
                    disabled={exportingId === tc.id}
                    data-testid={`button-export-ado-${tc.id}`}
                    className="gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {exportingId === tc.id ? "Exporting..." : "Export to Azure DevOps"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, sortedCases.length)} of {sortedCases.length}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
