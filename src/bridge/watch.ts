#!/usr/bin/env ts-node
// @ts-nocheck

import fs from 'fs';
import path from 'path';
import { argv, exit } from 'process';

// Args: CLI flags take priority, then env vars, then defaults
const args = parseArgs(argv.slice(2));
const projectPath = path.resolve(args.project || process.env.WATCH_PATH || '');
const apiBase = args.api || process.env.API_BASE || 'http://localhost:37777';
const sessionIdArg = args.session || process.env.SESSION_ID || undefined;
const sizeLimit = Number(args.sizeLimit || process.env.SIZE_LIMIT || 200_000); // 200 KB
const intervalMs = Number(args.interval || process.env.POLL_INTERVAL || 2000); // polling interval
const captureInitial = (args.captureInitial || process.env.CAPTURE_INITIAL) === '1';

if (!projectPath || projectPath === path.resolve('')) {
  console.error('Usage:');
  console.error('  npm run watch -- --project /path --session <id?> [--api http://localhost:37777]');
  console.error('  WATCH_PATH=/path SESSION_ID=<id?> npm run watch');
  exit(1);
}

let sessionId = sessionIdArg;
const seen = new Map<string, number>(); // path -> mtimeMs
const ignore = buildIgnore(projectPath);

// watch.ts - Fix the initialization logic

(async () => {
  if (!sessionId) {
    const res = await fetch(`${apiBase}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, userPrompt: 'file-watcher session' })
    });
    const data = await res.json();
    sessionId = data.sessionId;
    console.log(`Started session ${sessionId} for ${projectPath}`);
  } else {
    console.log(`Using session ${sessionId} for ${projectPath}`);
  }

  // ALWAYS prime baseline to avoid capturing whole repo
  primeSeen();
  console.log('Baseline primed. Only NEW changes will be captured.');
  
  console.log(`Polling ${projectPath} every ${intervalMs}ms (size limit ${sizeLimit} bytes)`);
  
  // Start polling (will only capture changes from NOW on)
  setInterval(scanOnce, intervalMs);
})();

async function scanOnce() {
  const current = new Set<string>();

  for (const filePath of walk(projectPath, ignore)) {
    current.add(filePath);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > sizeLimit) continue;
      const prev = seen.get(filePath);
      if (prev && prev >= stat.mtimeMs) continue; // unchanged
      seen.set(filePath, stat.mtimeMs);
      await handleChange(filePath, stat);
    } catch {
      continue;
    }
  }

  // Detect deletes
  for (const p of Array.from(seen.keys())) {
    if (!current.has(p)) {
      seen.delete(p);
      await handleDelete(p);
    }
  }
}

function primeSeen() {
  for (const filePath of walk(projectPath, ignore)) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > sizeLimit) continue;
      seen.set(filePath, stat.mtimeMs);
    } catch {
      continue;
    }
  }
}

async function handleChange(filePath: string, stat: fs.Stats) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(projectPath, filePath);

    const callRes = await fetch(`${apiBase}/observe/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        functionName: 'write_file',
        functionArgs: { path: rel, bytes: stat.size }
      })
    });
    const call = await callRes.json();
    if (!call.observationId) {
      console.error('Failed to record call', call);
      return;
    }

    await fetch(`${apiBase}/observe/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observationId: call.observationId,
        result: { path: rel, content }
      })
    });

    await fetch(`${apiBase}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observationId: call.observationId })
    });

    console.log(`Captured + queued compress: ${rel}`);
  } catch (err) {
    console.error(`Error handling change ${filePath}`, err);
  }
}

async function handleDelete(filePath: string) {
  const rel = path.relative(projectPath, filePath);
  try {
    await fetch(`${apiBase}/observe/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        functionName: 'delete_file',
        functionArgs: { path: rel }
      })
    });
    console.log(`Recorded delete: ${rel}`);
  } catch (err) {
    console.error(`Error handling delete ${filePath}`, err);
  }
}

function* walk(root: string, ignoreFn: (p: string) => boolean) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (ignoreFn(full)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        yield full;
      }
    }
  }
}

function buildIgnore(root: string) {
  const ignored = new Set([
    'node_modules',
    '.git',
    '.DS_Store',
    '.next',
    'dist',
    'build',
    '.turbo',
    '.idea',
    '.vscode',
  ]);
  return (p: string) => {
    const rel = path.relative(root, p);
    if (rel.startsWith('..')) return true;
    const parts = rel.split(path.sep);
    return parts.some((part) => ignored.has(part));
  };
}

function parseArgs(list: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}
