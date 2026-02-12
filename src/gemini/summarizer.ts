import { MemoryDatabase } from '../core/database';
import { GeminiClient } from './client';

const MIN_SUMMARY_LENGTH = 200; // characters
const MAX_RETRIES = 2;

export class SessionSummarizer {
  constructor(private db: MemoryDatabase, private gemini: GeminiClient) {}

  async summarize(sessionId: string): Promise<string> {
    const session = this.db.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const observations = this.db.getObservationsForSession(sessionId);
    console.log('[Summarizer] Session', sessionId, {
      totalObservations: observations.length
    });

    const compressed = observations.filter((o) => o.status === 'compressed' && o.compressed_data);
    console.log('[Summarizer] Compressed observations', {
      compressedCount: compressed.length
    });

    if (compressed.length === 0) {
      console.warn('[Summarizer] No compressed observations yet for session', sessionId);
      const fallback = `Session started with intent: "${session.user_prompt || 'Unknown'}". No compressed observations are available yet.`;
      return fallback;
    }

    const compressedTexts = compressed.map((o) => o.compressed_data as string);
    console.log('[Summarizer] Building summary with compressed texts', {
      snippets: compressedTexts.length
    });

    const userPrompt = session.user_prompt || 'Coding session';
    let summary = await this.gemini.summarizeSession(userPrompt, compressedTexts);
    console.log('[Summarizer] Initial summary', {
      sessionId,
      summaryLength: summary.length
    });

    // Quality guardrail: retry if summary is too short
    let retries = 0;
    while (summary.length < MIN_SUMMARY_LENGTH && retries < MAX_RETRIES) {
      retries++;
      console.warn('[Summarizer] Summary too short, retrying', {
        attempt: retries,
        currentLength: summary.length,
        minRequired: MIN_SUMMARY_LENGTH
      });
      summary = await this.gemini.summarizeSession(
        `${userPrompt} (IMPORTANT: provide a detailed, comprehensive summary — the previous attempt was too brief)`,
        compressedTexts
      );
      console.log('[Summarizer] Retry result', {
        attempt: retries,
        summaryLength: summary.length
      });
    }

    if (summary.length < MIN_SUMMARY_LENGTH) {
      console.warn('[Summarizer] Summary still short after retries, enriching with observation data');
      summary = this.enrichShortSummary(summary, session.user_prompt, compressedTexts);
    }

    console.log('[Summarizer] Final summary', {
      sessionId,
      summaryLength: summary.length,
      retries
    });

    this.db.endSession(sessionId, summary, 'summarized');
    return summary;
  }

  private enrichShortSummary(summary: string, userPrompt: string | undefined, compressedTexts: string[]): string {
    const parts = [summary];

    if (userPrompt) {
      parts.push(`Session goal: ${userPrompt}.`);
    }

    const filePattern = /(?:[\w\-]+\/)*[\w\-]+\.\w{1,6}/g;
    const allFiles = new Set<string>();
    for (const text of compressedTexts) {
      const matches = text.match(filePattern);
      if (matches) matches.forEach((f) => allFiles.add(f));
    }
    if (allFiles.size > 0) {
      parts.push(`Key files touched: ${[...allFiles].slice(0, 10).join(', ')}.`);
    }

    parts.push(`Total actions recorded: ${compressedTexts.length}.`);

    return parts.join(' ');
  }
}
