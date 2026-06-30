import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, FileText, File, X, Eye, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface UploadedDocument {
  id: string;
  name: string;
  size: number;
  format: string;
  type: DocumentType;
  uploadedAt: Date;
  content: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress?: number;
}

export type DocumentType = 
  | 'requirements'
  | 'user_stories'
  | 'functional_specs'
  | 'business_rules'
  | 'api_documentation'
  | 'user_manual'
  | 'release_notes'
  | 'other';

const documentTypeLabels: Record<DocumentType, string> = {
  requirements: 'Requirements Document',
  user_stories: 'User Stories',
  functional_specs: 'Functional Specifications',
  business_rules: 'Business Rules',
  api_documentation: 'API Documentation',
  user_manual: 'User Manual',
  release_notes: 'Release Notes',
  other: 'Other',
};

const formatIcons: Record<string, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  doc: FileText,
  txt: File,
  md: File,
  html: File,
};

interface DocumentUploadProps {
  documents: UploadedDocument[];
  onDocumentsChange: (docs: UploadedDocument[]) => void;
  maxFiles?: number;
  maxFileSize?: number;
}

export function DocumentUpload({ 
  documents, 
  onDocumentsChange, 
  maxFiles = 10,
  maxFileSize = 10 * 1024 * 1024 
}: DocumentUploadProps) {
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);

  const supportedFormats = ['pdf', 'docx', 'doc', 'txt', 'md', 'html'];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const processFile = async (file: File): Promise<UploadedDocument> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const id = crypto.randomUUID();
    
    const doc: UploadedDocument = {
      id,
      name: file.name,
      size: file.size,
      format: ext,
      type: 'other',
      uploadedAt: new Date(),
      content: '',
      status: 'processing',
      progress: 0,
    };

    try {
      if (['txt', 'md', 'html'].includes(ext)) {
        const text = await file.text();
        doc.content = text;
        doc.status = 'ready';
      } else if (['pdf', 'docx', 'doc'].includes(ext)) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/documents/extract', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const result = await response.json();
          doc.content = result.content || '';
          doc.status = 'ready';
        } else {
          doc.content = `[Content extraction pending - ${file.name}]`;
          doc.status = 'ready';
        }
      } else {
        doc.content = `[Unsupported format: ${ext}]`;
        doc.status = 'error';
      }
    } catch (error) {
      console.error('Error processing file:', error);
      doc.content = `[Error processing file: ${file.name}]`;
      doc.status = 'error';
    }

    return doc;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    
    if (documents.length + fileArray.length > maxFiles) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFiles} files allowed`,
        variant: "destructive",
      });
      return;
    }

    const validFiles = fileArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!supportedFormats.includes(ext)) {
        toast({
          title: "Unsupported format",
          description: `${file.name} is not a supported format`,
          variant: "destructive",
        });
        return false;
      }
      if (file.size > maxFileSize) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds ${maxFileSize / 1024 / 1024}MB limit`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    });

    const placeholders: UploadedDocument[] = validFiles.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      format: file.name.split('.').pop()?.toLowerCase() || '',
      type: 'other',
      uploadedAt: new Date(),
      content: '',
      status: 'uploading',
      progress: 0,
    }));

    const updatedDocs = [...documents, ...placeholders];
    onDocumentsChange(updatedDocs);

    let currentDocs = updatedDocs;
    for (let i = 0; i < validFiles.length; i++) {
      const processedDoc = await processFile(validFiles[i]);
      currentDocs = currentDocs.map(d => d.id === placeholders[i].id ? processedDoc : d);
      onDocumentsChange(currentDocs);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [documents]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const removeDocument = (id: string) => {
    onDocumentsChange(documents.filter(d => d.id !== id));
  };

  const updateDocumentType = (id: string, type: DocumentType) => {
    onDocumentsChange(documents.map(d => d.id === id ? { ...d, type } : d));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFormatBadgeColor = (format: string) => {
    switch (format) {
      case 'pdf': return 'bg-red-500/20 text-red-400';
      case 'docx': case 'doc': return 'bg-blue-500/20 text-blue-400';
      case 'txt': return 'bg-gray-500/20 text-gray-400';
      case 'md': return 'bg-purple-500/20 text-purple-400';
      case 'html': return 'bg-orange-500/20 text-orange-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragOver 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="dropzone-documents"
      >
        <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
        <p className="text-sm font-medium mb-2">
          Drag & drop files here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Supported: PDF, DOCX, TXT, MD, HTML (max {maxFileSize / 1024 / 1024}MB each)
        </p>
        <input
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.html"
          onChange={handleFileInput}
          className="hidden"
          id="document-upload"
          data-testid="input-document-upload"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => document.getElementById('document-upload')?.click()}
          data-testid="button-browse-files"
        >
          Browse Files
        </Button>
      </div>

      {documents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {documents.length} / {maxFiles} files uploaded
            </span>
          </div>

          {documents.map(doc => (
            <Card key={doc.id} className="p-4" data-testid={`document-card-${doc.id}`}>
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-muted">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">{doc.name}</span>
                    <Badge className={`${getFormatBadgeColor(doc.format)} text-xs`}>
                      {doc.format.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                    <span>{formatFileSize(doc.size)}</span>
                    <span>{doc.uploadedAt.toLocaleString()}</span>
                    {doc.status === 'processing' && (
                      <span className="flex items-center gap-1 text-amber-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing...
                      </span>
                    )}
                    {doc.status === 'ready' && (
                      <span className="text-green-500">Ready</span>
                    )}
                    {doc.status === 'error' && (
                      <span className="text-red-500">Error</span>
                    )}
                  </div>

                  <Select
                    value={doc.type}
                    onValueChange={(v) => updateDocumentType(doc.id, v as DocumentType)}
                  >
                    <SelectTrigger className="w-48 h-8 text-xs" data-testid={`select-doc-type-${doc.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(documentTypeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPreviewDoc(doc)}
                    disabled={doc.status !== 'ready'}
                    data-testid={`button-preview-${doc.id}`}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDocument(doc.id)}
                    data-testid={`button-remove-${doc.id}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewDoc?.name}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh] p-4 bg-muted rounded-lg">
            <pre className="text-sm whitespace-pre-wrap font-mono">
              {previewDoc?.content || 'No content available'}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
