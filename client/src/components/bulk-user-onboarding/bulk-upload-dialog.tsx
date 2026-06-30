import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileSpreadsheet, Loader2, X } from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { PreviewTable } from "./preview-table";
import type { CommitResponse, PreviewResponse } from "./types";

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildAuthHeaders: () => Headers;
  onCompleted: () => void;
}

export function BulkUploadDialog({
  open,
  onOpenChange,
  buildAuthHeaders,
  onCompleted,
}: BulkUploadDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setIsUploading(false);
    setIsCommitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const runPreview = async (selected: File) => {
    setIsUploading(true);
    setPreview(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selected);
      const headers = buildAuthHeaders();
      const res = await fetch(getApiUrl("/api/admin/users/bulk/preview"), {
        method: "POST",
        credentials: "include",
        headers,
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to validate file");
      }
      const data: PreviewResponse = await res.json();
      setPreview(data);
    } catch (e: any) {
      toast({
        title: "Upload failed",
        description: e?.message ?? "Could not read the file",
        variant: "destructive",
      });
      reset();
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelected = (selected: File | null) => {
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name)) {
      toast({
        title: "Unsupported file",
        description: "Please upload an .xlsx file (use the template).",
        variant: "destructive",
      });
      return;
    }
    setFile(selected);
    void runPreview(selected);
  };

  const handleCommit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.status === "valid");
    if (validRows.length === 0) return;
    setIsCommitting(true);
    try {
      const headers = buildAuthHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(getApiUrl("/api/admin/users/bulk"), {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          rows: validRows.map((r) => ({ rowNumber: r.rowNumber, ...r.data })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to create users");
      }
      const data: CommitResponse = await res.json();
      setResult(data);
      onCompleted();
      toast({
        title: "Bulk onboarding complete",
        description: `${data.created} created, ${data.failed} failed, ${data.skipped} skipped.`,
      });
    } catch (e: any) {
      toast({
        title: "Creation failed",
        description: e?.message ?? "Could not create users",
        variant: "destructive",
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const validCount = preview?.summary.valid ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk User Onboarding</DialogTitle>
          <DialogDescription>
            Upload the completed Excel template to create multiple users at once.
          </DialogDescription>
        </DialogHeader>

        {/* Result view */}
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <SummaryStat label="Created" value={result.created} color="emerald" />
              <SummaryStat label="Failed" value={result.failed} color="rose" />
              <SummaryStat label="Skipped" value={result.skipped} color="amber" />
            </div>
            <div className="rounded-2xl border border-border/40 bg-card max-h-[40vh] overflow-auto divide-y divide-border/40">
              {result.results.map((r) => (
                <div
                  key={r.rowNumber}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <span className="font-medium">{r.email}</span>
                  <span
                    className={
                      r.status === "created"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : r.status === "failed"
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {r.status === "created"
                      ? r.reactivated
                        ? "Reactivated"
                        : "Created"
                      : r.status === "failed"
                        ? `Failed: ${r.error ?? ""}`
                        : `Skipped: ${r.error ?? ""}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : preview ? (
          /* Preview view */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                {file?.name}
                <button
                  onClick={reset}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  title="Choose a different file"
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {preview.summary.valid} valid
                </span>
                <span className="text-rose-600 dark:text-rose-400">
                  {preview.summary.errors} errors
                </span>
                <span className="text-amber-600 dark:text-amber-400">
                  {preview.summary.duplicates} duplicates
                </span>
              </div>
            </div>
            <PreviewTable rows={preview.rows} />
          </div>
        ) : (
          /* Upload view */
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full rounded-2xl border-2 border-dashed border-border/60 bg-muted/30 p-10 flex flex-col items-center gap-3 text-muted-foreground hover:border-border hover:bg-muted/50 transition-colors"
          >
            {isUploading ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <UploadCloud className="h-8 w-8" />
            )}
            <span className="text-sm font-medium text-foreground">
              {isUploading ? "Validating file…" : "Click to select an Excel file"}
            </span>
            <span className="text-xs">
              .xlsx generated from the onboarding template
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : preview ? (
            <>
              <Button variant="outline" onClick={reset} disabled={isCommitting}>
                Upload different file
              </Button>
              <Button
                onClick={handleCommit}
                disabled={validCount === 0 || isCommitting}
                className="gap-2"
              >
                {isCommitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create {validCount} valid user{validCount === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "rose" | "amber";
}) {
  const colorMap = {
    emerald: "border-l-emerald-500 text-emerald-600 dark:text-emerald-400",
    rose: "border-l-rose-500 text-rose-600 dark:text-rose-400",
    amber: "border-l-amber-500 text-amber-600 dark:text-amber-400",
  } as const;
  return (
    <div
      className={`rounded-2xl border border-border/40 border-l-[3px] bg-card p-4 ${colorMap[color]}`}
    >
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
