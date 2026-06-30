import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Circle,
  Clock,
  Users,
  FileText,
  ExternalLink,
  Save,
  Target,
  Lightbulb,
  Shield,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import type { SDLCPhase } from "@shared/schema";

interface PhaseData {
  id: number;
  title: string;
  description: string;
  icon: any;
  color: string;
  overview: {
    purpose: string;
    keyActivities: string[];
    bestPractices: string[];
    deliverables: string[];
    commonChallenges: string[];
  };
  tools: {
    name: string;
    description: string;
    link: string;
    icon: any;
    external?: boolean;
  }[];
}

interface PhaseDetailModalProps {
  phase: PhaseData | null;
  phaseStatus?: SDLCPhase | null;
  open: boolean;
  onClose: () => void;
  onSave?: (data: {
    status: string;
    progress: number;
    notes: string;
    assignedTo: string;
  }) => void;
}

export function PhaseDetailModal({
  phase,
  phaseStatus,
  open,
  onClose,
  onSave,
}: PhaseDetailModalProps) {
  const [status, setStatus] = useState(phaseStatus?.status || "not_started");
  const [progress, setProgress] = useState(phaseStatus?.progress || 0);
  const [notes, setNotes] = useState(phaseStatus?.notes || "");
  const [assignedTo, setAssignedTo] = useState(phaseStatus?.assignedTo || "");

  if (!phase) return null;

  const handleSave = () => {
    onSave?.({ status, progress, notes, assignedTo });
  };

  const statusColors = {
    not_started: "text-gray-500",
    in_progress: "text-blue-500",
    completed: "text-emerald-500",
  };

  const statusIcons = {
    not_started: Circle,
    in_progress: Clock,
    completed: CheckCircle2,
  };

  const StatusIcon = statusIcons[status as keyof typeof statusIcons] || Circle;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid={`modal-phase-${phase.id}`}>
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl bg-gradient-to-br ${phase.color}`}>
              <phase.icon className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-2xl" data-testid={`text-modal-title-${phase.id}`}>
                {phase.title}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{phase.description}</p>
            </div>
            <Badge className={statusColors[status as keyof typeof statusColors]}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {status.replace("_", " ")}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-6" data-testid={`tabs-phase-${phase.id}`}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview" data-testid={`tab-overview-${phase.id}`}>
              <FileText className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="tools" data-testid={`tab-tools-${phase.id}`}>
              <Workflow className="h-4 w-4 mr-2" />
              Tools
            </TabsTrigger>
            <TabsTrigger value="management" data-testid={`tab-management-${phase.id}`}>
              <Users className="h-4 w-4 mr-2" />
              Management
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-600" />
                  Purpose & Objectives
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{phase.overview.purpose}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Activities</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {phase.overview.keyActivities.map((activity, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{activity}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-600" />
                    Best Practices
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {phase.overview.bestPractices.map((practice, index) => (
                      <li key={index} className="text-sm">
                        • {practice}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-600" />
                    Key Deliverables
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {phase.overview.deliverables.map((deliverable, index) => (
                      <li key={index} className="text-sm">
                        • {deliverable}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-600" />
                  Common Challenges
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {phase.overview.commonChallenges.map((challenge, index) => (
                    <li key={index} className="text-sm">
                      ⚠️ {challenge}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="space-y-4 mt-6">
            <div className="grid gap-4">
              {phase.tools.map((tool, index) => (
                <Card key={index} className="hover-elevate active-elevate-2" data-testid={`card-tool-${index}`}>
                  <CardContent className="p-6 flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className={`p-3 rounded-xl bg-gradient-to-br ${phase.color}`}>
                        <tool.icon className="h-6 w-6 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold" data-testid={`text-tool-name-${index}`}>
                          {tool.name}
                        </h3>
                        {tool.external && (
                          <Badge variant="outline" className="text-xs">
                            External
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{tool.description}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid={`button-open-tool-${index}`}
                      >
                        {tool.external ? (
                          <a href={tool.link} target="_blank" rel="noopener noreferrer">
                            Open Tool
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </a>
                        ) : (
                          <Link href={tool.link}>
                            Open Tool
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Link>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Management Tab */}
          <TabsContent value="management" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Phase Status & Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger data-testid={`select-status-${phase.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not Started</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Progress</Label>
                    <span className="text-sm font-semibold">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" data-testid={`progress-${phase.id}`} />
                  <Input
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => setProgress(parseInt(e.target.value))}
                    className="w-full"
                    data-testid={`input-progress-${phase.id}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Assigned To</Label>
                  <Input
                    placeholder="Enter team member names (comma-separated)"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    data-testid={`input-assigned-${phase.id}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    placeholder="Add notes, blockers, or important information..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={6}
                    data-testid={`textarea-notes-${phase.id}`}
                  />
                </div>

                <div className="flex gap-3">
                  <Button onClick={handleSave} className="flex-1" data-testid={`button-save-${phase.id}`}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={onClose} data-testid={`button-cancel-${phase.id}`}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
