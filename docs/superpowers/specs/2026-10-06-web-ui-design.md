# Web UI for AI Chief of Staff: Design Spec

**Date:** 2026-10-06
**Status:** Approved (2026-10-06)
**Path on approval:** `docs/superpowers/specs/2026-10-06-web-ui-design.md` (committed), then `superpowers:writing-plans`

---

## Context

Today the Chief of Staff kit is used entirely through the `claude` terminal (`/gm`, `/triage`, `/my-tasks`, `/enrich`), and its state lives in hand-edited files under `~/.claude` (`goals.yaml`, `my-tasks.yaml`, `schedules.yaml`, `contacts/*.md`). The repo contains no application code, only templates plus `install.sh`.

**Goal:** a local web UI that gives a **dashboard** over those files (all editable) plus a **chat pane** driven by the user's own `claude` CLI. It should feel like the terminal experience (same login, settings, MCP connectors, CLAUDE.md, slash commands), just in a browser.

**What the user said:**
- Dashboard + chat, not chat alone.
- It ships in the kit for anyone who clones it, so it stays generic and runs on localhost.
- Tool approvals happen in the UI.
- Everything (tasks, goals, contacts, schedules) is editable.
- No timed scheduler in v1.
- No Anthropic API key. It must run on the existing `claude` CLI login, so it spawns `claude` directly with no Agent SDK.

**Assumptions:**
- Node 20+ is available.
- Files live in the default `~/.claude` locations written by `install.sh`.
- There's one user per machine.

**Success criteria:**
1. `cd web && npm install && npm start` opens a working UI with no API key.
2. `/gm` run from a button streams output that matches the terminal.
3. A tool not allowed in settings (e.g. sending an email or writing a file) pauses for an Approve/Deny card, and nothing runs until the user clicks.
4. Edits to tasks, goals, contacts and schedules save to the real files, keep their comments, and never clobber concurrent changes made by Claude.
5. When Claude edits a file from chat, the dashboard updates live.

---

## Architecture

```
Browser (React SPA) ──WS + HTTP (token)──> Node server (127.0.0.1:4317)
                                              ├─ ClaudeRunner ── spawn ──> `claude -p … stream-json`
                                              │        ▲                          │
                                              │        └── MCP (HTTP) approve ◄───┘ (permission prompt)
                                              ├─ DataStore (yaml Document API, md parser, atomic writes)
                                              └─ FileWatcher (~/.claude files → WS events)
```

- **Location:** new `web/` folder, separate from the templates. It has `web/server` (TypeScript, Fastify + `ws`) and `web/client` (React + Vite + TypeScript). One `package.json` with these scripts:
  - `npm start` builds the client and starts the server, which serves the built SPA.
  - `npm run dev` gives a watch mode.
- **Install:** README section "Web UI". `install.sh` is not changed in v1.

### Claude runner (`web/server/claude/`)
- **One child process per active chat:**
  ```
  claude -p --input-format stream-json --output-format stream-json --verbose
         --include-partial-messages
         --mcp-config <tmp json: {"mcpServers":{"cos_ui":{"type":"http","url":"http://127.0.0.1:4317/mcp?t=<token>&chat=<id>"}}}>
         --permission-prompt-tool mcp__cos_ui__approve
         [--resume <sessionId>]
  ```
- **Environment:** the working directory defaults to `$HOME` (overridable with the `COS_CWD` env var). The binary comes from `CLAUDE_BIN` or `claude` on PATH. The `--mcp-config` flag adds to the user's MCP servers; `--strict-mcp-config` is never used.
- **Input:** user messages are written to stdin as NDJSON `{"type":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}`. Command buttons send the literal text (`/gm`, `/triage`, `/my-tasks overdue`, `/enrich stale`, schedule `skill` strings).
- **Output:** stdout NDJSON is parsed line by line and normalized into UI events:
  - `text_delta`
  - `tool_use` (name and input)
  - `tool_result`
  - `turn_result` (cost, duration, session_id)
  - `error`

  The browser renders markdown text and collapsible tool blocks.
- **Stop:** sends SIGINT. The next send re-spawns with `--resume <sessionId>`.
- **Session index:** `~/.claude/cos-web/sessions.json` stores `{id, title (first user msg, truncated), createdAt, lastUsedAt}`. The sidebar lists past chats, and opening one re-spawns with `--resume`.

### Approval bridge (`web/server/mcp/`)
- **Endpoint:** a Streamable-HTTP MCP endpoint at `/mcp` (built with `@modelcontextprotocol/sdk`) exposing a single tool, `approve({tool_name, input, tool_use_id?})`.
- **The CLI only calls it** for tools that the user's settings permission rules don't already allow.
- **Handler:**
  1. Creates a pending approval keyed by chat.
  2. Pushes an `approval_request` WS event, which the browser shows as a card with the full input pretty-printed. For email or Slack tools, recipients and body are highlighted.
  3. Awaits the decision.
  4. Returns MCP text content containing the JSON `{"behavior":"allow","updatedInput":<input>}` or `{"behavior":"deny","message":"User denied in web UI"}`.
- **Pending approvals survive WS reconnects:** they're re-sent when the browser connects. If there's no decision after 30 minutes, the request is auto-denied with the message `"No response from user"`.
- **No "always allow" in v1.**

### Data layer (`web/server/data/`)
**Files:**
- `~/.claude/goals.yaml`
- `~/.claude/my-tasks.yaml`
- `~/.claude/schedules.yaml`
- `~/.claude/contacts/*.md`

The base directory can be overridden with `COS_HOME` (used by tests).

**YAML files**
- **Parsing:** `yaml` (eemeli) `parseDocument` and edits through the Document API, so comments and key order survive.
- **Validation:** zod schemas use `.passthrough()`, so unknown fields are kept.
- **Tasks:** `id, title, description, status(pending|in_progress|blocked|complete), priority(1-4), due_date, goal_alignment, created, notes`.
- **Goals:** `quarter, last_updated, objectives[{name, target, priority, key_results[], progress 0..1, status(on_track|at_risk|behind|complete), notes}]`.
- **Schedules:** `schedules[{name, skill, frequency, enabled, notes}]`.

**Contacts**
- **Parsed sections:** H1 `# Contact: Name`, the `## Quick Reference` two-column table becomes a field map, and `## Last Interaction` becomes `{date, channel, followUp}`.
- **Every other `##` section** is kept as raw markdown in order.
- **On save,** parsed fields are re-serialized into the same table and list shapes and other sections are written back verbatim.
- **New contact** copies the template structure to `firstname-lastname.md`. Filenames are slugified and checked for collisions.

**Writes**
- **Concurrency:** every GET returns a `sha256` of the file contents. A PUT must send the hash it loaded. If the current hash differs, the server returns 409 and the UI shows "File changed — reload".
- **Atomicity:** write to a temp file in the same directory, then rename.
- **Malformed YAML** returns a parse error with the line number. The UI shows a read-only view and an "Ask Claude to fix" button, and never writes over a file it couldn't parse.

**Watcher:** `chokidar` on the files above emits `file_changed {kind, name}` over WS. The client refetches the affected view.

### Server API (all routes require the token)
- `GET/PUT /api/tasks`, `POST /api/tasks` (auto `task-XXX` id), `DELETE /api/tasks/:id`
- `GET/PUT /api/goals`
- `GET/PUT /api/schedules`
- `GET /api/contacts`, `GET/PUT/POST/DELETE /api/contacts/:slug`
- `GET /api/health` (claude binary found, `claude --version`, data files present)
- `GET /api/chats` (session index)
- `WS /ws`
  - Client → server: `chat.send {chatId?, text}`, `chat.stop {chatId}`, `chat.open {chatId}`, `approval.decide {id, allow, message?}`.
  - Server → client: chat events, `approval_request`, `file_changed`.

### Client (`web/client/`)
- **Layout:** left nav (Today · Tasks · Goals · Contacts · Schedules · Chats), main view, and a docked, collapsible chat pane on the right on every page.
- **Today:** overdue and due-today tasks, at_risk/behind goals, stale contacts (tier cadence 14/30/60 days from Last Interaction date), and a "Run /gm" button.
- **Tasks:** grouped Overdue / Today / Next 7 days / Later (same buckets as `commands/my-tasks.md`), with inline add, edit, complete and delete. The goal field is a dropdown of goal names plus free text, with a warning when it's empty. "Execute with Claude" sends `Work on <id>: <title>`.
- **Goals:** cards with priority, a progress slider, a status select, an editable key-results list and notes. Saving sets `last_updated` to today.
- **Contacts:** a list (name, tier, last interaction, staleness badge). The editor has form fields for Quick Reference and Last Interaction, plus a markdown textarea with preview per other section. "Enrich with Claude" sends `/enrich <name>`.
- **Schedules:** an editable list with a "Run now" button per entry that sends `skill` to chat.
- **Chat:** streaming markdown, collapsible tool-call blocks, Approval cards (Approve / Deny + optional reason), Stop, cost per turn, and a chat history switcher.

### Security
- The server binds `127.0.0.1` only.
- A random 32-byte token is generated at startup, and the server prints `http://127.0.0.1:4317/?t=<token>`. The client stores it in sessionStorage and sends it as a header or query param. HTTP, WS and MCP requests are all rejected without it.
- `Host` must be `127.0.0.1:<port>` or `localhost:<port>`. A WS `Origin` must match. Together these defend against DNS rebinding and CSRF.
- The data layer only resolves the known files and `contacts/<slug>.md` with slug `^[a-z0-9-]+$`. There are no arbitrary paths.

### Error handling
- **Startup health check:** a missing `claude` binary, or a not-logged-in CLI detected from first-run stderr, shows a blocking banner with the fix.
- **Unexpected CLI exit:** the chat shows the last ~20 stderr lines and a "Resume" button.
- **Approvals:** see the reconnect and 30-minute timeout rules above.
- **Data:** 409 on hash conflict and a read-only view on parse errors (see Data layer above).

---

## Testing
- **Vitest unit tests:**
  - YAML round-trip keeps comments and unknown fields.
  - Task id generation.
  - Urgency bucketing and staleness math (with a fixed clock).
  - Contact markdown parse → serialize is byte-stable for the template.
  - Hash-conflict 409.
  - Path and slug validation.
  - Token, Host and Origin checks.
- **Runner tests:** a fake `claude` (a Node script set via `CLAUDE_BIN`) that replays recorded stream-json fixtures and calls the `approve` MCP tool. These verify event normalization, the approval allow/deny round-trip, the timeout auto-deny, interrupt, resume args, and crash surfacing.
- **Manual smoke test** with the real CLI (documented in the README):
  1. `/gm` streams.
  2. `/my-tasks add "test" --due <date>` prompts approval for the Write, the approved write updates the Tasks view live, and a denied write leaves the file unchanged.
  3. Edit a goal in the UI and confirm comments are preserved in `goals.yaml`.
- **De-risk spike first:** before building the UI, check three things against the real CLI 2.1.x:
  1. Multi-turn stdin in stream-json mode keeps one process alive across turns.
  2. `--permission-prompt-tool` works with an HTTP-type MCP server from `--mcp-config`.
  3. The user's claude.ai connectors (Gmail, Calendar) load in `-p` mode.

  If (1) fails, fall back to spawning one process per turn with `--resume`. If (2) fails, fall back to a stdio MCP shim script that proxies to the server.

## Out of scope (v1)
- Timed or unattended schedule execution
- "Always allow" permission rules
- Multi-user use, remote hosting, auth beyond the local token
- Mobile layout polish, image or file uploads
- Changes to `install.sh` or the existing command templates

## Next steps after approval
1. Save this spec to `docs/superpowers/specs/2026-10-06-web-ui-design.md` and commit it on a feature branch (not main).
2. Invoke `superpowers:writing-plans` to produce the implementation plan, which you'll review before execution starts.

## Changes during implementation
- **Approval re-delivery** on reconnect uses one `approval.snapshot` server message (atomic replace) instead of re-sending individual requests.
- **`PUT /api/tasks`** replaces the whole list via in-place YAML merge. Single-task deletes use `DELETE /api/tasks/:id?hash=` so comments attached to other tasks don't shift.
- **Task ids and `created`** are server-owned on `POST /api/tasks` (client-supplied values are ignored). `PUT /api/tasks` rejects duplicate task ids (400).
- **New contacts** are created with `POST /api/contacts {name}` (the server derives the slug), not `POST /api/contacts/:slug`. Names are whitespace-normalized and capped at 100 characters.
- **Contact slugs** must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`. Files with other names (spaces, dots) are skipped in the list.
- **Contact saves** reject newlines in the title and in Quick Reference / Last Interaction field labels and values. Untouched files save byte-identically, including CRLF files. A raw section edited to lack a trailing newline gets a blank line before the next heading so sections never merge.
- **YAML merge** keeps unchanged flow-style lists (`[a, b]`) in flow style. Only a previously empty list (`tasks: []`) becomes block style when it gains items.
- **`POST /mcp` requires the `chat` query parameter** (400 `missing_chat`). Errors inside the MCP handler return a JSON-RPC 500 rather than leaving the CLI hanging.
- **Stop:** the real CLI answers SIGINT with a `result` of subtype `error_during_execution` and then exits. The runner suppresses that as an error while stopping, so Stop never shows an error bubble.
- **Missing or not-logged-in CLI** is reported in the chat error message on first send. The health banner covers only a missing binary.
- **Chat rendering:** all Markdown goes through one `SafeMarkdown` component. Images are shown as text (`[image: alt] url`) and never loaded, and links open in a new tab with `noreferrer noopener`. This blocks data leaks from untrusted email or Slack content.
- **Approval decisions** are never queued while disconnected. The Approve/Deny buttons are disabled while reconnecting and after a click.
- **Editing:** the Tasks editor is pinned above the lists, so live refreshes never reset it. After a conflict, Reload discards the open edit (as the banner says).
- **Rejected WebSocket upgrades** (bad token, Host, or Origin) close their socket after the 401/403, so server shutdown never hangs.
- **The file watcher logs errors** instead of crashing the server.
- **Dev dependency `concurrently`** is pinned to v9 (v10 requires Node 22; the project floor is Node 20.19).
- **Spike-driven changes:** none to the design. Facts confirmed: one process serves many turns, HTTP MCP permission prompts work, approvals can wait at least 150 s, connectors load in `-p` mode, init is emitted once per turn, and SIGINT ends the process after an interrupted result.
