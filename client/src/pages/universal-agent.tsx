import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkles, Loader2, FileText, ClipboardList, CheckSquare, ListChecks, Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { apiRequest } from "@/lib/queryClient";
import toast from "react-hot-toast";
import { useSessionIdentity } from "@/utils/msal-user";

const priorityColors: Record<string, string> = {
  High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

const SECTION_TITLES = [
  "CONTEXT & BACKGROUND",
  "CURRENT STATE",
  "DESIRED STATE",
  "KEY FUNCTIONALITY",
  "USER INTERACTION FLOW",
  "TECHNICAL CONSIDERATIONS",
  "OUT OF SCOPE",
  "SUCCESS METRICS",
  "ACCEPTANCE CRITERIA",
];

function formatDescription(description: string) {
  const textContent = (description || "").trim();
  const hasStructured = SECTION_TITLES.some((t) =>
    textContent.toUpperCase().includes(`${t}:`)
  );
  if (!hasStructured)
    return (
      <div className="text-sm text-muted-foreground whitespace-pre-wrap">
        {textContent || "No description."}
      </div>
    );
  return (
    <div className="text-sm text-muted-foreground whitespace-pre-wrap space-y-2">
      {textContent.split(/\n+/).map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

export default function UniversalAgentPage() {
  const [instruction, setInstruction] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [artifacts, setArtifacts] = useState<{
    epics: any[];
    features: any[];
    userStories: any[];
    subtasks: any[];
    testCases: any[];
    personas: any[];
  } | null>(null);

  const identity = useSessionIdentity();

  const quickActions = [
    { label: "User story only", append: "Generate only user story with all fields." },
    { label: "Test cases only", append: "Generate only test cases." },
    { label: "Modify user story", append: "Modify this user story and return only the updated user story with all fields." },
    { label: "Split user story", append: "Split this user story into smaller stories. Return only user stories with all fields." },
  ];

  const runGenerate = async () => {
    const input = [instruction.trim(), context.trim()].filter(Boolean).join("\n\n");
    if (!input) {
      toast.error("Enter an instruction or paste content.");
      return;
    }
    setLoading(true);
    setArtifacts(null);
    try {
      const res = await apiRequest("POST", "/api/workflow/generic", {
        input,
        sessionId: null,
        aadObjectId: identity?.aadObjectId,
        userName: identity?.userName,
        userEmail: identity?.userEmail,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || "Generation failed");
      }
      const data = await res.json();
      const a = data?.artifacts || {};
      setArtifacts({
        epics: Array.isArray(a.epics) ? a.epics : [],
        features: Array.isArray(a.features) ? a.features : [],
        userStories: Array.isArray(a.userStories) ? a.userStories : [],
        subtasks: Array.isArray(a.subtasks) ? a.subtasks : [],
        testCases: Array.isArray(a.testCases) ? a.testCases : [],
        personas: Array.isArray(a.personas) ? a.personas : [],
      });
      toast.success("Generated successfully.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const hasStories = (artifacts?.userStories?.length ?? 0) > 0;
  const hasTestCases = (artifacts?.testCases?.length ?? 0) > 0;
  const hasEpics = (artifacts?.epics?.length ?? 0) > 0;
  const hasFeatures = (artifacts?.features?.length ?? 0) > 0;
  const hasSubtasks = (artifacts?.subtasks?.length ?? 0) > 0;
  const hasAny = hasStories || hasTestCases || hasEpics || hasFeatures || hasSubtasks;
  const defaultTab = hasStories ? "stories" : hasTestCases ? "testcases" : hasEpics ? "epics" : hasFeatures ? "features" : "subtasks";

  return (
    <div className="flex flex-col h-full p-6 max-w-6xl mx-auto">
      <PageHeader
        icon={Bot}
        title="Universal Agent"
        subtitle="Generate only the artifact you need: user story, test cases, or full backlog. Same format as workflow."
        color="cyan"
      />

      <Card className="mb-6 border-l-[3px] border-l-cyan-500">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Instruction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm">What to generate (e.g. &quot;Generate only user story for login&quot;)</Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Generate only user story for login feature"
              className="mt-1 min-h-[80px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((qa) => (
              <Button
                key={qa.label}
                variant="outline"
                size="sm"
                onClick={() => setInstruction((prev) => (prev ? `${prev}\n${qa.append}` : qa.append))}
              >
                {qa.label}
              </Button>
            ))}
          </div>
          <div>
            <Label className="text-sm">Context / paste content (optional)</Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Paste user story, epic, or requirement text to modify or generate from"
              className="mt-1 min-h-[120px]"
            />
          </div>
          <Button onClick={runGenerate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {artifacts && hasAny && (
        <Card className="border-l-[3px] border-l-cyan-500">
          <CardHeader>
            <CardTitle className="text-base">Generated artifacts</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={defaultTab}>
              <TabsList className="mb-4">
                {hasStories && (
                  <TabsTrigger value="stories">
                    User stories ({artifacts.userStories.length})
                  </TabsTrigger>
                )}
                {hasTestCases && (
                  <TabsTrigger value="testcases">
                    Test cases ({artifacts.testCases.length})
                  </TabsTrigger>
                )}
                {hasEpics && (
                  <TabsTrigger value="epics">
                    Epics ({artifacts.epics.length})
                  </TabsTrigger>
                )}
                {hasFeatures && (
                  <TabsTrigger value="features">
                    Features ({artifacts.features.length})
                  </TabsTrigger>
                )}
                {hasSubtasks && (
                  <TabsTrigger value="subtasks">
                    Subtasks ({artifacts.subtasks.length})
                  </TabsTrigger>
                )}
              </TabsList>

              {hasStories && (
                <TabsContent value="stories" className="mt-0">
                  <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-6">
                      {artifacts.userStories.map((story: any) => (
                        <Card key={story.id} className="border-l-[3px] border-l-cyan-500">
                          <CardHeader className="pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="font-mono">
                                {story.id}
                              </Badge>
                              {story.priority && (
                                <Badge className={priorityColors[story.priority] || ""}>
                                  {story.priority}
                                </Badge>
                              )}
                            </div>
                            <CardTitle className="text-base mt-2">{story.title}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {story.description && (
                              <div>
                                <Label className="text-xs text-muted-foreground uppercase">Description</Label>
                                <div className="mt-1 p-3 bg-muted/30 rounded-lg border text-sm">
                                  {formatDescription(story.description)}
                                </div>
                              </div>
                            )}
                            {Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0 && (
                              <div>
                                <Label className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                                  <ClipboardList className="h-3 w-3" />
                                  Acceptance criteria
                                </Label>
                                <div className="mt-2 space-y-2">
                                  {story.acceptanceCriteria.map((ac: any, idx: number) => {
                                    const text =
                                      typeof ac === "string"
                                        ? ac
                                        : ac?.given || ac?.title || [ac?.given, ac?.when, ac?.then].filter(Boolean).join(" ");
                                    return (
                                      <div
                                        key={idx}
                                        className="p-2 bg-accent/30 rounded border text-sm flex gap-2"
                                      >
                                        <Badge variant="secondary" className="text-xs shrink-0">
                                          #{idx + 1}
                                        </Badge>
                                        <span>{text || "—"}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {Array.isArray(story.subtasks) && story.subtasks.length > 0 && (
                              <div>
                                <Label className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                                  <CheckSquare className="h-3 w-3" />
                                  Subtasks
                                </Label>
                                <ul className="mt-2 space-y-1 list-disc list-inside text-sm">
                                  {story.subtasks.map((st: any, idx: number) => {
                                    const text =
                                      typeof st === "string" ? st : (st?.description || st?.title || "—");
                                    return <li key={idx}>{text}</li>;
                                  })}
                                </ul>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              )}

              {hasTestCases && (
                <TabsContent value="testcases" className="mt-0">
                  <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-6">
                      {artifacts.testCases.map((tc: any) => {
                        const steps = Array.isArray(tc.testCaseSteps) ? tc.testCaseSteps : tc.steps || [];
                        return (
                          <Card key={tc.id} className="border-l-[3px] border-l-cyan-500">
                            <CardHeader className="pb-2">
                              <Badge variant="outline" className="font-mono w-fit">
                                {tc.id}
                              </Badge>
                              <CardTitle className="text-base mt-2">{tc.title}</CardTitle>
                              {tc.description && (
                                <p className="text-sm text-muted-foreground">{tc.description}</p>
                              )}
                            </CardHeader>
                            <CardContent>
                              <Label className="text-xs text-muted-foreground uppercase flex items-center gap-1 mb-2">
                                <ListChecks className="h-3 w-3" />
                                Steps
                              </Label>
                              {steps.length > 0 ? (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-16">Step</TableHead>
                                      <TableHead>Action</TableHead>
                                      <TableHead>Result</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {steps.map((step: any, stepIdx: number) => {
                                      if (typeof step === "string") {
                                        return (
                                          <TableRow key={stepIdx}>
                                            <TableCell className="font-medium">{stepIdx + 1}</TableCell>
                                            <TableCell>{step}</TableCell>
                                            <TableCell className="text-muted-foreground italic">
                                              —
                                            </TableCell>
                                          </TableRow>
                                        );
                                      }
                                      const action = step.action || step.Action || "";
                                      const result =
                                        step.result ||
                                        step.expectedResult ||
                                        step["Expected Results"] ||
                                        "";
                                      return (
                                        <TableRow key={stepIdx}>
                                          <TableCell className="font-medium">
                                            {step.step ?? stepIdx + 1}
                                          </TableCell>
                                          <TableCell>{action || "—"}</TableCell>
                                          <TableCell className="text-muted-foreground">
                                            {result || "—"}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              ) : (
                                <p className="text-sm text-muted-foreground">No steps.</p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>
              )}

              {hasEpics && (
                <TabsContent value="epics" className="mt-0">
                  <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4">
                      {artifacts.epics.map((epic: any) => (
                        <Card key={epic.id} className="border-l-[3px] border-l-cyan-500">
                          <CardHeader>
                            <Badge variant="outline" className="w-fit">{epic.id}</Badge>
                            <CardTitle className="text-base">{epic.title}</CardTitle>
                            {epic.description && (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {epic.description}
                              </p>
                            )}
                          </CardHeader>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              )}

              {hasFeatures && (
                <TabsContent value="features" className="mt-0">
                  <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4">
                      {artifacts.features.map((f: any) => (
                        <Card key={f.id} className="border-l-[3px] border-l-cyan-500">
                          <CardHeader>
                            <Badge variant="outline" className="w-fit">{f.id}</Badge>
                            <CardTitle className="text-base">{f.title}</CardTitle>
                            {f.description && (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {f.description}
                              </p>
                            )}
                          </CardHeader>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              )}

              {hasSubtasks && (
                <TabsContent value="subtasks" className="mt-0">
                  <ScrollArea className="h-[60vh] pr-4">
                    <ul className="space-y-2 list-disc list-inside">
                      {artifacts.subtasks.map((st: any, idx: number) => {
                        const text = typeof st === "string" ? st : (st?.description || st?.title || JSON.stringify(st));
                        return <li key={idx}>{text}</li>;
                      })}
                    </ul>
                  </ScrollArea>
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {artifacts && !hasAny && (
        <Card className="border-l-[3px] border-l-cyan-500">
          <CardContent className="py-8 text-center text-muted-foreground">
            No artifacts generated. Try a clearer instruction (e.g. &quot;Generate only user story&quot; or &quot;Generate only test cases&quot;).
          </CardContent>
        </Card>
      )}
    </div>
  );
}
