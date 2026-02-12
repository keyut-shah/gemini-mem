import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export type SessionStatus = 'active' | 'summarized' | 'completed';

export interface Session {
  id: string;
  project_path: string;
  user_prompt?: string;
  summary?: string;
  created_at: number;
  ended_at?: number;
  status: SessionStatus;
  total_observations: number;
  tokens_saved: number;
}

export type ObservationStatus = 'pending' | 'captured' | 'compressed' | 'failed';

export interface Observation {
  id: string;
  session_id: string;
  function_name: string;
  function_args?: string;
  function_result?: string;
  compressed_data?: string;
  original_tokens?: number;
  compressed_tokens?: number;
  tokens_saved?: number;
  timestamp: number;
  status: ObservationStatus;
  observation_type?: string;
}

export interface SearchResult extends Session {
  rank?: number;
  matched_text?: string;
}

export class MemoryDatabase {
  // Using `any` here because we provide a local ambient type for better-sqlite3 in src/types.
  private db: any;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'antigravity-mem.db');
    const resolvedPath = dbPath ?? process.env.ANTIGRAVITY_MEM_DB ?? defaultPath;
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.enablePragmas();
    this.ensureSchema();
  }

  close() {
    this.db.close();
  }

  createSession(projectPath: string, userPrompt?: string): Session {
    const session: Session = {
      id: `sess_${uuidv4()}`,
      project_path: projectPath,
      user_prompt: userPrompt,
      summary: undefined,
      created_at: Date.now(),
      ended_at: undefined,
      status: 'active',
      total_observations: 0,
      tokens_saved: 0
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, project_path, user_prompt, summary, created_at, ended_at,
        status, total_observations, tokens_saved
      ) VALUES (@id, @project_path, @user_prompt, @summary, @created_at,
        @ended_at, @status, @total_observations, @tokens_saved)
    `);
    stmt.run(session);
    return session;
  }

  endSession(sessionId: string, summary?: string, status: SessionStatus = 'summarized') {
    const endedAt = Date.now();
    this.db.prepare(
      `UPDATE sessions SET summary = COALESCE(?, summary), status = ?, ended_at = ? WHERE id = ?`
    ).run(summary, status, endedAt, sessionId);
  }

  saveObservation(sessionId: string, functionName: string, functionArgs?: unknown, observationType?: string): Observation {
    const obs: Observation = {
      id: `obs_${uuidv4()}`,
      session_id: sessionId,
      function_name: functionName,
      function_args: functionArgs ? JSON.stringify(functionArgs) : undefined,
      function_result: undefined,
      compressed_data: undefined,
      original_tokens: undefined,
      compressed_tokens: undefined,
      tokens_saved: undefined,
      timestamp: Date.now(),
      status: 'pending',
      observation_type: observationType
    };

    const stmt = this.db.prepare(`
      INSERT INTO observations (
        id, session_id, function_name, function_args, function_result,
        compressed_data, original_tokens, compressed_tokens, tokens_saved,
        timestamp, status, observation_type
      ) VALUES (@id, @session_id, @function_name, @function_args, @function_result,
        @compressed_data, @original_tokens, @compressed_tokens, @tokens_saved,
        @timestamp, @status, @observation_type)
    `);
    stmt.run(obs);

    this.db.prepare(
      `UPDATE sessions SET total_observations = total_observations + 1 WHERE id = ?`
    ).run(sessionId);

    return obs;
  }

  updateObservationResult(observationId: string, result: unknown) {
    this.db.prepare(
      `UPDATE observations SET function_result = ?, status = 'captured', timestamp = ? WHERE id = ?`
    ).run(JSON.stringify(result), Date.now(), observationId);
  }

  markObservationCompressed(
    observationId: string,
    compressedData: string,
    originalTokens: number,
    compressedTokens: number
  ) {
    const tokensSaved = Math.max(originalTokens - compressedTokens, 0);
    this.db.prepare(
      `UPDATE observations
       SET compressed_data = ?,
           original_tokens = ?,
           compressed_tokens = ?,
           tokens_saved = ?,
           status = 'compressed'
       WHERE id = ?`
    ).run(compressedData, originalTokens, compressedTokens, tokensSaved, observationId);

    console.log('[DB] Marked observation as compressed', {
      observationId,
      originalTokens,
      compressedTokens,
      tokensSaved
    });
  }

  getSession(sessionId: string): Session | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Session | undefined;
  }

  getObservation(observationId: string): Observation | undefined {
    return this.db.prepare(`SELECT * FROM observations WHERE id = ?`).get(observationId) as Observation | undefined;
  }

  getObservationsForSession(sessionId: string): Observation[] {
    return this.db.prepare(
      `SELECT * FROM observations WHERE session_id = ? ORDER BY timestamp ASC`
    ).all(sessionId) as Observation[];
  }

  getRecentSessions(projectPath: string, limit = 5): Session[] {
    return this.db.prepare(
      `SELECT * FROM sessions WHERE project_path = ? AND status != 'active' ORDER BY created_at DESC LIMIT ?`
    ).all(projectPath, limit) as Session[];
  }

  searchSessions(projectPath: string, query: string, limit = 5): SearchResult[] {
    const results = this.db.prepare(
      `SELECT s.*, highlight(sessions_fts, 1, '<mark>', '</mark>') AS matched_text, rank
       FROM sessions s
       JOIN sessions_fts fts ON s.id = fts.session_id
       WHERE s.project_path = ? AND sessions_fts MATCH ?
       ORDER BY rank LIMIT ?`
    ).all(projectPath, this.buildSearchQuery(query), limit) as SearchResult[];
    return results;
  }

  private buildSearchQuery(prompt: string): string {
    const keywords = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    return keywords.join(' OR ');
  }

  private enablePragmas() {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  private ensureSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        user_prompt TEXT,
        summary TEXT,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT DEFAULT 'active',
        total_observations INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        function_name TEXT NOT NULL,
        function_args TEXT,
        function_result TEXT,
        compressed_data TEXT,
        original_tokens INTEGER,
        compressed_tokens INTEGER,
        tokens_saved INTEGER,
        timestamp INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        observation_type TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        session_id UNINDEXED,
        user_prompt,
        summary,
        content='sessions',
        content_rowid='rowid'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        observation_id UNINDEXED,
        function_name,
        compressed_data,
        content='observations',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS sessions_fts_insert AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(session_id, user_prompt, summary)
        VALUES (new.id, new.user_prompt, new.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(observation_id, function_name, compressed_data)
        VALUES (new.id, new.function_name, new.compressed_data);
      END;
    `;

    this.db.exec(schema);
  }
}
