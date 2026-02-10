# Antigravity Memory (MVP)

Local-first memory layer for Antigravity IDE, inspired by Claude-Mem (see https://docs.claude-mem.ai/). Uses SQLite + Gemini free-tier for compression and session summaries. Scope: Antigravity IDE only (no Chrome/MCP integration yet).

## Quickstart

```bash
cd antigravity-memory
npm install
npm run dev -- --help
```

Example workflow:
1) Start session: `npm run dev -- start -p /path/to/project -u "Add auth"`
2) Record tool call: `npm run dev -- record-call -s <session> -n read_file -a '{"path":"auth.ts"}'`
3) Record result: `npm run dev -- record-result -o <obs> -r '{"content":"..."}'`
4) Compress: `npm run dev -- compress -o <obs>` (uses GEMINI_API_KEY)
5) Summarize session: `npm run dev -- summarize -s <session>`
6) Get context block: `npm run dev -- context -p /path/to/project -q "next task"`

## Files
- `src/core/database.ts` — SQLite + FTS schema and CRUD
- `src/core/context-manager.ts` — builds context block from past sessions
- `src/core/analytics.ts` — lightweight stats (MVP)
- `src/gemini/client.ts` — Gemini wrapper for compression/summary
- `src/gemini/summarizer.ts` — session summarization helper
- `src/cli/index.ts` — CLI entry
- `web/viewer.html` — placeholder viewer (wire later to API)

## Environment
Set `GEMINI_API_KEY` (free tier is fine for testing). Data stored at `~/.antigravity-mem/antigravity-mem.db`.

## Roadmap (1-week MVP)
- Day 1-2: finalize capture + CLI flows; stable schema
- Day 3: automatic compression queue + session summary trigger
- Day 4: simple local API + wire viewer to stats/context
- Day 5: polish/error handling; ship hackathon demo

## Notes
- Context format mirrors Claude-Mem style: brief session headers + summaries.
- Token estimate is rough (len/4) to keep dependencies light.
- Semantic search via embeddings is out-of-scope for MVP; FTS only.
