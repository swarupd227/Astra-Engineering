import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderOpen, GitBranch, Cloud, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

interface ProjectCardProps {
  id?: string;
  name: string;
  organization: string;
  repoCount: number;
  cloudProvider?: string;
  status: "active" | "pending" | "archived";
  onView?: () => void;
}

export function ProjectCard({
  id,
  name,
  organization,
  repoCount,
  cloudProvider,
  status,
  onView,
}: ProjectCardProps) {
  const [, setLocation] = useLocation();
  
  const statusColors = {
    active: "default",
    pending: "secondary",
    archived: "outline",
  } as const;

  const handleViewProject = () => {
    // Navigate to SDLC page with project context
    const projectIdParam = id || name.toLowerCase().replace(/\s+/g, '-');
    setLocation(`/sdlc?projectId=${projectIdParam}&projectName=${encodeURIComponent(name)}`);
    onView?.();
  };

  return (
    <Card className="hover-elevate border-l-[3px] border-l-violet-500" data-testid={`card-project-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">{name}</h3>
            <p className="text-xs text-muted-foreground">{organization}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" data-testid={`button-project-menu-${name.toLowerCase().replace(/\s+/g, '-')}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusColors[status]}>{status}</Badge>
          {cloudProvider && (
            <Badge variant="outline" className="gap-1">
              <Cloud className="h-3 w-3" />
              {cloudProvider}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranch className="h-4 w-4" />
          <span>{repoCount} Golden Repos</span>
        </div>
        <Button 
          className="w-full" 
          variant="outline"
          onClick={handleViewProject}
          data-testid={`button-view-project-${name.toLowerCase().replace(/\s+/g, '-')}`}
        >
          View SDLC
        </Button>
      </CardContent>
    </Card>
  );
}
