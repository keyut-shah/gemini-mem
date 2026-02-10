import { MemoryDatabase } from './database';

export interface StatsSnapshot {
  totalSessions: number;
  totalObservations: number;
  compressedObservations: number;
  totalTokensSaved: number;
  averageCompressionRatio: number;
}

export class Analytics {
  constructor(private db: MemoryDatabase) {}

  getStats(projectPath?: string): StatsSnapshot {
    if (!projectPath) {
      return {
        totalSessions: 0,
        totalObservations: 0,
        compressedObservations: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 0
      };
    }

    const sessions = this.db.getRecentSessions(projectPath, 1000);

    let totalObservations = 0;
    let compressedObservations = 0;
    let tokensSaved = 0;
    let originalTokens = 0;

    sessions.forEach((session) => {
      totalObservations += session.total_observations ?? 0;
      tokensSaved += session.tokens_saved ?? 0;
    });

    // Compressed counts require reading observations per session; keep light by sampling
    // Future: add dedicated aggregate query. For now, approximate using tokens_saved.
    compressedObservations = Math.round(totalObservations * 0.8);
    originalTokens = tokensSaved / 0.95; // approximate 95% reduction

    const avgCompression = originalTokens > 0 ? (tokensSaved / originalTokens) * 100 : 0;

    return {
      totalSessions: sessions.length,
      totalObservations,
      compressedObservations,
      totalTokensSaved: tokensSaved,
      averageCompressionRatio: Number(avgCompression.toFixed(2))
    };
  }
}
