#!/usr/bin/env ts-node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { MemoryDatabase } from '../core/database';
import { ContextManager } from '../core/context-manager';
import { GeminiClient } from '../gemini/client';
import { SessionSummarizer } from '../gemini/summarizer';

dotenv.config();

const program = new Command();
const db = new MemoryDatabase();
const context = new ContextManager(db);

program
  .name('antigravity-mem')
  .description('MVP memory layer for Antigravity IDE')
  .version('0.1.0');

program
  .command('start')
  .requiredOption('-p, --project <path>', 'project path')
  .option('-u, --user-prompt <prompt>', 'initial user prompt')
  .action((opts) => {
    const session = db.createSession(opts.project, opts.userPrompt);
    console.log(JSON.stringify(session, null, 2));
  });

program
  .command('record-call')
  .requiredOption('-s, --session <id>', 'session id')
  .requiredOption('-n, --name <function>', 'function name')
  .option('-a, --args <json>', 'function args JSON')
  .action((opts) => {
    const args = opts.args ? JSON.parse(opts.args) : undefined;
    const obs = db.saveObservation(opts.session, opts.name, args);
    console.log(JSON.stringify(obs, null, 2));
  });

program
  .command('record-result')
  .requiredOption('-o, --observation <id>', 'observation id')
  .requiredOption('-r, --result <json>', 'result JSON')
  .action((opts) => {
    const result = JSON.parse(opts.result);
    db.updateObservationResult(opts.observation, result);
    console.log('ok');
  });

program
  .command('compress')
  .requiredOption('-o, --observation <id>', 'observation id')
  .action(async (opts) => {
    const obs = db.getObservation(opts.observation);
    if (!obs) throw new Error('observation not found');
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
    const ctx = context.buildContext({ projectPath: opts.project, currentPrompt: opts.prompt });
    console.log(ctx);
  });

program
  .command('summarize')
  .requiredOption('-s, --session <id>', 'session id')
  .action(async (opts) => {
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
