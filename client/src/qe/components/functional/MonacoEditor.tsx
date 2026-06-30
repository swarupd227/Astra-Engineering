import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface MonacoEditorProps {
  value: string;
  language?: string;
  fileName?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  className?: string;
}

export function MonacoEditor({
  value,
  language,
  fileName,
  onChange,
  readOnly = false,
  height = '400px',
  className,
}: MonacoEditorProps) {
  const [EditorComp, setEditorComp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const detectedLanguage =
    language ??
    (fileName?.endsWith('.feature')
      ? 'plaintext'
      : fileName?.endsWith('.json')
      ? 'json'
      : fileName?.endsWith('.js')
      ? 'javascript'
      : 'typescript');

  useEffect(() => {
    let disposed = false;

    import('@monaco-editor/react')
      .then(m => {
        if (!disposed) {
          setEditorComp(() => m.default);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!disposed) {
          setError(err?.message ?? 'Failed to load Monaco editor');
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (error) {
    return (
      <div
        className={`border border-border rounded-lg overflow-auto bg-gray-900 text-green-400 font-mono text-xs p-4 ${className ?? ''}`}
        style={{ height }}
      >
        <pre>{value}</pre>
      </div>
    );
  }

  if (loading || !EditorComp) {
    return (
      <div
        className={`flex items-center justify-center border border-border rounded-lg bg-[#1e1e1e] ${className ?? ''}`}
        style={{ height }}
      >
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading editor...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border border-border rounded-lg overflow-hidden ${className ?? ''}`}
      style={{ height }}
    >
      <EditorComp
        height={height}
        language={detectedLanguage}
        value={value}
        onChange={(val: string | undefined) => onChange?.(val ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 1.6,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          bracketPairColorization: { enabled: true },
          tabSize: 2,
          automaticLayout: true,
        }}
        theme="vs-dark"
        loading={
          <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        }
      />
    </div>
  );
}
