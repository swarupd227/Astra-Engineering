import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExportPreviewRow } from "./types";

interface ExportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ExportPreviewRow[];
  totalCount: number;
  formatLabel: string;
  title?: string;
  descriptionPrefix?: string;
}

export function ExportPreviewDialog({
  open,
  onOpenChange,
  rows,
  totalCount,
  formatLabel,
  title = "Export Preview",
  descriptionPrefix = "selected for",
}: ExportPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Showing the first {rows.length} of {totalCount} test cases {descriptionPrefix} {formatLabel}.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-6 text-sm text-muted-foreground">
            No test cases match your current source and filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Priority</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Steps</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3 text-foreground">{row.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{row.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{row.priority}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.stepsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
