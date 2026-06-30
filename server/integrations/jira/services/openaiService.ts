import OpenAI from 'openai';
import { getConfig } from '../config';
import { hasBedrock, azureOpenAI as bedrockLLM } from '../../../llm-config';

const getOpenAIClient = (): any => {
  if (hasBedrock && bedrockLLM) {
    return bedrockLLM;
  }

  const config = getConfig();
  
  if (config.azureOpenAIEndpoint) {
    const endpoint = config.azureOpenAIEndpoint.endsWith('/') 
      ? config.azureOpenAIEndpoint 
      : `${config.azureOpenAIEndpoint}/`;
    
    return new OpenAI({
      apiKey: config.azureOpenAIApiKey,
      baseURL: `${endpoint}openai/deployments/${config.azureOpenAIDeployment}`,
      defaultQuery: { 'api-version': config.azureOpenAIApiVersion },
      defaultHeaders: {
        'api-key': config.azureOpenAIApiKey,
      },
      dangerouslyAllowBrowser: true,
    });
  }
  
  return new OpenAI({
    apiKey: config.azureOpenAIApiKey,
    dangerouslyAllowBrowser: true,
  });
};

export interface DiagramRequest {
  description: string;
  diagramType?: 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt';
}

type MermaidDiagramType = Exclude<DiagramRequest['diagramType'], undefined>;

export const generateMermaidSyntax = async (
  request: DiagramRequest
): Promise<string> => {
  const { description, diagramType = 'flowchart' } = request;
  const config = getConfig();
  if (!config.azureOpenAIApiKey) {
    throw new Error('OpenAI API key is missing. Please configure your Azure OpenAI API key or standard OpenAI API key.');
  }

  if (config.azureOpenAIEndpoint && !config.azureOpenAIDeployment) {
    throw new Error('Azure OpenAI deployment name is missing. Please set AZURE_OPENAI_DEPLOYMENT when using an Azure endpoint.');
  }

  const prompt = `Generate a Mermaid diagram syntax for a ${diagramType} diagram based on the following description:

${description}

Use one of these exact Mermaid diagram headers:
- Flowchart: flowchart TD or graph TD
- Sequence: sequenceDiagram
- Class: classDiagram
- State: stateDiagram or stateDiagram-v2
- ER: erDiagram
- Gantt: gantt

Return ONLY the Mermaid syntax code, without any markdown code blocks, explanations, or additional text. Do not return prose or the diagram type as plain text. The syntax should be valid Mermaid code that can be directly rendered.`;

  try {
    const openai = getOpenAIClient();
    // For Azure OpenAI, the model is specified in the deployment name
    const modelName = config.azureOpenAIEndpoint ? config.azureOpenAIDeployment! : 'gpt-4';
    
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'You are a Mermaid diagram expert. Generate valid Mermaid syntax code only, without markdown blocks, comments, explanations, or extra text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    let mermaidCode = completion.choices[0]?.message?.content || '';
    
    // Clean up AI response: remove markdown fences and trim whitespace.
    mermaidCode = mermaidCode
      .replace(/```\s*mermaid\s*/gi, '')
      .replace(/```/g, '')
      .trim();

    // Keep only the Mermaid diagram block starting at a known Mermaid header.
    const diagramStartMatch = mermaidCode.match(/(flowchart(?:\s+\w+)?|graph(?:\s+\w+)?|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt)\b[\s\S]*/i);
    if (diagramStartMatch) {
      mermaidCode = diagramStartMatch[0].trim();
    }

    const headerRegexMap: Record<MermaidDiagramType, RegExp> = {
      flowchart: /^(flowchart|graph)\b/i,
      sequence: /^sequenceDiagram\b/i,
      class: /^classDiagram\b/i,
      state: /^stateDiagram(?:-v2)?\b/i,
      er: /^erDiagram\b/i,
      gantt: /^gantt\b/i,
    };

    const defaultHeaderMap: Record<MermaidDiagramType, string> = {
      flowchart: 'flowchart TD',
      sequence: 'sequenceDiagram',
      class: 'classDiagram',
      state: 'stateDiagram-v2',
      er: 'erDiagram',
      gantt: 'gantt',
    };

    if (!headerRegexMap[diagramType].test(mermaidCode)) {
      mermaidCode = `${defaultHeaderMap[diagramType]}\n${mermaidCode}`.trim();
    }

    return mermaidCode;
  } catch (error) {
    console.error('Error generating Mermaid syntax:', error);
    throw new Error('Failed to generate Mermaid syntax. Please check your Azure OpenAI configuration.');
  }
};
