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
    console.error('[Summarizer] Session', sessionId, {
      totalObservations: observations.length
    });

    const compressed = observations.filter((o) => o.status === 'compressed' && o.compressed_data);
    console.error('[Summarizer] Compressed observations', {
      compressedCount: compressed.length
    });

    // Gather notes as additional context (or fallback if no observations)
    const notes = this.db.getNotesForSession(sessionId);
    console.error('[Summarizer] Notes found', { notesCount: notes.length });

    if (compressed.length === 0 && notes.length === 0) {
      console.warn('[Summarizer] No observations or notes for session', sessionId);
      const fallback = `Session started with intent: "${session.user_prompt || 'Unknown'}". No observations or notes were recorded.`;
      this.db.endSession(sessionId, fallback, 'summarized');
      return fallback;
    }

    // Build texts from compressed observations + notes
    const compressedTexts = compressed.map((o) => o.compressed_data as string);

    // Add notes as context (these capture prompt/response pairs)
    for (const note of notes) {
      const parts: string[] = [];
      if (note.user_prompt) parts.push(`User asked: ${note.user_prompt}`);
      if (note.ai_response) parts.push(`AI did: ${note.ai_response}`);
      if (note.annotation) parts.push(`Note: ${note.annotation}`);
      if (parts.length > 0) {
        compressedTexts.push(parts.join('. '));
      }
    }
    console.error('[Summarizer] Building summary with compressed texts', {
      snippets: compressedTexts.length
    });

    const userPrompt = session.user_prompt || 'Coding session';
    let summary = await this.gemini.summarizeSession(userPrompt, compressedTexts);
    console.error('[Summarizer] Initial summary', {
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
      console.error('[Summarizer] Retry result', {
        attempt: retries,
        summaryLength: summary.length
      });
    }

    if (summary.length < MIN_SUMMARY_LENGTH) {
      console.warn('[Summarizer] Summary still short after retries, enriching with observation data');
      summary = this.enrichShortSummary(summary, session.user_prompt, compressedTexts);
    }

    console.error('[Summarizer] Final summary', {
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
