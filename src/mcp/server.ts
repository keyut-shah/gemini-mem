#!/usr/bin/env node

import path from 'path';
import os from 'os';

// MCP SDK imports
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Direct imports of our modules
import { MemoryDatabase } from '../core/database';
import { ContextManager } from '../core/context-manager';
import { GeminiClient } from '../gemini/client';
import { SessionSummarizer } from '../gemini/summarizer';

// DB path: prefer env var (set by MCP config), fallback to ~/.antigravity-mem/memory.db
const dbPath = process.env.ANTIGRAVITY_MEM_DB || path.join(os.homedir(), '.antigravity-mem', 'memory.db');
console.error('[MCP] Initializing with DB:', dbPath);
console.error('[MCP] Gemini model:', process.env.GEMINI_MODEL || 'default');

let db: MemoryDatabase;
let contextBuilder: ContextManager;
let gemini: GeminiClient;
let summarizer: SessionSummarizer;

try {
  db = new MemoryDatabase(dbPath);
  contextBuilder = new ContextManager(db);
  gemini = new GeminiClient();
  summarizer = new SessionSummarizer(db, gemini);
  console.error('[MCP] All modules initialized successfully');
} catch (err: any) {
  console.error('[MCP] FATAL: Failed to initialize modules:', err.message);
  process.exit(1);
}

const server = new McpServer({
  name: 'antigravity-memory',
  version: '0.1.0'
});

// ─── Tool: Start a memory session ────────────────────────────────────────────

server.tool(
  'memory_start_session',
  'Create a new memory session to track coding work for a project. Call this at the START of a task. After making changes, use memory_save_note to record what you did (this is required for good summaries). When done, call memory_end_session.',
  {
    projectPath: z.string().describe('Absolute path to the project directory'),
    userPrompt: z.string().optional().describe('What the user wants to accomplish in this session')
  },
  async ({ projectPath, userPrompt }) => {
    try {
      const session = db.createSession(projectPath, userPrompt);
      return {
        content: [{
          type: 'text' as const,
          text: `Memory session started.\nSession ID: ${session.id}\nProject: ${projectPath}\nUse this session ID for save_note and end_session calls.`
        }]
      };
    } catch (err: any) {
      console.error('[MCP] memory_start_session error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: Save a note (prompt + response capture) ──────────────────────────

server.tool(
  'memory_save_note',
  'Save a note to the active session. Call this AFTER every significant action to record what happened. This is the PRIMARY way context is captured for future sessions. Be detailed — include file names, what changed, and why. The richer the note, the better the memory.',
  {
    sessionId: z.string().describe('The active session ID'),
    userPrompt: z.string().optional().describe('What the user asked or requested'),
    aiResponse: z.string().optional().describe('Detailed summary of what you did: files created/modified, components added, logic changes, validations added. Be specific with file paths and function names.'),
    annotation: z.string().optional().describe('Key decisions, trade-offs, gotchas, dependencies added, or things left incomplete for follow-up')
  },
  async ({ sessionId, userPrompt, aiResponse, annotation }) => {
    try {
      if (!userPrompt && !aiResponse && !annotation) {
        return { content: [{ type: 'text' as const, text: 'Error: provide at least one of userPrompt, aiResponse, or annotation' }], isError: true };
      }
      const session = db.getSession(sessionId);
      if (!session) {
        return { content: [{ type: 'text' as const, text: `Error: session not found: ${sessionId}` }], isError: true };
      }
      const note = db.saveNote(sessionId, userPrompt, aiResponse, annotation, 'manual');
      return { content: [{ type: 'text' as const, text: `Note saved (${note.id}). Prompt/response recorded for future context.` }] };
    } catch (err: any) {
      console.error('[MCP] memory_save_note error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: Get memory context ────────────────────────────────────────────────

server.tool(
  'memory_get_context',
  'Retrieve past session context for a project. Use this at the START of a conversation to load historical knowledge about the codebase — what was done before, key decisions, files modified, etc.',
  {
    projectPath: z.string().describe('Absolute path to the project directory'),
    currentPrompt: z.string().optional().describe('The current user prompt, used to find relevant past sessions')
  },
  async ({ projectPath, currentPrompt }) => {
    try {
      const ctx = contextBuilder.buildContext({
        projectPath,
        currentPrompt: currentPrompt || ''
      });
      return { content: [{ type: 'text' as const, text: ctx }] };
    } catch (err: any) {
      console.error('[MCP] memory_get_context error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: End/summarize a session ───────────────────────────────────────────

server.tool(
  'memory_end_session',
  'End and summarize a coding session. This generates a rich summary using Gemini from all saved notes and observations. Call this when the user is done with a task. IMPORTANT: Make sure you called memory_save_note at least once BEFORE calling this, otherwise the summary will be empty.',
  {
    sessionId: z.string().describe('The session ID to finalize')
  },
  async ({ sessionId }) => {
    try {
      const session = db.getSession(sessionId);
      if (!session) {
        return { content: [{ type: 'text' as const, text: `Error: session not found: ${sessionId}` }], isError: true };
      }
      const summary = await summarizer.summarize(sessionId);
      return { content: [{ type: 'text' as const, text: `Session summarized and saved.\n\nSummary:\n${summary}` }] };
    } catch (err: any) {
      console.error('[MCP] memory_end_session error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error summarizing: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: Record an observation ─────────────────────────────────────────────

server.tool(
  'memory_observe',
  'Record a coding action/observation in the current session. Use this when you make a significant change (create file, modify component, fix bug, etc.).',
  {
    sessionId: z.string().describe('The active session ID'),
    action: z.string().describe('What action was performed (e.g., "created file", "modified component", "fixed bug")'),
    details: z.string().describe('Details of the change — files affected, what changed, why'),
    compress: z.boolean().optional().default(true).describe('Whether to queue this for Gemini compression')
  },
  async ({ sessionId, action, details, compress }) => {
    try {
      const session = db.getSession(sessionId);
      if (!session) {
        return { content: [{ type: 'text' as const, text: `Error: session not found: ${sessionId}` }], isError: true };
      }
      const obs = db.saveObservation(sessionId, action, { details });
      db.updateObservationResult(obs.id, details);

      if (compress) {
        try {
          const compressed = await gemini.compressObservation({
            functionName: action,
            functionArgs: JSON.stringify({ details }),
            functionResult: details
          });
          const originalTokens = Math.ceil(details.length / 4);
          const compressedTokens = Math.ceil(compressed.length / 4);
          db.markObservationCompressed(obs.id, compressed, originalTokens, compressedTokens);
        } catch (compErr: any) {
          console.error('[MCP] Compression failed:', compErr.message);
        }
      }

      return { content: [{ type: 'text' as const, text: `Observation recorded (${obs.id}): ${action}` }] };
    } catch (err: any) {
      console.error('[MCP] memory_observe error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: List sessions for a project ───────────────────────────────────────

server.tool(
  'memory_list_sessions',
  'List recent coding sessions for a project, including their status, summaries, and observation counts.',
  {
    projectPath: z.string().describe('Absolute path to the project directory'),
    limit: z.number().optional().default(5).describe('Maximum number of sessions to return')
  },
  async ({ projectPath, limit }) => {
    try {
      const sessions = db.getRecentSessions(projectPath, limit);
      if (sessions.length === 0) {
        return { content: [{ type: 'text' as const, text: `No completed sessions found for ${projectPath}` }] };
      }
      const lines = sessions.map((s: any) => {
        const date = new Date(s.created_at).toISOString().split('T')[0];
        return `[${date}] ${s.id} (${s.status}) - ${s.user_prompt || 'No prompt'} | ${s.total_observations} observations`;
      });
      return { content: [{ type: 'text' as const, text: `Recent sessions:\n${lines.join('\n')}` }] };
    } catch (err: any) {
      console.error('[MCP] memory_list_sessions error:', err.message);
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Start the server ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] antigravity-memory server running on stdio');
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
