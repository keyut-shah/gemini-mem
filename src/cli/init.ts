#!/usr/bin/env node

/**
 * antigravity-mem init
 *
 * One-command onboarding for end users.
 * Sets up the memory layer for Antigravity IDE / Gemini CLI.
 *
 * What it does:
 * 1. Asks for Gemini API key (or uses existing)
 * 2. Creates the SQLite database directory
 * 3. Writes the MCP config so Antigravity auto-discovers the memory tools
 * 4. Tells the user to restart Antigravity
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

// ─── Constants ───────────────────────────────────────────────────────────────

const HOME = os.homedir();

// Where the MCP config lives for Antigravity / Gemini CLI
const MCP_CONFIG_DIR = path.join(HOME, '.gemini', 'antigravity');
const MCP_CONFIG_PATH = path.join(MCP_CONFIG_DIR, 'mcp_config.json');

// Where we store the memory database
const DATA_DIR = path.join(HOME, '.antigravity-mem');
const DB_PATH = path.join(DATA_DIR, 'memory.db');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function log(msg: string) {
  console.log(`  ${msg}`);
}

function success(msg: string) {
  console.log(`  ✅ ${msg}`);
}

function info(msg: string) {
  console.log(`  ℹ️  ${msg}`);
}

function warn(msg: string) {
  console.log(`  ⚠️  ${msg}`);
}

// ─── Main Init Flow ──────────────────────────────────────────────────────────

export async function runInit() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     🚀 Antigravity Memory — Setup Wizard     ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║  Persistent memory for your AI coding tools  ║');
  console.log('  ║  Never lose context across sessions again!   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Check for existing config
  let existingConfig: any = null;
  let existingApiKey = '';

  if (fs.existsSync(MCP_CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      existingApiKey = existingConfig?.mcpServers?.['antigravity-memory']?.env?.GEMINI_API_KEY || '';
      info('Found existing config at ' + MCP_CONFIG_PATH);
      const overwrite = await ask('  Overwrite existing config? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        log('');
        log('Setup cancelled. Your existing config is unchanged.');
        return;
      }
    } catch {
      // Corrupted config, will overwrite
    }
  }

  // Step 2: Get Gemini API key
  log('');
  log('Step 1/3: Gemini API Key');
  log('────────────────────────');
  log('You need a Gemini API key for memory compression & summarization.');
  log('Get one free at: https://aistudio.google.com/apikey');
  log('');

  let apiKey = '';
  if (existingApiKey) {
    const masked = existingApiKey.slice(0, 8) + '...' + existingApiKey.slice(-4);
    const useExisting = await ask(`  Use existing key (${masked})? (Y/n): `);
    if (useExisting.toLowerCase() !== 'n') {
      apiKey = existingApiKey;
    }
  }

  if (!apiKey) {
    apiKey = await ask('  Enter your Gemini API key: ');
    if (!apiKey) {
      warn('No API key provided. Exiting.');
      process.exit(1);
    }
    // Basic validation
    if (!apiKey.startsWith('AIza')) {
      warn('That doesn\'t look like a valid Gemini API key (should start with "AIza").');
      const proceed = await ask('  Continue anyway? (y/N): ');
      if (proceed.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
  }
  success('API key configured');

  // Step 3: Create data directory
  log('');
  log('Step 2/3: Database Setup');
  log('────────────────────────');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    success(`Created data directory: ${DATA_DIR}`);
  } else {
    info(`Data directory already exists: ${DATA_DIR}`);
  }

  // Step 4: Write MCP config
  log('');
  log('Step 3/3: MCP Server Configuration');
  log('──────────────────────────────────');

  // Detect how the user installed the package to generate the right MCP config.
  // If installed globally (or npm link), use the binary directly — faster startup.
  // Otherwise, fall back to npx which fetches from npm registry.
  const { execSync } = require('child_process');
  let useGlobalBinary = false;
  try {
    execSync('antigravity-mem --version', { stdio: 'ignore' });
    useGlobalBinary = true;
  } catch {
    // Not globally installed — will use npx
  }

  const command = useGlobalBinary ? 'antigravity-mem' : 'npx';
  const args = useGlobalBinary ? ['mcp-serve'] : ['-y', 'antigravity-memory', 'mcp-serve'];

  if (useGlobalBinary) {
    info('Detected global install — MCP config will use "antigravity-mem" directly');
  } else {
    info('Using npx for MCP server launch (publish to npm first, or run: npm install -g antigravity-memory)');
  }

  const mcpConfig = {
    mcpServers: {
      'antigravity-memory': {
        command,
        args,
        env: {
          ANTIGRAVITY_MEM_DB: DB_PATH,
          GEMINI_API_KEY: apiKey,
          GEMINI_MODEL: 'gemini-2.5-flash-lite'
        }
      }
    }
  };

  // Ensure config directory exists
  if (!fs.existsSync(MCP_CONFIG_DIR)) {
    fs.mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2) + '\n');
  success(`MCP config written to: ${MCP_CONFIG_PATH}`);

  // Done!
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║          ✅ Setup Complete!                  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  log('What happens now:');
  log('');
  log('  1. Run: antigravity-mem verify  (optional — checks setup)');
  log('  2. Restart Antigravity IDE');
  log('  3. Start coding — the memory tools are auto-available');
  log('  4. Your AI assistant can now:');
  log('     • memory_start_session  — begin tracking a task');
  log('     • memory_save_note      — capture prompt/response pairs');
  log('     • memory_observe        — record code changes');
  log('     • memory_end_session    — summarize & compress');
  log('     • memory_get_context    — load past session knowledge');
  log('     • memory_list_sessions  — browse session history');
  log('');
  log('  Your memory database: ' + DB_PATH);
  log('  Your MCP config:      ' + MCP_CONFIG_PATH);
  console.log('');
  log('🧠 Never lose coding context again!');
  console.log('');
}

// Allow direct execution
if (require.main === module) {
  runInit().catch((err) => {
    console.error('Init failed:', err.message);
    process.exit(1);
  });
}
