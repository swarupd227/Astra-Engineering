import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link2, Plus, X, Eye, Loader2, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface UrlReference {
  id: string;
  url: string;
  type: UrlType;
  status: 'pending' | 'fetching' | 'success' | 'failed';
  content: string;
  title?: string;
  fetchedAt?: Date;
  error?: string;
}

export type UrlType = 
  | 'product_docs'
  | 'api_reference'
  | 'user_guide'
  | 'knowledge_base'
  | 'release_notes'
  | 'technical_specs'
  | 'other';

const urlTypeLabels: Record<UrlType, string> = {
  product_docs: 'Product Documentation',
  api_reference: 'API Reference',
  user_guide: 'User Guide',
  knowledge_base: 'Knowledge Base',
  release_notes: 'Release Notes',
  technical_specs: 'Technical Specs',
  other: 'Other',
};

interface UrlReferencesProps {
  urls: UrlReference[];
  onUrlsChange: (urls: UrlReference[]) => void;
  maxUrls?: number;
}

export function UrlReferences({ urls, onUrlsChange, maxUrls = 10 }: UrlReferencesProps) {
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<UrlReference | null>(null);
  const [isFetchingAll, setIsFetchingAll] = useState(false);

  const addUrl = () => {
    if (!newUrl.trim()) return;

    let normalizedUrl = newUrl.trim();
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    if (urls.length >= maxUrls) {
      toast({
        title: "Too many URLs",
        description: `Maximum ${maxUrls} URLs allowed`,
        variant: "destructive",
      });
      return;
    }

    if (urls.some(u => u.url === normalizedUrl)) {
      toast({
        title: "URL already added",
        description: "This URL has already been added",
        variant: "destructive",
      });
      return;
    }

    const newUrlRef: UrlReference = {
      id: crypto.randomUUID(),
      url: normalizedUrl,
      type: 'other',
      status: 'pending',
      content: '',
    };

    onUrlsChange([...urls, newUrlRef]);
    setNewUrl("");
  };

  const removeUrl = (id: string) => {
    onUrlsChange(urls.filter(u => u.id !== id));
  };

  const updateUrlType = (id: string, type: UrlType) => {
    onUrlsChange(urls.map(u => u.id === id ? { ...u, type } : u));
  };

  const fetchUrlContent = async (urlRef: UrlReference): Promise<UrlReference> => {
    try {
      const response = await fetch('/api/urls/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlRef.url }),
      });

      if (response.ok) {
        const result = await response.json();
        return {
          ...urlRef,
          status: 'success',
          content: result.content || '',
          title: result.title || '',
          fetchedAt: new Date(),
        };
      } else {
        const error = await response.json();
        return {
          ...urlRef,
          status: 'failed',
          error: error.message || 'Failed to fetch content',
        };
      }
    } catch (error: any) {
      return {
        ...urlRef,
        status: 'failed',
        error: error.message || 'Network error',
      };
    }
  };

  const fetchSingleUrl = async (id: string) => {
    const urlRef = urls.find(u => u.id === id);
    if (!urlRef) return;

    onUrlsChange(urls.map(u => u.id === id ? { ...u, status: 'fetching' } : u));
    
    const updated = await fetchUrlContent(urlRef);
    onUrlsChange(urls.map(u => u.id === id ? updated : u));
  };

  const fetchAllUrls = async () => {
    const pendingUrls = urls.filter(u => u.status === 'pending' || u.status === 'failed');
    if (pendingUrls.length === 0) {
      toast({
        title: "No URLs to fetch",
        description: "All URLs have already been fetched",
      });
      return;
    }

    setIsFetchingAll(true);
    onUrlsChange(urls.map(u => 
      pendingUrls.some(p => p.id === u.id) ? { ...u, status: 'fetching' } : u
    ));

    const results = await Promise.all(pendingUrls.map(fetchUrlContent));
    
    onUrlsChange(urls.map(u => {
      const result = results.find(r => r.id === u.id);
      return result || u;
    }));

    setIsFetchingAll(false);

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    toast({
      title: "Fetch Complete",
      description: `${successCount} successful, ${failCount} failed`,
    });
  };

  const getStatusIcon = (status: UrlReference['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="text-xs">Pending</Badge>;
      case 'fetching':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const truncateUrl = (url: string, maxLength: number = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="Enter URL (e.g., https://docs.example.com)"
          className="flex-1"
          onKeyDown={(e) => e.key === 'Enter' && addUrl()}
          data-testid="input-add-url"
        />
        <Button onClick={addUrl} data-testid="button-add-url">
          <Plus className="w-4 h-4 mr-2" />
          Add URL
        </Button>
      </div>

      {urls.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {urls.length} / {maxUrls} URLs added
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAllUrls}
              disabled={isFetchingAll || urls.every(u => u.status === 'success')}
              data-testid="button-fetch-all"
            >
              {isFetchingAll ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Fetch All
            </Button>
          </div>

          <div className="space-y-3">
            {urls.map(urlRef => (
              <Card key={urlRef.id} className="p-4" data-testid={`url-card-${urlRef.id}`}>
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-muted">
                    <Link2 className="w-6 h-6 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span 
                        className="font-medium truncate cursor-help" 
                        title={urlRef.url}
                      >
                        {truncateUrl(urlRef.url)}
                      </span>
                      {getStatusIcon(urlRef.status)}
                    </div>

                    {urlRef.title && (
                      <p className="text-sm text-muted-foreground mb-2 truncate">
                        {urlRef.title}
                      </p>
                    )}

                    {urlRef.error && (
                      <p className="text-sm text-red-500 mb-2">
                        {urlRef.error}
                      </p>
                    )}

                    <div className="flex items-center gap-3">
                      <Select
                        value={urlRef.type}
                        onValueChange={(v) => updateUrlType(urlRef.id, v as UrlType)}
                      >
                        <SelectTrigger className="w-48 h-8 text-xs" data-testid={`select-url-type-${urlRef.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(urlTypeLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {urlRef.fetchedAt && (
                        <span className="text-xs text-muted-foreground">
                          Fetched: {urlRef.fetchedAt.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {urlRef.status === 'pending' || urlRef.status === 'failed' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => fetchSingleUrl(urlRef.id)}
                        data-testid={`button-fetch-${urlRef.id}`}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewUrl(urlRef)}
                      disabled={urlRef.status !== 'success'}
                      data-testid={`button-preview-${urlRef.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeUrl(urlRef.id)}
                      data-testid={`button-remove-${urlRef.id}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {urls.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Link2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No URLs added yet</p>
          <p className="text-xs">Add URLs to reference documentation, guides, or specifications</p>
        </div>
      )}

      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewUrl?.title || previewUrl?.url}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh] p-4 bg-muted rounded-lg">
            <pre className="text-sm whitespace-pre-wrap font-mono">
              {previewUrl?.content || 'No content available'}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
