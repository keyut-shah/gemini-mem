import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CompressInput {
  functionName: string;
  functionArgs?: string;
  functionResult?: string;
}

export class GeminiClient {
  private client: GoogleGenerativeAI;
  private modelName: string;
  private mock: boolean;

  constructor(private apiKey: string = process.env.GEMINI_API_KEY || '') {
    this.mock = process.env.MOCK_GEMINI === '1';
    if (!this.mock && !apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }
    this.client = this.mock ? ({} as GoogleGenerativeAI) : new GoogleGenerativeAI(apiKey);
    // Use -latest alias by default; allow override with GEMINI_MODEL to match available endpoints.
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async compressObservation({ functionName, functionArgs = '', functionResult = '' }: CompressInput): Promise<string> {
    if (this.mock) {
      return this.mockCompress(functionName, functionArgs, functionResult);
    }
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName });
      const prompt = this.buildCompressionPrompt(functionName, functionArgs, functionResult);
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 }
      });
      return result.response.text();
    } catch (err) {
      if (process.env.MOCK_GEMINI_FALLBACK !== '0') {
        return this.mockCompress(functionName, functionArgs, functionResult);
      }
      throw err;
    }
  }

  async summarizeSession(userPrompt: string, observations: string[]): Promise<string> {
    if (this.mock) {
      return this.mockSummarize(userPrompt, observations);
    }
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName });
      const prompt = this.buildSummaryPrompt(userPrompt, observations);
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
      });
      return result.response.text();
    } catch (err) {
      if (process.env.MOCK_GEMINI_FALLBACK !== '0') {
        return this.mockSummarize(userPrompt, observations);
      }
      throw err;
    }
  }

  private buildCompressionPrompt(fn: string, args: string, res: string): string {
    return [
      'Summarize this coding action in under 120 tokens:',
      `Function: ${fn}`,
      `Args: ${args?.slice(0, 1500)}`,
      `Result: ${res?.slice(0, 1500)}`,
      'Include: what changed, key files, why it matters.',
      'Skip boilerplate.'
    ].join('\n');
  }

  private buildSummaryPrompt(userPrompt: string, observations: string[]): string {
    const lines = observations.map((obs, i) => `${i + 1}. ${obs}`).join('\n');
    return [
      'Summarize the session in 3-4 sentences (no bullets).',
      `User goal: ${userPrompt}`,
      'Actions:',
      lines,
      'Cover accomplishments, key files, decisions, and learnings.'
    ].join('\n');
  }

  private mockCompress(fn: string, args: string, res: string): string {
    return `MOCK: ${fn} -> ${args?.slice(0, 80)} | result: ${res?.slice(0, 80)}`;
  }

  private mockSummarize(userPrompt: string, observations: string[]): string {
    const joined = observations.slice(0, 5).join(' | ');
    return `MOCK SUMMARY: Goal=${userPrompt}. Observations=${joined}`;
  }
}
