import React from 'react';

interface DiagramPreviewProps {
  mermaidSyntax: string;
  svgContent: string;
}

const DiagramPreview: React.FC<DiagramPreviewProps> = ({ mermaidSyntax, svgContent }) => {
  return (
    <div className="diagram-preview">
      <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#333' }}>Diagram Preview</h3>
      <div 
        className="svg-container"
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: '#fafafa',
          overflow: 'auto',
          maxHeight: '600px',
        }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
      {mermaidSyntax && (
        <details style={{ marginTop: '20px' }}>
          <summary style={{ cursor: 'pointer', color: '#667eea', fontWeight: 600 }}>
            View Mermaid Syntax
          </summary>
          <pre
            style={{
              marginTop: '10px',
              padding: '15px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              overflow: 'auto',
              fontSize: '0.9rem',
              fontFamily: 'Courier New, monospace',
            }}
          >
            <code>{mermaidSyntax}</code>
          </pre>
        </details>
      )}
    </div>
  );
};

export default DiagramPreview;
