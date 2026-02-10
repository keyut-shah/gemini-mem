// @ts-nocheck
import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';
import { MemoryDatabase } from '../core/database';
import { ContextManager } from '../core/context-manager';
import { GeminiClient } from '../gemini/client';
import { SessionSummarizer } from '../gemini/summarizer';

dotenv.config();

const db = new MemoryDatabase();
const contextBuilder = new ContextManager(db);
const gemini = new GeminiClient();
const summarizer = new SessionSummarizer(db, gemini);

type Job = { observationId: string };
const queue: Job[] = [];
let processing = false;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const job = queue.shift();
  if (!job) {
    processing = false;
    return;
  }
  try {
    const obs = db.getObservation(job.observationId);
    if (!obs) throw new Error('observation not found');
    const compressed = await gemini.compressObservation({
      functionName: obs.function_name,
      functionArgs: obs.function_args,
      functionResult: obs.function_result
    });
    const originalTokens = estimateTokens(`${obs.function_args || ''}${obs.function_result || ''}`);
    const compressedTokens = estimateTokens(compressed);
    db.markObservationCompressed(obs.id, compressed, originalTokens, compressedTokens);
  } catch (err) {
    console.error('queue error', err);
  } finally {
    processing = false;
  }
}

setInterval(processQueue, 500);

function send(res: http.ServerResponse, status: number, body: any, isText = false) {
  const data = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type'
  });
  res.end(data);
}

async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return send(res, 400, { error: 'bad request' });
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 200, {});

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, mock: process.env.MOCK_GEMINI === '1' || undefined });
  }

  if (req.method === 'POST' && url.pathname === '/session/start') {
    const { projectPath, userPrompt } = await parseBody(req);
    if (!projectPath) return send(res, 400, { error: 'projectPath required' });
    const session = db.createSession(projectPath, userPrompt);
    return send(res, 200, { sessionId: session.id, session });
  }

  if (req.method === 'POST' && url.pathname === '/observe/call') {
    const { sessionId, functionName, functionArgs, observationType } = await parseBody(req);
    if (!sessionId || !functionName) return send(res, 400, { error: 'sessionId and functionName required' });
    const session = db.getSession(sessionId);
    if (!session) return send(res, 400, { error: 'unknown sessionId' });
    try {
      const obs = db.saveObservation(sessionId, functionName, functionArgs, observationType);
      return send(res, 200, { observationId: obs.id, observation: obs });
    } catch (err: any) {
      console.error(err);
      return send(res, 500, { error: err.message || 'saveObservation failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/observe/result') {
    const { observationId, result } = await parseBody(req);
    if (!observationId) return send(res, 400, { error: 'observationId required' });
    try {
      db.updateObservationResult(observationId, result);
      return send(res, 200, { ok: true });
    } catch (err: any) {
      console.error(err);
      return send(res, 500, { error: err.message || 'updateObservationResult failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/compress') {
    const { observationId } = await parseBody(req);
    if (!observationId) return send(res, 400, { error: 'observationId required' });
    queue.push({ observationId });
    return send(res, 200, { queued: true, position: queue.length });
  }

  if (req.method === 'POST' && url.pathname === '/summarize') {
    const { sessionId } = await parseBody(req);
    if (!sessionId) return send(res, 400, { error: 'sessionId required' });
    try {
      const summary = await summarizer.summarize(sessionId);
      return send(res, 200, { summary });
    } catch (err: any) {
      console.error(err);
      return send(res, 500, { error: err.message || 'summarize failed' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/context') {
    const projectPath = url.searchParams.get('project');
    const prompt = url.searchParams.get('prompt') || '';
    if (!projectPath) return send(res, 400, { error: 'project query param required' });
    const ctx = contextBuilder.buildContext({ projectPath, currentPrompt: prompt });
    return send(res, 200, ctx, true);
  }

  return send(res, 404, { error: 'not found' });
});

const port = Number(process.env.PORT || 37777);
server.listen(port, () => {
  console.log(`Antigravity Memory API on http://localhost:${port} (mock=${process.env.MOCK_GEMINI === '1'})`);
});
