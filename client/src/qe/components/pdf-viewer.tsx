import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface CellDifference {
  row: number;
  column: string;
  sourceValue: string;
  targetValue: string;
  difference: string;
  percentDiff?: number;
  status: 'exact' | 'tolerance' | 'mismatch';
}

interface PDFComparisonViewerProps {
  sourceFile: File;
  targetFile: File;
  sourceName: string;
  targetName: string;
  differences: CellDifference[];
  currentDiffIndex: number;
  onDiffIndexChange: (index: number) => void;
}

export function PDFComparisonViewer({
  sourceFile,
  targetFile,
  sourceName,
  targetName,
  differences,
  currentDiffIndex,
  onDiffIndexChange
}: PDFComparisonViewerProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [sourceNumPages, setSourceNumPages] = useState<number>(0);
  const [targetNumPages, setTargetNumPages] = useState<number>(0);
  const [sourcePageNum, setSourcePageNum] = useState(1);
  const [targetPageNum, setTargetPageNum] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [targetLoading, setTargetLoading] = useState(true);
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const targetContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sourceFile) {
      const url = URL.createObjectURL(sourceFile);
      setSourceUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [sourceFile]);

  useEffect(() => {
    if (targetFile) {
      const url = URL.createObjectURL(targetFile);
      setTargetUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [targetFile]);

  const handleSourceLoadSuccess = ({ numPages }: { numPages: number }) => {
    setSourceNumPages(numPages);
    setSourceLoading(false);
  };

  const handleTargetLoadSuccess = ({ numPages }: { numPages: number }) => {
    setTargetNumPages(numPages);
    setTargetLoading(false);
  };

  // Get all unique text values to highlight from differences
  const sourceHighlightTexts = differences.map(d => d.sourceValue).filter(v => v && v.trim());
  const targetHighlightTexts = differences.map(d => d.targetValue).filter(v => v && v.trim());
  const currentDiff = differences[currentDiffIndex];

  // Apply highlights to PDF text layer after render
  const applyHighlights = useCallback((container: HTMLDivElement | null, textsToHighlight: string[], isSource: boolean) => {
    if (!container) return;
    
    // Wait for text layer to render
    setTimeout(() => {
      const textLayer = container.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) return;
      
      const spans = textLayer.querySelectorAll('span');
      spans.forEach(span => {
        const text = span.textContent || '';
        
        // Check if this span contains any of the difference texts
        for (let i = 0; i < textsToHighlight.length; i++) {
          const highlightText = textsToHighlight[i];
          if (!highlightText) continue;
          
          // Check for partial or full match
          if (text.toLowerCase().includes(highlightText.toLowerCase()) || 
              highlightText.toLowerCase().includes(text.toLowerCase())) {
            const isCurrent = currentDiff && (
              (isSource && currentDiff.sourceValue === highlightText) ||
              (!isSource && currentDiff.targetValue === highlightText)
            );
            
            // Apply highlight style
            span.style.backgroundColor = isCurrent ? 'rgba(239, 68, 68, 0.5)' : 'rgba(239, 68, 68, 0.25)';
            span.style.borderRadius = '2px';
            span.style.padding = '1px 2px';
            span.style.margin = '-1px -2px';
            if (isCurrent) {
              span.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.8)';
              span.style.animation = 'pulse 1.5s infinite';
            }
            break;
          }
        }
      });
    }, 300);
  }, [currentDiff]);

  // Re-apply highlights when pages change or differences change
  useEffect(() => {
    applyHighlights(sourceContainerRef.current, sourceHighlightTexts, true);
  }, [sourcePageNum, sourceLoading, currentDiffIndex, applyHighlights, sourceHighlightTexts]);

  useEffect(() => {
    applyHighlights(targetContainerRef.current, targetHighlightTexts, false);
  }, [targetPageNum, targetLoading, currentDiffIndex, applyHighlights, targetHighlightTexts]);

  return (
    <div className="space-y-4" data-testid="pdf-comparison-viewer">
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .pdf-highlight-mismatch {
          background-color: rgba(239, 68, 68, 0.4) !important;
          border-radius: 2px;
          padding: 1px 2px;
        }
        .pdf-highlight-current {
          background-color: rgba(239, 68, 68, 0.6) !important;
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.8);
          animation: pulse 1.5s infinite;
        }
      `}</style>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(s => Math.max(0.5, s - 0.1))}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(s => Math.min(2, s + 0.1))}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500/40 border border-red-500"></div>
            <span className="text-xs text-muted-foreground">Mismatch</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500/70 border-2 border-red-500 animate-pulse"></div>
            <span className="text-xs text-muted-foreground">Current</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentDiffIndex === 0}
            onClick={() => onDiffIndexChange(Math.max(0, currentDiffIndex - 1))}
            data-testid="button-pdf-prev-diff"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {differences.length > 0 
              ? `Difference ${currentDiffIndex + 1} of ${differences.length}`
              : 'No differences'}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentDiffIndex >= differences.length - 1}
            onClick={() => onDiffIndexChange(Math.min(differences.length - 1, currentDiffIndex + 1))}
            data-testid="button-pdf-next-diff"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {currentDiff && (
        <div className="bg-gradient-to-r from-red-500/10 via-transparent to-red-500/10 rounded-lg p-4 border border-red-500/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Current Difference (Line {currentDiff.row}):</span>
              <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30">
                {currentDiff.status}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div className="bg-red-500/10 rounded p-3 border border-red-500/30">
              <span className="text-xs text-red-400 block mb-1">Source Text (Highlighted in PDF)</span>
              <p className="text-sm font-mono break-words text-red-300">{currentDiff.sourceValue || '(empty)'}</p>
            </div>
            <div className="bg-red-500/10 rounded p-3 border border-red-500/30">
              <span className="text-xs text-red-400 block mb-1">Target Text (Highlighted in PDF)</span>
              <p className="text-sm font-mono break-words text-red-300">{currentDiff.targetValue || '(empty)'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg overflow-hidden bg-muted/20" ref={sourceContainerRef}>
          <div className="bg-blue-500/10 border-b px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-sm font-medium text-blue-400">Source (SSRS)</span>
            </div>
            <Badge variant="outline" className="text-xs">{sourceName}</Badge>
          </div>
          
          <div className="flex items-center justify-center gap-2 py-2 border-b bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              disabled={sourcePageNum <= 1}
              onClick={() => setSourcePageNum(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {sourcePageNum} of {sourceNumPages || '...'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={sourcePageNum >= sourceNumPages}
              onClick={() => setSourcePageNum(p => Math.min(sourceNumPages, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          
          <ScrollArea className="h-[500px]">
            <div className="flex justify-center p-4 min-h-[500px]">
              {sourceUrl ? (
                <Document
                  file={sourceUrl}
                  onLoadSuccess={handleSourceLoadSuccess}
                  loading={
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                    </div>
                  }
                >
                  <Page 
                    pageNumber={sourcePageNum} 
                    scale={scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    onRenderSuccess={() => applyHighlights(sourceContainerRef.current, sourceHighlightTexts, true)}
                  />
                </Document>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No PDF loaded
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="border rounded-lg overflow-hidden bg-muted/20" ref={targetContainerRef}>
          <div className="bg-yellow-500/10 border-b px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="text-sm font-medium text-yellow-400">Target (PowerBI)</span>
            </div>
            <Badge variant="outline" className="text-xs">{targetName}</Badge>
          </div>
          
          <div className="flex items-center justify-center gap-2 py-2 border-b bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              disabled={targetPageNum <= 1}
              onClick={() => setTargetPageNum(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {targetPageNum} of {targetNumPages || '...'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={targetPageNum >= targetNumPages}
              onClick={() => setTargetPageNum(p => Math.min(targetNumPages, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          
          <ScrollArea className="h-[500px]">
            <div className="flex justify-center p-4 min-h-[500px]">
              {targetUrl ? (
                <Document
                  file={targetUrl}
                  onLoadSuccess={handleTargetLoadSuccess}
                  loading={
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
                    </div>
                  }
                >
                  <Page 
                    pageNumber={targetPageNum} 
                    scale={scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    onRenderSuccess={() => applyHighlights(targetContainerRef.current, targetHighlightTexts, false)}
                  />
                </Document>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No PDF loaded
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {differences.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b flex items-center justify-between">
            <span className="text-sm font-medium">All Differences ({differences.length})</span>
            <span className="text-xs text-red-400">Click to highlight in PDFs above</span>
          </div>
          <ScrollArea className="h-[200px]">
            <div className="p-2 space-y-1">
              {differences.map((diff, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-4 p-2 rounded cursor-pointer transition-colors ${
                    idx === currentDiffIndex 
                      ? 'bg-red-500/20 border border-red-500/40' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => onDiffIndexChange(idx)}
                  data-testid={`diff-item-${idx}`}
                >
                  <span className="text-xs text-muted-foreground w-16">Line {diff.row}</span>
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-mono truncate max-w-[200px] px-1 rounded ${
                      idx === currentDiffIndex ? 'bg-red-500/30 text-red-300' : 'text-blue-400'
                    }`} title={diff.sourceValue}>
                      {diff.sourceValue || '(empty)'}
                    </span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className={`text-xs font-mono truncate max-w-[200px] px-1 rounded ${
                      idx === currentDiffIndex ? 'bg-red-500/30 text-red-300' : 'text-yellow-400'
                    }`} title={diff.targetValue}>
                      {diff.targetValue || '(empty)'}
                    </span>
                  </div>
                  <Badge className={`flex-shrink-0 ${
                    diff.status === 'tolerance' 
                      ? 'bg-yellow-500/20 text-yellow-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {diff.status}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
