# Codex Build Plan (Hackathon, Antigravity-only MVP)

Context: replicate Claude-Mem behavior for Antigravity IDE using local SQLite + Gemini (free tier). No Chrome extension, no MCP; drive via CLI/Antigravity hooks.

## Goals (1 week)
- Capture: log tool calls/results from Antigravity (CLI-triggered for now).
- Compress: Gemini summaries per observation; 95%+ reduction target.
- Summarize: short session summary after compression.
- Context: build ready-to-inject block for next prompt.
- Local-first: data in `~/.antigravity-mem/antigravity-mem.db`.

## Milestones
1) Schema + CLI skeleton (done in this commit)
2) Wire compression command end-to-end (GEMINI_API_KEY)
3) Auto-update session stats and summarizer command
4) Add lightweight local API + connect `web/viewer.html`
5) Hardening: error handling, minimal tests, demo script

## Parity Targets (Claude-Mem-inspired)
- Context format: session headers, tasks, concise summaries
- Search: FTS5 keyword search (embeddings optional later)
- Safety: local-only storage, key via env
- Speed: context build <100ms on small DB

## Open Items
- Hook CLI into Antigravity tool pipeline (decide event surface)
- Add queueing for compression to avoid blocking IDE
- Stats endpoint for viewer
- Export/import (stretch)
