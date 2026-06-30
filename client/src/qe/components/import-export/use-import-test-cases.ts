import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { ExportPreviewRow } from "./types";
import type { ImportParams } from "./types";

interface ImportPreviewResponse {
  success: boolean;
  totalCount?: number;
  preview?: ExportPreviewRow[];
  warnings?: string[];
  error?: string;
}

interface ImportResponse {
  success: boolean;
  imported?: number;
  skipped?: number;
  replaced?: number;
  message?: string;
  error?: string;
}

function buildImportFormData(params: ImportParams): FormData {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("destinationType", params.destinationType);
  formData.append("projectId", params.projectId);
  if (params.sprintId) formData.append("sprintId", params.sprintId);
  formData.append("duplicateHandling", params.duplicateHandling);
  formData.append("validateBeforeImport", String(params.validateBeforeImport));
  formData.append("autoGenerateIds", String(params.autoGenerateIds));
  return formData;
}

export function useImportTestCases() {
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<ExportPreviewRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lastValidationMessage, setLastValidationMessage] = useState<string | null>(null);

  const handlePreview = useCallback(
    async (file: File) => {
      setIsPreviewLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/import/test-cases/preview", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = (await response.json()) as ImportPreviewResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to preview import file");
        }

        setPreviewRows(data.preview || []);
        setPreviewTotal(data.totalCount || 0);
        setPreviewOpen(true);
        setLastValidationMessage(
          data.warnings?.length
            ? `${data.totalCount || 0} test cases ready. ${data.warnings.length} warning(s).`
            : `${data.totalCount || 0} test cases validated and ready`,
        );

        if (data.warnings?.length) {
          toast({
            title: "Import preview ready",
            description: data.warnings[0],
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to preview import file";
        setLastValidationMessage(message);
        toast({
          title: "Preview failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [toast],
  );

  const handleImport = useCallback(
    async (params: ImportParams) => {
      setIsImporting(true);
      try {
        const formData = buildImportFormData(params);
        const response = await fetch("/api/import/test-cases", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = (await response.json()) as ImportResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to import test cases");
        }

        setLastValidationMessage(data.message || `Imported ${data.imported || 0} test cases`);
        toast({
          title: "Import complete",
          description: data.message,
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to import test cases";
        setLastValidationMessage(message);
        toast({
          title: "Import failed",
          description: message,
          variant: "destructive",
        });
        return false;
      } finally {
        setIsImporting(false);
      }
    },
    [toast],
  );

  return {
    previewOpen,
    setPreviewOpen,
    previewRows,
    previewTotal,
    isPreviewLoading,
    isImporting,
    lastValidationMessage,
    handlePreview,
    handleImport,
  };
}
