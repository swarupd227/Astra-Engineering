import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderGit2, GitFork, Download, Users, GitCommit, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface RepoCardProps {
  id: string;
  name: string;
  description: string;
  technologies: string[];
  domain?: string | null;
  commitCount?: number;
  contributors?: string[];
  contributorCount?: number;
  lastCommit?: {
    author: string;
    message: string;
    date: string;
  } | null;
  chunkedCount?: number;
  totalFileCount?: number;
  chunkStatusLoading?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  onPreview?: () => void;
  onFork?: () => void;
  onDownload?: () => void;
  onChunkAll?: () => void;
  chunkAllLabel?: string;
}

export function RepoCard({
  id,
  name,
  description,
  technologies,
  domain,
  commitCount = 0,
  contributors = [],
  contributorCount = 0,
  lastCommit,
  chunkedCount,
  totalFileCount,
  chunkStatusLoading = false,
  isSelected = false,
  onSelect,
  onPreview,
  onFork,
  onDownload,
  onChunkAll,
  chunkAllLabel,
}: RepoCardProps) {

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card className="hover-elevate h-full flex flex-col border-l-[3px] border-l-emerald-500" data-testid={`card-repo-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-start gap-3 flex-1" id={`repo-header-${id}`}>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <FolderGit2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">{name}</h3>
              {typeof totalFileCount === "number" && totalFileCount > 0 && (
                <Badge
                  variant="outline"
                  className={
                    chunkStatusLoading
                      ? "text-[11px] px-2 py-0 border-slate-500/50 text-muted-foreground"
                      : (chunkedCount ?? 0) >= totalFileCount
                      ? "text-[11px] px-2 py-0 border-emerald-500/60 text-emerald-600"
                      : "text-[11px] px-2 py-0 border-amber-500/60 text-amber-600"
                  }
                  data-testid={`badge-chunk-status-${id}`}
                >
                  {chunkStatusLoading
                    ? "Chunking…"
                    : `${chunkedCount ?? 0}/${totalFileCount} chunked`}
                </Badge>
              )}
              {domain && domain.toLowerCase() !== "general" && (
                <Badge 
                  variant="outline" 
                  className="text-xs capitalize" 
                  data-testid={`badge-domain-${domain}`}
                >
                  {domain}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 flex flex-col">
        <div className="flex flex-wrap gap-2">
          {technologies.map((tech) => (
            <Badge key={tech} variant="secondary" className="text-xs">
              {tech}
            </Badge>
          ))}
        </div>

        {/* Contributors and Commits Info */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground border-t pt-3">
          {contributorCount > 0 && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{contributorCount} contributor{contributorCount > 1 ? 's' : ''}</span>
            </div>
          )}
          {commitCount > 0 && (
            <div className="flex items-center gap-1">
              <GitCommit className="h-4 w-4" />
              <span>{commitCount} commit{commitCount > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Last Commit Info */}
        {lastCommit && (
          <div className="border-t pt-3">
            <div className="flex items-start gap-2">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">
                  {lastCommit.author.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{lastCommit.author}</p>
                <p className="text-xs text-muted-foreground truncate">{lastCommit.message}</p>
                <p className="text-xs text-muted-foreground">{formatDate(lastCommit.date)}</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-auto space-y-3">
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => {
                onPreview?.();
              }}
              data-testid={`button-preview-${name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              Preview
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => {
                onFork?.();
              }}
              data-testid={`button-fork-${name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <GitFork className="h-4 w-4 mr-1" />
              Fork
            </Button>
          </div>
          {typeof totalFileCount === "number" &&
            totalFileCount > 0 &&
            (chunkedCount ?? 0) < totalFileCount &&
            onChunkAll && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={onChunkAll}
                  disabled={chunkStatusLoading}
                  data-testid={`button-chunk-all-${name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {chunkStatusLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      {chunkAllLabel || "Chunking all…"}
                    </>
                  ) : (
                    "Chunk all files"
                  )}
                </Button>
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-border/60 text-[11px] text-muted-foreground bg-muted/40"
                  title="Chunking pre-processes all golden repo guidelines into smaller semantic pieces so BRD generation can retrieve them quickly and avoid on-the-fly processing."
                >
                  i
                </button>
              </div>
            )}
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full"
            onClick={() => {
              onDownload?.();
            }}
            data-testid={`button-download-${name.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <Download className="h-4 w-4 mr-2" />
            Download ZIP
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
