#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('antigravity-mem')
  .description('Persistent memory layer for Antigravity IDE / Gemini CLI')
  .version('0.1.0');

// ─── Init command (no DB needed) ─────────────────────────────────────────────

program
  .command('init')
  .description('Set up antigravity-mem for your IDE (interactive wizard)')
  .action(async () => {
    const { runInit } = await import('./init');
    await runInit();
  });

// ─── Commands that need DB ───────────────────────────────────────────────────
// Lazy-load DB to avoid crashing on `init` (user might not have DB yet)

function getDb() {
  const { MemoryDatabase } = require('../core/database');
  return new MemoryDatabase();
}

function getContext(db: any) {
  const { ContextManager } = require('../core/context-manager');
  return new ContextManager(db);
}

program
  .command('start')
  .requiredOption('-p, --project <path>', 'project path')
  .option('-u, --user-prompt <prompt>', 'initial user prompt')
  .action((opts) => {
    const db = getDb();
    const session = db.createSession(opts.project, opts.userPrompt);
    console.log(JSON.stringify(session, null, 2));
  });

program
  .command('record-call')
  .requiredOption('-s, --session <id>', 'session id')
  .requiredOption('-n, --name <function>', 'function name')
  .option('-a, --args <json>', 'function args JSON')
  .action((opts) => {
    const db = getDb();
    const args = opts.args ? JSON.parse(opts.args) : undefined;
    const obs = db.saveObservation(opts.session, opts.name, args);
    console.log(JSON.stringify(obs, null, 2));
  });

program
  .command('record-result')
  .requiredOption('-o, --observation <id>', 'observation id')
  .requiredOption('-r, --result <json>', 'result JSON')
  .action((opts) => {
    const db = getDb();
    const result = JSON.parse(opts.result);
    db.updateObservationResult(opts.observation, result);
    console.log('ok');
  });

program
  .command('compress')
  .requiredOption('-o, --observation <id>', 'observation id')
  .action(async (opts) => {
    const db = getDb();
    const obs = db.getObservation(opts.observation);
    if (!obs) throw new Error('observation not found');
    const { GeminiClient } = require('../gemini/client');
    const gemini = new GeminiClient();
    const compressed = await gemini.compressObservation({
      functionName: obs.function_name,
      functionArgs: obs.function_args,
      functionResult: obs.function_result
    });

    const originalTokens = estimateTokens(`${obs.function_args || ''}${obs.function_result || ''}`);
    const compressedTokens = estimateTokens(compressed);
    db.markObservationCompressed(obs.id, compressed, originalTokens, compressedTokens);
    console.log(compressed);
  });

program
  .command('context')
  .requiredOption('-p, --project <path>', 'project path')
  .option('-q, --prompt <prompt>', 'current prompt')
  .action((opts) => {
    const db = getDb();
    const context = getContext(db);
    const ctx = context.buildContext({ projectPath: opts.project, currentPrompt: opts.prompt });
    console.log(ctx);
  });

program
  .command('summarize')
  .requiredOption('-s, --session <id>', 'session id')
  .action(async (opts) => {
    const db = getDb();
    const { GeminiClient } = require('../gemini/client');
    const { SessionSummarizer } = require('../gemini/summarizer');
    const gemini = new GeminiClient();
    const summarizer = new SessionSummarizer(db, gemini);
    const summary = await summarizer.summarize(opts.session);
    console.log(summary);
  });

program.parse();

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
