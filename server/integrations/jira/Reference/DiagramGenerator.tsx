import { useState } from 'react';
import { generateMermaidSyntax } from '../services/openaiService';
import { mermaidToSvgString, renderMermaidToSvg } from './mermaidService';
import { createConfluencePage } from './jiraConfluenceService';
import DiagramPreview from './DiagramPreview';
import './DiagramPreview.css';

type DiagramType = 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt';

const DiagramGenerator = () => {
  const [description, setDescription] = useState('');
  const [diagramType, setDiagramType] = useState<DiagramType>('flowchart');
  const [mermaidSyntax, setMermaidSyntax] = useState('');
  const [svgContent, setSvgContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Please enter a description for the diagram');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Generate Mermaid syntax using OpenAI
      const syntax = await generateMermaidSyntax({
        description,
        diagramType,
      });

      setMermaidSyntax(syntax);

      // Convert to SVG
      const svg = await mermaidToSvgString(syntax);
      setSvgContent(svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate diagram');
    } finally {
      setLoading(false);
    }
  };

  const handleReRenderDiagram = async () => {
    if (!mermaidSyntax.trim()) {
      setError('No Mermaid syntax to render');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Convert current Mermaid syntax to SVG
      const svg = await mermaidToSvgString(mermaidSyntax);
      setSvgContent(svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render diagram');
    } finally {
      setLoading(false);
    }
  };

  const handlePushToConfluence = async () => {
    if (!mermaidSyntax.trim()) {
      setError('Please generate a diagram first');
      return;
    }

    if (!pageTitle.trim()) {
      setError('Please enter a page title');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Always convert current Mermaid syntax to SVG before pushing
      // This ensures we push the latest version even if syntax was edited
      let finalSvg = svgContent;
      
      // If we have Mermaid syntax, always convert to SVG to ensure we have the latest version
      if (mermaidSyntax.trim()) {
        console.log('Converting Mermaid syntax to SVG before pushing to Confluence...');
        try {
          finalSvg = await mermaidToSvgString(mermaidSyntax);
          setSvgContent(finalSvg); // Update state with latest SVG
          console.log('SVG conversion successful. SVG length:', finalSvg.length);
        } catch (svgError) {
          console.error('Failed to convert Mermaid to SVG:', svgError);
          if (!finalSvg) {
            throw new Error('Failed to convert diagram to SVG. Please try re-rendering the diagram first.');
          }
          console.warn('Using existing SVG content');
        }
      }

      if (!finalSvg || !finalSvg.trim()) {
        throw new Error('No SVG content available to push. Please generate and render the diagram first.');
      }

      // Validate SVG format
      if (!finalSvg.trim().toLowerCase().startsWith('<svg')) {
        throw new Error('Invalid SVG format. The diagram must be properly converted to SVG.');
      }

      console.log('Pushing SVG to Confluence...');
      console.log('SVG length:', finalSvg.length);
      
      // Add timeout to prevent hanging
      const pushPromise = createConfluencePage(pageTitle, finalSvg);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout: Confluence push took too long')), 60000)
      );
      
      // Push the SVG to Confluence with timeout
      const page = await Promise.race([pushPromise, timeoutPromise]) as Awaited<ReturnType<typeof createConfluencePage>>;
      
      console.log('Successfully pushed to Confluence:', page.id);
      setSuccess(`Successfully created Confluence page: ${page.title} (ID: ${page.id})`);
    } catch (err) {
      console.error('Error pushing to Confluence:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to push to Confluence';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="diagram-generator">
      <div className="generator-panel">
        <div className="input-section">
          <label htmlFor="diagram-type">Diagram Type</label>
          <select
            id="diagram-type"
            value={diagramType}
            onChange={(e) => setDiagramType(e.target.value as DiagramType)}
            className="select-input"
          >
            <option value="flowchart">Flowchart</option>
            <option value="sequence">Sequence Diagram</option>
            <option value="class">Class Diagram</option>
            <option value="state">State Diagram</option>
            <option value="er">Entity Relationship</option>
            <option value="gantt">Gantt Chart</option>
          </select>

          <label htmlFor="description">Diagram Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the diagram you want to generate. For example: 'A user login flow with authentication, validation, and session creation'"
            className="textarea-input"
            rows={5}
          />

          <button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="generate-button"
          >
            {loading ? 'Generating...' : 'Generate Diagram'}
          </button>
        </div>

        {mermaidSyntax && (
          <div className="mermaid-section">
            <label>Generated Mermaid Syntax</label>
            <textarea
              value={mermaidSyntax}
              onChange={(e) => setMermaidSyntax(e.target.value)}
              className="code-textarea"
              rows={10}
            />
            <button
              onClick={handleReRenderDiagram}
              disabled={loading}
              className="rerender-button"
              style={{ marginTop: '10px' }}
            >
              {loading ? 'Rendering...' : 'Re-render Diagram'}
            </button>
            <small style={{ display: 'block', marginTop: '5px', color: '#666' }}>
              Edit the Mermaid syntax above and click "Re-render" to update the preview. 
              The latest version will be pushed to Confluence.
            </small>
          </div>
        )}

        {svgContent && (
          <div className="confluence-section">
            <label htmlFor="page-title">Confluence Page Title</label>
            <input
              id="page-title"
              type="text"
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
              placeholder="Enter page title"
              className="text-input"
            />

            <button
              onClick={handlePushToConfluence}
              disabled={loading || !pageTitle.trim()}
              className="push-button"
            >
              {loading ? 'Pushing...' : 'Push to Confluence'}
            </button>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
      </div>

      {svgContent && (
        <div className="preview-panel">
          <DiagramPreview mermaidSyntax={mermaidSyntax} svgContent={svgContent} />
        </div>
      )}
    </div>
  );
};

export default DiagramGenerator;
