import { MemoryDatabase, Session } from './database';

export interface BuildContextOptions {
  projectPath: string;
  currentPrompt?: string;
  recentLimit?: number;
  searchLimit?: number;
}

export class ContextManager {
  constructor(private db: MemoryDatabase) {}

  buildContext({ projectPath, currentPrompt = '', recentLimit = 5, searchLimit = 3 }: BuildContextOptions): string {
    const recent = this.db.getRecentSessions(projectPath, recentLimit);
    const relevant = currentPrompt
      ? this.db.searchSessions(projectPath, currentPrompt, searchLimit)
      : [];

    const merged = this.deduplicate([...recent, ...relevant]);
    return this.formatContext(merged);
  }

  private deduplicate(sessions: Session[]): Session[] {
    const seen = new Set<string>();
    return sessions.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  private formatContext(sessions: Session[]): string {
    if (sessions.length === 0) {
      return 'No prior memory for this project.';
    }

    const parts: string[] = [];
    parts.push('# Antigravity Memory Context');
    parts.push('Use these past sessions to ground your response.');

    sessions.forEach((session) => {
      const date = new Date(session.created_at).toISOString().split('T')[0];
      parts.push(`\n## Session ${date}`);
      if (session.user_prompt) parts.push(`Task: ${session.user_prompt}`);
      if (session.summary) parts.push(session.summary.trim());
      if (session.total_observations) parts.push(`Changes captured: ${session.total_observations}`);
    });

    parts.push('\n--\nRespond using this context; do not ask the user to restate it.');
    return parts.join('\n');
  }
}
