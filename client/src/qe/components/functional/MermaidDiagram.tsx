import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const diagramId = useRef(`mermaid-${Date.now()}`);

  useEffect(() => {
    if (!chart) return;

    let cancelled = false;
    setError(null);
    setRendered(false);

    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
          securityLevel: 'loose',
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Mermaid render timeout")), 10000);
        });

        const { svg } = await Promise.race([
          mermaid.render(diagramId.current, chart),
          timeoutPromise
        ]);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setRendered(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Mermaid render error:', err);
          setError(err.message || 'Failed to render diagram');
        }
      }
    };

    renderDiagram();
    return () => { cancelled = true; };
  }, [chart]);

  const handleDownload = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow-diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setScale(s => Math.min(s + 0.2, 3))}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setScale(s => Math.max(s - 0.2, 0.3))}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setScale(1)}>
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
        {rendered && (
          <Button variant="outline" size="sm" onClick={handleDownload} className="ml-auto">
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export SVG
          </Button>
        )}
      </div>

      {/* Diagram container */}
      <div className="border border-border rounded-xl bg-white dark:bg-gray-950 overflow-auto" style={{ maxHeight: '500px' }}>
        {error ? (
          <div className="flex items-center justify-center h-48 text-red-500">
            <p className="text-sm">Failed to render diagram: {error}</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', transition: 'transform 0.2s ease', padding: '1rem' }}
          />
        )}
      </div>
    </div>
  );
}
