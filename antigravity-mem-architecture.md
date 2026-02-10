# Antigravity-Mem: System Architecture

## Executive Summary

**Project**: Antigravity-Mem - Context Persistence System for Antigravity IDE
**Problem**: Antigravity IDE loses context between sessions, requiring repeated explanations
**Solution**: Capture, compress, and inject session history automatically
**Inspiration**: Claude-Mem plugin for Claude Code
**Timeline**: 5 days
**Primary Tool**: Codex (ChatGPT GPT-5.2)

---

## Core Problem Statement

### Current Antigravity IDE Behavior

```
Session 1 (Monday):
You: "Help me build an authentication system using JWT"
Antigravity: [builds auth system, writes code]
✅ Session ends with working code

Session 2 (Tuesday):
You: "Add refresh token support to the auth system"
Antigravity: "What auth system? I don't have context about your previous work"
❌ You must re-explain everything
```

### What We're Building

```
Session 1 (Monday):
You: "Help me build an authentication system using JWT"
Antigravity: [builds auth system]
[Antigravity-Mem captures: files changed, decisions made, code patterns]

Session 2 (Tuesday):
You: "Add refresh token support to the auth system"
[Antigravity-Mem injects: "Previously built JWT auth in auth/jwt.ts..."]
Antigravity: "I'll add refresh tokens to your existing JWT system in auth/jwt.ts"
✅ Antigravity remembers!
```

---

## System Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Antigravity IDE                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  User writes prompt: "Fix the login bug"                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Antigravity-Mem Extension (Intercept Layer)             │   │
│  │  1. Load previous session context                        │   │
│  │  2. Inject into prompt                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Enhanced Prompt:                                        │   │
│  │  <memory>[Session summaries]</memory>                    │   │
│  │  <current>Fix the login bug</current>                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Gemini API Call (with injected context)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Gemini Response + Tool Calls                            │   │
│  │  - read_file("auth/login.ts")                            │   │
│  │  - write_file("auth/login.ts", <fixed_code>)             │   │
│  │  - run_tests("npm test")                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Antigravity-Mem Capture Layer                           │   │
│  │  - Capture each tool execution                           │   │
│  │  - Store in SQLite database                              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Background Worker Service                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AI Compression Engine (Using Gemini)                    │   │
│  │  1. Read raw observations                                │   │
│  │  2. Send to Gemini: "Summarize this action"              │   │
│  │  3. Store compressed version                             │   │
│  │                                                           │   │
│  │  Raw: 5000 tokens → Compressed: 150 tokens (97% saving)  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SQLite Database                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  sessions: Store session summaries                       │   │
│  │  observations: Store tool executions (compressed)        │   │
│  │  sessions_fts: Full-text search index                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Interception Layer (Browser Extension / Proxy)

**Purpose**: Intercept Antigravity IDE's API calls to inject context

**Two Implementation Options**:

#### Option A: Browser Extension (Recommended)
```javascript
// chrome-extension/content-script.js
// Intercepts fetch() calls to Gemini API

(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const [url, options] = args;
    
    // Detect Gemini API calls
    if (url.includes('generativelanguage.googleapis.com')) {
      // Inject context before sending
      const enhancedOptions = await injectContext(options);
      return originalFetch(url, enhancedOptions);
    }
    
    return originalFetch(...args);
  };
})();

async function injectContext(options) {
  // 1. Get project context from IndexedDB
  const projectPath = getCurrentProjectPath();
  const context = await loadContextFromDB(projectPath);
  
  // 2. Parse request body
  const body = JSON.parse(options.body);
  
  // 3. Inject memory into system instruction
  body.systemInstruction = {
    parts: [{
      text: `${context}\n\n${body.systemInstruction?.parts?.[0]?.text || ''}`
    }]
  };
  
  // 4. Return enhanced request
  return {
    ...options,
    body: JSON.stringify(body)
  };
}
```

#### Option B: Local Proxy Server
```javascript
// proxy-server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use('/v1/*', async (req, res, next) => {
  // Inject context before proxying to Gemini
  const context = await loadContext(req.body.projectPath);
  req.body.systemInstruction = context + req.body.systemInstruction;
  next();
}, createProxyMiddleware({
  target: 'https://generativelanguage.googleapis.com',
  changeOrigin: true
}));

app.listen(3000);
```

**Decision**: Browser extension is preferred (no proxy configuration needed)

---

### 2. Capture System

**Purpose**: Record every tool/function call Gemini makes

**Implementation**:

```javascript
// capture-system.js

class CaptureSystem {
  constructor(db) {
    this.db = db;
    this.currentSessionId = null;
  }
  
  // Called when response contains function calls
  captureGeminiResponse(response) {
    const functionCalls = response.candidates[0]?.content?.parts?.filter(
      part => part.functionCall
    );
    
    for (const call of functionCalls || []) {
      this.saveObservation({
        session_id: this.currentSessionId,
        function_name: call.functionCall.name,
        function_args: JSON.stringify(call.functionCall.args),
        timestamp: Date.now(),
        status: 'pending'
      });
    }
  }
  
  // Called when tool execution completes
  captureToolResult(functionName, result) {
    this.db.prepare(`
      UPDATE observations 
      SET function_result = ?,
          status = 'captured',
          updated_at = ?
      WHERE session_id = ? 
        AND function_name = ?
        AND status = 'pending'
      ORDER BY timestamp DESC
      LIMIT 1
    `).run(
      JSON.stringify(result),
      Date.now(),
      this.currentSessionId,
      functionName
    );
    
    // Queue for AI compression
    this.queueForCompression(functionName);
  }
  
  async saveObservation(obs) {
    const id = generateUUID();
    
    this.db.prepare(`
      INSERT INTO observations (
        id, session_id, function_name, function_args, 
        timestamp, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id, obs.session_id, obs.function_name, 
      obs.function_args, obs.timestamp, obs.status
    );
    
    return id;
  }
}
```

**Captured Data Example**:
```json
{
  "id": "obs_12345",
  "session_id": "sess_abc",
  "function_name": "write_file",
  "function_args": {
    "path": "src/auth/login.ts",
    "content": "export function login() {...}"
  },
  "function_result": {
    "success": true,
    "bytes_written": 1542
  },
  "timestamp": 1738123456789,
  "status": "captured"
}
```

---

### 3. AI Compression Engine

**Purpose**: Reduce 5000 token observations to 150 token summaries

**Implementation**:

```javascript
// compression-engine.js

class CompressionEngine {
  constructor(geminiClient, db) {
    this.gemini = geminiClient;
    this.db = db;
  }
  
  async compressObservation(observationId) {
    // 1. Fetch raw observation
    const obs = this.db.prepare(`
      SELECT * FROM observations WHERE id = ?
    `).get(observationId);
    
    // 2. Build compression prompt
    const prompt = this.buildCompressionPrompt(obs);
    
    // 3. Call Gemini for compression
    const compressed = await this.callGeminiForCompression(prompt);
    
    // 4. Calculate token savings
    const originalTokens = this.estimateTokens(
      obs.function_args + obs.function_result
    );
    const compressedTokens = this.estimateTokens(compressed);
    const savings = originalTokens - compressedTokens;
    
    // 5. Update database
    this.db.prepare(`
      UPDATE observations 
      SET compressed_data = ?,
          original_tokens = ?,
          compressed_tokens = ?,
          tokens_saved = ?,
          status = 'compressed'
      WHERE id = ?
    `).run(
      compressed,
      originalTokens,
      compressedTokens,
      savings,
      observationId
    );
    
    return compressed;
  }
  
  buildCompressionPrompt(obs) {
    return `
Analyze this coding action and extract key information concisely:

Function: ${obs.function_name}
Arguments: ${obs.function_args}
Result: ${obs.function_result}

Extract in under 100 words:
1. What was learned or discovered
2. What changed in the codebase (specific files/lines)
3. Why this matters for future sessions
4. Related concepts or patterns

Format as structured text, not JSON.
Be extremely concise - every word must add value.
    `.trim();
  }
  
  async callGeminiForCompression(prompt) {
    const response = await this.gemini.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,  // Low temp for consistent extraction
        maxOutputTokens: 200,
        candidateCount: 1
      }
    });
    
    return response.response.text();
  }
  
  estimateTokens(text) {
    // Rough estimate: 4 characters = 1 token
    return Math.ceil(text.length / 4);
  }
}
```

**Compression Example**:

**Before (5000 tokens)**:
```json
{
  "function_name": "write_file",
  "function_args": {
    "path": "src/auth/login.ts",
    "content": "import jwt from 'jsonwebtoken';\n\nexport async function login(username: string, password: string) {\n  // Validate credentials\n  const user = await db.users.findOne({ username });\n  if (!user) {\n    throw new Error('User not found');\n  }\n  \n  const isValid = await bcrypt.compare(password, user.passwordHash);\n  if (!isValid) {\n    throw new Error('Invalid password');\n  }\n  \n  // Generate JWT token\n  const token = jwt.sign(\n    { userId: user.id, username: user.username },\n    process.env.JWT_SECRET,\n    { expiresIn: '24h' }\n  );\n  \n  return { token, user: { id: user.id, username: user.username } };\n}\n\nexport function validateToken(token: string) {\n  try {\n    return jwt.verify(token, process.env.JWT_SECRET);\n  } catch (err) {\n    return null;\n  }\n}\n... [200 more lines]"
  },
  "function_result": {
    "success": true,
    "path": "src/auth/login.ts",
    "bytes_written": 5432,
    "lines_added": 243
  }
}
```

**After (150 tokens)**:
```
Created JWT-based authentication in src/auth/login.ts with login() and validateToken() 
functions. Uses bcrypt for password hashing and jsonwebtoken for token generation. 
Token expires in 24h. Validates credentials against database before issuing token. 
Returns user object and token on success. Related: JWT, bcrypt, authentication patterns.
```

**Savings**: 5000 → 150 tokens = **97% reduction**

---

### 4. Database Schema

**SQLite Database**: `~/.antigravity-mem/antigravity-mem.db`

```sql
-- Sessions: Top-level conversation sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  user_prompt TEXT,
  summary TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT DEFAULT 'active',  -- 'active', 'summarized', 'completed'
  total_observations INTEGER DEFAULT 0,
  tokens_saved INTEGER DEFAULT 0
);

-- Observations: Individual tool/function executions
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  function_name TEXT NOT NULL,
  function_args TEXT,  -- JSON string
  function_result TEXT,  -- JSON string
  compressed_data TEXT,  -- AI-generated summary
  original_tokens INTEGER,
  compressed_tokens INTEGER,
  tokens_saved INTEGER,
  timestamp INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending', 'captured', 'compressed'
  observation_type TEXT,  -- 'file_read', 'file_write', 'code_execution', etc.
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Full-Text Search: Sessions
CREATE VIRTUAL TABLE sessions_fts USING fts5(
  session_id UNINDEXED,
  user_prompt,
  summary,
  content='sessions',
  content_rowid='rowid'
);

-- Full-Text Search: Observations
CREATE VIRTUAL TABLE observations_fts USING fts5(
  observation_id UNINDEXED,
  function_name,
  compressed_data,
  content='observations',
  content_rowid='rowid'
);

-- Indexes for performance
CREATE INDEX idx_sessions_project ON sessions(project_path, created_at DESC);
CREATE INDEX idx_observations_session ON observations(session_id, timestamp);
CREATE INDEX idx_observations_status ON observations(status);

-- Triggers to keep FTS in sync
CREATE TRIGGER sessions_fts_insert AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(session_id, user_prompt, summary)
  VALUES (new.id, new.user_prompt, new.summary);
END;

CREATE TRIGGER observations_fts_insert AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(observation_id, function_name, compressed_data)
  VALUES (new.id, new.function_name, new.compressed_data);
END;
```

---

### 5. Context Builder

**Purpose**: Load relevant session history and format for Gemini

```javascript
// context-builder.js

class ContextBuilder {
  constructor(db) {
    this.db = db;
  }
  
  async buildContext(projectPath, currentPrompt) {
    // 1. Get recent sessions (last 10)
    const recentSessions = this.getRecentSessions(projectPath, 10);
    
    // 2. Search for semantically relevant sessions
    const relevantSessions = this.searchRelevantSessions(
      projectPath, 
      currentPrompt, 
      5
    );
    
    // 3. Combine and deduplicate
    const allSessions = this.deduplicateSessions(
      [...recentSessions, ...relevantSessions]
    );
    
    // 4. Format for Gemini
    return this.formatForGemini(allSessions);
  }
  
  getRecentSessions(projectPath, limit) {
    return this.db.prepare(`
      SELECT 
        id,
        user_prompt,
        summary,
        created_at,
        total_observations,
        tokens_saved
      FROM sessions
      WHERE project_path = ?
        AND status = 'summarized'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectPath, limit);
  }
  
  searchRelevantSessions(projectPath, query, limit) {
    // Use FTS5 for keyword search
    const results = this.db.prepare(`
      SELECT 
        s.id,
        s.user_prompt,
        s.summary,
        s.created_at,
        s.total_observations,
        s.tokens_saved,
        highlight(sessions_fts, 1, '<mark>', '</mark>') as matched_text,
        rank
      FROM sessions s
      JOIN sessions_fts fts ON s.id = fts.session_id
      WHERE s.project_path = ?
        AND sessions_fts MATCH ?
        AND s.status = 'summarized'
      ORDER BY rank
      LIMIT ?
    `).all(projectPath, this.buildSearchQuery(query), limit);
    
    return results;
  }
  
  buildSearchQuery(prompt) {
    // Extract keywords from prompt
    const keywords = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 5);  // Top 5 keywords
    
    // Build FTS5 query
    return keywords.join(' OR ');
  }
  
  deduplicateSessions(sessions) {
    const seen = new Set();
    return sessions.filter(session => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });
  }
  
  formatForGemini(sessions) {
    if (sessions.length === 0) {
      return "No previous context available for this project.";
    }
    
    const parts = [
      "# Antigravity Memory: Previous Sessions",
      "",
      "You have worked on this project before. Here's what you learned:",
      ""
    ];
    
    for (const session of sessions) {
      const date = new Date(session.created_at).toLocaleDateString();
      
      parts.push(`## Session from ${date}`);
      parts.push(`**Task**: ${session.user_prompt}`);
      parts.push("");
      parts.push(session.summary);
      parts.push("");
      
      if (session.total_observations > 0) {
        parts.push(`*Modified ${session.total_observations} files/operations*`);
        parts.push("");
      }
    }
    
    parts.push("---");
    parts.push("Use this context to understand the project's current state.");
    parts.push("");
    
    return parts.join("\n");
  }
}
```

**Example Output**:

```markdown
# Antigravity Memory: Previous Sessions

You have worked on this project before. Here's what you learned:

## Session from 2/8/2026
**Task**: Build authentication system with JWT

Implemented JWT-based auth in src/auth/. Created login() and validateToken() 
functions using bcrypt for passwords and jsonwebtoken for tokens. Tokens expire 
in 24h. Database schema includes users table with password_hash column. 
Environment variable JWT_SECRET must be set. Tests added in auth.test.ts.

*Modified 8 files/operations*

## Session from 2/7/2026
**Task**: Set up database connection

Configured PostgreSQL connection using pg library. Created database.ts with 
connection pool. Schema includes users, sessions tables. Migration scripts 
in db/migrations/. Connection string in .env file. Added error handling for 
connection failures.

*Modified 5 files/operations*

---
Use this context to understand the project's current state.
```

---

### 6. Session Summarizer

**Purpose**: Generate high-level summaries when sessions end

```javascript
// session-summarizer.js

class SessionSummarizer {
  constructor(geminiClient, db) {
    this.gemini = geminiClient;
    this.db = db;
  }
  
  async summarizeSession(sessionId) {
    // 1. Get all compressed observations
    const observations = this.db.prepare(`
      SELECT compressed_data, function_name, timestamp
      FROM observations
      WHERE session_id = ?
        AND status = 'compressed'
      ORDER BY timestamp ASC
    `).all(sessionId);
    
    if (observations.length === 0) {
      return "No significant actions recorded.";
    }
    
    // 2. Get session details
    const session = this.db.prepare(`
      SELECT user_prompt FROM sessions WHERE id = ?
    `).get(sessionId);
    
    // 3. Build summarization prompt
    const prompt = this.buildSummaryPrompt(session, observations);
    
    // 4. Call Gemini
    const summary = await this.callGeminiForSummary(prompt);
    
    // 5. Update session
    this.db.prepare(`
      UPDATE sessions
      SET summary = ?,
          status = 'summarized',
          total_observations = ?,
          ended_at = ?
      WHERE id = ?
    `).run(summary, observations.length, Date.now(), sessionId);
    
    return summary;
  }
  
  buildSummaryPrompt(session, observations) {
    const observationsList = observations
      .map((obs, i) => `${i + 1}. [${obs.function_name}] ${obs.compressed_data}`)
      .join('\n');
    
    return `
Summarize this coding session in 3-4 sentences maximum:

**User's Goal**: ${session.user_prompt}

**Actions Taken**:
${observationsList}

Create a concise summary that captures:
1. What was accomplished
2. Key technical decisions made
3. Important files/components modified
4. Learnings relevant for future work

Be specific about file names and technical details, but keep it brief.
Do NOT use bullet points. Write in flowing prose.
    `.trim();
  }
  
  async callGeminiForSummary(prompt) {
    const response = await this.gemini.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300
      }
    });
    
    return response.response.text();
  }
}
```

---

### 7. Worker Service Architecture

**Purpose**: Background processing to not block Antigravity

```javascript
// worker-service.js (Node.js service running on port 37777)

const express = require('express');
const Database = require('better-sqlite3');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class WorkerService {
  constructor() {
    this.db = new Database('~/.antigravity-mem/antigravity-mem.db');
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.compressionQueue = [];
    this.isProcessing = false;
  }
  
  start() {
    const app = express();
    app.use(express.json());
    
    // API endpoints
    app.post('/api/compress', this.handleCompressRequest.bind(this));
    app.post('/api/summarize', this.handleSummarizeRequest.bind(this));
    app.post('/api/search', this.handleSearchRequest.bind(this));
    app.get('/api/context/:projectPath', this.handleContextRequest.bind(this));
    
    // Health check
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    
    app.listen(37777, () => {
      console.log('Antigravity-Mem Worker running on port 37777');
      this.startQueueProcessor();
    });
  }
  
  async handleCompressRequest(req, res) {
    const { observationId } = req.body;
    
    // Add to queue (don't block)
    this.compressionQueue.push(observationId);
    
    res.json({ queued: true, position: this.compressionQueue.length });
  }
  
  async startQueueProcessor() {
    setInterval(async () => {
      if (this.isProcessing || this.compressionQueue.length === 0) return;
      
      this.isProcessing = true;
      
      const observationId = this.compressionQueue.shift();
      await this.compressObservation(observationId);
      
      this.isProcessing = false;
    }, 1000);  // Process one per second
  }
  
  async compressObservation(observationId) {
    const engine = new CompressionEngine(this.gemini, this.db);
    await engine.compressObservation(observationId);
  }
}

// Start service
const service = new WorkerService();
service.start();
```

---

## Data Flow: Complete Lifecycle

### Step 1: User Starts Session

```
User opens Antigravity IDE → Project: /home/user/myapp
```

**Extension intercepts page load**:
```javascript
// Detect project path
const projectPath = extractProjectPath();

// Initialize session
const sessionId = await fetch('http://localhost:37777/api/session/start', {
  method: 'POST',
  body: JSON.stringify({ projectPath })
}).then(r => r.json());

// Store in extension storage
chrome.storage.local.set({ currentSessionId: sessionId.id });
```

---

### Step 2: User Submits Prompt

```
User types: "Add password reset functionality"
```

**Extension intercepts Gemini API call**:
```javascript
// Before fetch to Gemini API
const context = await fetch(
  `http://localhost:37777/api/context/${projectPath}`
).then(r => r.text());

// Inject context
const enhancedBody = {
  ...originalBody,
  systemInstruction: {
    parts: [{ text: context }]
  }
};

// Continue to Gemini
fetch('https://generativelanguage.googleapis.com/...', {
  method: 'POST',
  body: JSON.stringify(enhancedBody)
});
```

---

### Step 3: Gemini Responds with Tool Calls

```json
{
  "candidates": [{
    "content": {
      "parts": [
        {
          "functionCall": {
            "name": "read_file",
            "args": { "path": "src/auth/login.ts" }
          }
        }
      ]
    }
  }]
}
```

**Extension captures**:
```javascript
// Intercept response
const response = await fetch(...);
const data = await response.json();

// Capture function calls
for (const part of data.candidates[0].content.parts) {
  if (part.functionCall) {
    await fetch('http://localhost:37777/api/observe', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: currentSessionId,
        functionName: part.functionCall.name,
        functionArgs: part.functionCall.args,
        timestamp: Date.now()
      })
    });
  }
}
```

---

### Step 4: Tool Execution Result

```
Antigravity executes: read_file("src/auth/login.ts")
Returns: <file contents>
```

**Extension captures result**:
```javascript
// When tool result is sent back to Gemini
await fetch('http://localhost:37777/api/observe/result', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: currentSessionId,
    functionName: 'read_file',
    result: fileContents
  })
});

// Worker queues for compression (async, non-blocking)
```

---

### Step 5: Background Compression

```
Worker service picks up observation from queue
```

**Worker compresses**:
```javascript
const obs = db.prepare('SELECT * FROM observations WHERE id = ?').get(obsId);

const prompt = `Summarize: read_file("src/auth/login.ts") returned 200 lines of JWT auth code...`;
const compressed = await gemini.generateContent(prompt);

db.prepare(`
  UPDATE observations 
  SET compressed_data = ?, status = 'compressed'
  WHERE id = ?
`).run(compressed.text(), obsId);
```

---

### Step 6: Session Ends

```
User finishes work, session ends
```

**Extension triggers summarization**:
```javascript
await fetch('http://localhost:37777/api/session/end', {
  method: 'POST',
  body: JSON.stringify({ sessionId: currentSessionId })
});

// Worker generates session summary
const summary = await summarizer.summarizeSession(sessionId);
```

---

### Step 7: Next Session (Context Injection)

```
Next day, user starts new session
```

**Extension loads context**:
```javascript
const context = await fetch(
  `http://localhost:37777/api/context/${projectPath}`
).then(r => r.text());

// Context includes yesterday's summary!
// Gemini now "remembers" previous work
```

---

## Technology Stack

### Core Technologies

| Component | Technology | Reason |
|-----------|-----------|--------|
| **Extension** | Chrome Extension (Manifest V3) | Intercept Antigravity's API calls |
| **Database** | SQLite (better-sqlite3) | Fast, embeddable, no setup |
| **Worker Service** | Node.js + Express | Background processing |
| **AI** | Google Gemini 1.5 Pro | Compression & summarization |
| **Search** | SQLite FTS5 | Full-text search |
| **Storage** | Local filesystem | `~/.antigravity-mem/` |

### Development Tools

| Tool | Purpose |
|------|---------|
| **Codex (GPT-5.2)** | Primary development (80% of work) |
| **Antigravity IDE** | Testing integration (5 hours total) |
| **VS Code** | Local development/fallback |
| **Postman/Thunder Client** | API testing |

---

## File Structure

```
antigravity-mem/
├── extension/                    # Chrome extension
│   ├── manifest.json
│   ├── background.js            # Service worker
│   ├── content-script.js        # Page injection
│   ├── popup.html               # Extension UI
│   └── popup.js
│
├── worker-service/              # Background service
│   ├── server.js                # Express server
│   ├── compression-engine.js
│   ├── session-summarizer.js
│   ├── context-builder.js
│   ├── capture-system.js
│   └── database.js
│
├── shared/                      # Shared utilities
│   ├── schema.sql               # Database schema
│   ├── types.ts                 # TypeScript types
│   └── utils.js
│
├── cli/                         # CLI tools
│   ├── install.js               # Setup script
│   ├── status.js                # View status
│   └── search.js                # Search memory
│
├── tests/
│   ├── integration/
│   └── unit/
│
├── docs/
│   ├── ARCHITECTURE.md          # This file
│   ├── API.md                   # API documentation
│   └── USER_GUIDE.md
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Key Metrics & Performance

### Token Reduction Targets

```
Without Antigravity-Mem:
- Session 1: 5,000 tokens
- Session 2: 5,000 tokens (re-explain context)
- Session 3: 5,000 tokens (re-explain again)
Total: 15,000 tokens

With Antigravity-Mem:
- Session 1: 5,000 tokens + 2,000 (compression)
- Session 2: 500 tokens (load compressed) + 3,000 (new work)
- Session 3: 500 tokens (load compressed) + 3,000 (new work)
Total: 14,000 tokens
Savings: ~7% overall, but better UX (no re-explaining)
```

### Compression Ratios

```
Target: 95%+ compression
Example:
- Raw file content: 5,000 tokens
- Compressed summary: 150 tokens
- Ratio: 97% reduction
```

### Performance Targets

```
- Context injection: <100ms
- Observation capture: <50ms
- Background compression: <3 seconds per observation
- Session summary: <5 seconds
- Search query: <200ms
```

---

## Security & Privacy

### Data Storage

```
- All data stored locally: ~/.antigravity-mem/
- No cloud sync (user controls their data)
- SQLite database encrypted at rest (optional)
- API keys stored in environment variables
```

### API Key Management

```javascript
// Never hardcode API keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable required');
}
```

---

## Success Criteria

### MVP (Minimum Viable Product)

✅ Capture tool executions
✅ Store in SQLite database
✅ Basic context injection (last 5 sessions)
✅ Manual summarization
✅ Works with Antigravity IDE

### Full Feature Set

✅ Automatic AI compression
✅ Session summarization
✅ Full-text search
✅ Browser extension
✅ Background worker service
✅ CLI tools
✅ 95%+ compression ratio
✅ <100ms context injection

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Antigravity API changes** | High | Abstract API calls, easy to update |
| **Gemini rate limits** | Medium | Queue system, retry logic |
| **Database corruption** | High | Regular backups, WAL mode |
| **Extension performance** | Medium | Async operations, web workers |
| **Token costs** | Low | Compression reduces API calls |

---

## Next Steps

See `5-DAY-PLAN.md` for detailed implementation schedule.

Key phases:
1. **Day 1**: Database + Basic capture
2. **Day 2**: AI compression engine
3. **Day 3**: Context injection
4. **Day 4**: Browser extension
5. **Day 5**: Polish + Testing

---

**Document Version**: 1.0
**Last Updated**: February 9, 2026
**Author**: Antigravity-Mem Project Team