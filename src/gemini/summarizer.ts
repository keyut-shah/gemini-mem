import { MemoryDatabase } from '../core/database';
import { GeminiClient } from './client';

export class SessionSummarizer {
  constructor(private db: MemoryDatabase, private gemini: GeminiClient) {}

  async summarize(sessionId: string): Promise<string> {
    const session = this.db.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const compressed = this.db.getObservationsForSession(sessionId)
      .filter((o) => o.status === 'compressed' && o.compressed_data)
      .map((o) => o.compressed_data as string);

    if (compressed.length === 0) {
      return 'No compressed observations yet.';
    }

    const summary = await this.gemini.summarizeSession(session.user_prompt || 'Coding session', compressed);
    this.db.endSession(sessionId, summary, 'summarized');
    return summary;
  }
}
