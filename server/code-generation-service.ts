import { ai as sharedAiClient } from "./ai-client";
import { withAiContext } from "./observability/ai-context";

interface GenerateCodeParams {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  storyId: number;
}

export async function generateCodeFromUserStory(params: GenerateCodeParams): Promise<string> {
  const { title, description, acceptanceCriteria, storyId } = params;

  // Strip HTML tags from description and acceptance criteria
  const cleanDescription = description?.replace(/<[^>]*>/g, '') || '';
  const cleanAcceptanceCriteria = acceptanceCriteria?.replace(/<[^>]*>/g, '') || '';

  const prompt = `You are an expert software developer. Generate production-ready code implementation for the following user story.

User Story ID: ${storyId}
Title: ${title}

${cleanDescription ? `Description:\n${cleanDescription}\n` : ''}
${cleanAcceptanceCriteria ? `Acceptance Criteria:\n${cleanAcceptanceCriteria}\n` : ''}

Requirements:
1. Generate clean, well-documented, production-ready code
2. Include TypeScript/JavaScript implementations
3. Add proper error handling
4. Include necessary imports
5. Add inline comments explaining the logic
6. Follow best practices and design patterns

Generate the code implementation below:`;

  try {
    // Code generation is intentionally NOT logged to universal_ai_usage_logs.
    const response = await withAiContext({ skipLogging: true, feature: "code_generation" }, () =>
      sharedAiClient.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are an expert software developer who generates clean, production-ready code based on user stories. Always provide complete, working implementations with proper error handling and documentation."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 8192,
      temperature: 0.7,
    }));

    const generatedCode = response.choices[0]?.message?.content || '';
    
    if (!generatedCode) {
      throw new Error('No code generated from OpenAI');
    }

    return generatedCode;
  } catch (error) {
    console.error('Error generating code with OpenAI:', error);
    throw new Error('Failed to generate code with AI');
  }
}
