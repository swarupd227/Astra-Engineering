import { CheckCircle2, Circle, Users, Zap, Target, Package } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkflow } from "@/context/workflow-context";
import type { ConversationPhase } from "@shared/schema";

interface PhaseInfo {
  id: ConversationPhase;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const PHASES: PhaseInfo[] = [
  {
    id: "understanding",
    title: "Understanding Requirements",
    description: "Gathering business goals and objectives",
    icon: <Target className="h-4 w-4" />,
  },
  {
    id: "refining",
    title: "Refining Details",
    description: "Exploring features and constraints",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    id: "personas",
    title: "Creating Personas",
    description: "Identifying user types and roles",
    icon: <Users className="h-4 w-4" />,
  },
  {
    id: "artifacts",
    title: "Generating Artifacts",
    description: "Finalizing requirements and priorities",
    icon: <Package className="h-4 w-4" />,
  },
];

export function ContextPanel() {
  const { conversationPhase, capturedRequirements, epics, features, userStories } = useWorkflow();

  const currentPhaseIndex = PHASES.findIndex((p) => p.id === conversationPhase);
  const progressPercentage = ((currentPhaseIndex + 1) / PHASES.length) * 100;

  const getPhaseStatus = (phaseId: ConversationPhase) => {
    const phaseIndex = PHASES.findIndex((p) => p.id === phaseId);
    if (phaseIndex < currentPhaseIndex) return "completed";
    if (phaseIndex === currentPhaseIndex) return "current";
    return "pending";
  };

  const countCapturedItems = () => {
    const requirements = capturedRequirements;
    return (
      requirements.businessGoals.length +
      requirements.targetUsers.length +
      requirements.keyFeatures.length +
      requirements.technicalConstraints.length +
      requirements.functionalRequirements.length +
      requirements.nonFunctionalRequirements.length +
      requirements.edgeCases.length +
      requirements.priorityItems.length
    );
  };

  const hasAnyRequirements = countCapturedItems() > 0;

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          {/* Progress Tracker */}
          <Card>
            <CardHeader className="space-y-0 pb-4">
              <CardTitle className="text-base">Conversation Progress</CardTitle>
              <CardDescription className="text-xs">
                Phase {currentPhaseIndex + 1} of {PHASES.length}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progressPercentage} className="h-2" data-testid="progress-bar" />
              
              <div className="space-y-3">
                {PHASES.map((phase) => {
                  const status = getPhaseStatus(phase.id);
                  return (
                    <div
                      key={phase.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-md transition-colors",
                        status === "current" && "bg-primary/10 border border-primary/20"
                      )}
                      data-testid={`phase-${phase.id}`}
                    >
                      <div className="shrink-0 mt-0.5">
                        {status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" data-testid={`phase-icon-completed-${phase.id}`} />
                        ) : (
                          <Circle
                            className={cn(
                              "h-5 w-5",
                              status === "current" ? "text-primary" : "text-muted-foreground"
                            )}
                            data-testid={`phase-icon-${status}-${phase.id}`}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {phase.icon}
                          <p className={cn(
                            "text-sm font-medium",
                            status === "current" && "text-primary"
                          )}>
                            {phase.title}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{phase.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Captured Insights */}
          {hasAnyRequirements && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Captured Insights</CardTitle>
                <CardDescription className="text-xs">
                  Information gathered so far
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Business Goals */}
                {capturedRequirements.businessGoals.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Business Goals</p>
                    <div className="flex flex-wrap gap-2">
                      {capturedRequirements.businessGoals.map((goal, index) => (
                        <Badge key={index} variant="secondary" className="text-xs" data-testid={`goal-${index}`}>
                          {goal}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Target Users */}
                {capturedRequirements.targetUsers.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Target Users</p>
                      <div className="flex flex-wrap gap-2">
                        {capturedRequirements.targetUsers.map((user, index) => (
                          <Badge key={index} variant="secondary" className="text-xs" data-testid={`user-${index}`}>
                            {user}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Key Features */}
                {capturedRequirements.keyFeatures.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Key Features</p>
                      <div className="space-y-1">
                        {capturedRequirements.keyFeatures.map((feature, index) => (
                          <div key={index} className="text-xs" data-testid={`feature-${index}`}>
                            • {feature}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Technical Constraints */}
                {capturedRequirements.technicalConstraints.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Technical Constraints</p>
                      <div className="space-y-1">
                        {capturedRequirements.technicalConstraints.map((constraint, index) => (
                          <div key={index} className="text-xs text-muted-foreground" data-testid={`constraint-${index}`}>
                            • {constraint}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Priority Items */}
                {capturedRequirements.priorityItems.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Priorities</p>
                      <div className="flex flex-wrap gap-2">
                        {capturedRequirements.priorityItems.map((item, index) => (
                          <Badge key={index} variant="outline" className="text-xs" data-testid={`priority-${index}`}>
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Artifact Counter */}
          {(epics.length > 0 || features.length > 0 || userStories.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Generated Artifacts</CardTitle>
                <CardDescription className="text-xs">
                  Preview of what we'll create
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-primary" data-testid="count-epics">
                      {epics.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Epics</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-primary" data-testid="count-features">
                      {features.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Features</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-primary" data-testid="count-stories">
                      {userStories.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Stories</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
