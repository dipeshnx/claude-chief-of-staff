# My AI Chief of Staff

I'm [Mike Murchison](https://linkedin.com/in/mikemurchison), CEO of [Ada](https://ada.cx) — the agentic customer experience platform. Over the past few months, I've been building something on Claude Code that has fundamentally changed how I work: an AI chief of staff that connects to every tool I use, knows my priorities and relationships, and operates 24/7 in the background.

A lot of people have been asking about the setup — at the Claude Code meetup, in conversations with other CEOs, and across our team at Ada where we've been building AI-native operations into how we run the company. So I'm open-sourcing it for you to try, adapt, and improve.

This repo gives you the same foundation. Your context, your goals, your voice.

Watch the walkthrough and demo [here](https://x.com/mimurchison/status/2022368529417224480)

---

## What It Does

Four pillars. One system.

### 1. Communicate
Triage your inbox across email, Slack, and messaging. Get draft responses written in your voice, prioritized by who matters most. I went from 90 minutes of morning inbox processing to about 5.

### 2. Learn
Morning briefings, meeting prep, market signals — all automated. Before every meeting, Claude pulls context from every source: past emails, meeting notes, CRM data, calendar history. You walk in prepared without doing the prep.

### 3. Deepen Relationships
A personal CRM that builds itself. 160+ contacts tracked, auto-enriched every 15 minutes across all channels. Staleness alerts when important relationships go quiet. Suggested outreach with context. I never forget to follow up.

### 4. Achieve Goals
Define your quarterly objectives. Every triage decision, scheduling recommendation, and task prioritization is filtered through what you said matters most. Claude tells me when my calendar doesn't match my goals.

---

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Gmail MCP server (for email)
- Google Calendar MCP server (for scheduling)

### 3 Steps

```bash
# 1. Clone
git clone https://github.com/mimurchison/claude-chief-of-staff.git
cd claude-chief-of-staff

# 2. Install
chmod +x install.sh
./install.sh

# 3. Try it
claude
# Then type: /gm

# Or use the browser dashboard instead (Node.js 20.19+)
cd web && npm install && npm start
```

First morning briefing in under 15 minutes from clone. Prefer a browser? See [Web UI](#web-ui-optional).

## Web UI (optional)

Prefer a browser to the terminal? `web/` is a local dashboard and chat for the same setup. It doesn't use an API key. It runs your installed `claude` CLI, with your login, settings, MCP servers, CLAUDE.md, and slash commands.

Requires Node.js 20.19 or newer.

```bash
cd web
npm install
npm start
# Open the link it prints: http://127.0.0.1:4317/?t=<token>
```

What you get:
- **Today:** overdue and due-today tasks, goals at risk, relationships going quiet, and a one-click `/gm`.
- **Tasks / Goals / Contacts / Schedules:** view and edit `~/.claude/my-tasks.yaml`, `goals.yaml`, `contacts/*.md`, and `schedules.yaml`. Comments in your YAML are kept. If Claude changes a file while you're editing it, the UI asks you to reload instead of overwriting.
- **Chat:** a docked chat with Claude, plus `/gm`, `/triage`, `/my-tasks overdue`, and `/enrich stale` buttons. Any tool your settings don't already allow (sending an email, writing a file) pauses for an **Approve / Deny** card that shows the tool and every field it will be called with. By default, unanswered requests are denied after 30 minutes.

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `COS_PORT` | `4317` | Port (always bound to 127.0.0.1) |
| `COS_HOME` | `~/.claude` | Where goals/tasks/contacts live |
| `COS_CWD` | `~` | Working directory for `claude` |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |
| `COS_TOKEN` | random | Fixed access token, e.g. for a bookmark |
| `COS_APPROVAL_TIMEOUT_MS` | `1800000` (30 min) | How long an approval card waits before it's denied |

Notes:
- The server only listens on 127.0.0.1. It needs the token in the printed link and rejects requests from other websites.
- Schedules aren't run automatically by the web UI yet. Use **Run now**.
- After a server restart, reopening an old chat resumes Claude's context, but earlier messages aren't redrawn.
- Contact files must have simple names (`jane-smith.md`; letters, digits, `-`, `_`, starting with a letter or digit) to appear in the UI.
- Turn costs are the API-equivalent figure the CLI reports. On a Claude subscription you aren't billed per turn.

### Check it works

After `npm start`, open the printed link and run through this once:

1. Click `/gm`. A briefing streams into the chat.
2. Send `/my-tasks add "web UI test" --due <today's date>`. An approval card appears for the file write. Approve it, and the task shows up in **Tasks** without a reload.
3. Ask Claude to write a file, then **Deny** the card. The file isn't created.
4. Stop a reply while it's running, then ask "what were you doing?". Claude answers from the conversation so far.
5. Edit a goal in **Goals** and save. The comments in `goals.yaml` are still there.

---

## Features

### Morning Briefing (`/gm`)
Start every day knowing exactly what matters. Calendar, tasks, urgent messages, signals — before you open your inbox.

### Inbox Triage (`/triage`)
Scan all connected channels and get a prioritized list with draft responses.

| Tier | Action | Example |
|------|--------|---------|
| **Tier 1** | Respond NOW | Board member asking for input |
| **Tier 2** | Handle today | Customer escalation |
| **Tier 3** | FYI / archive | Newsletters, notifications |

### Task Management (`/my-tasks`)
Tasks with execution, not just tracking. Claude drafts the email, does the research, preps the document.

### Contact Enrichment (`/enrich`)
Auto-scans email, Slack, WhatsApp, calendar, and meeting notes to build rich relationship profiles. Alerts you when contacts go stale. Suggests what to talk about.

### Goal-Aligned Everything
Your `goals.yaml` is the source of truth. Claude references it constantly — triaging email, proposing meetings, scoring tasks. It pushes back when your time allocation drifts from your stated priorities.

### Web Dashboard (`web/`)
Everything above, in a browser. A Today view shows what's overdue, at risk, or going quiet. Tasks, goals, contacts, and schedules are editable in place. A docked chat runs `/gm` and `/triage` in one click. Any tool your settings don't already allow, like sending an email, waits for you on an Approve / Deny card. It runs your own `claude` CLI, so there's no API key. See [Web UI](#web-ui-optional).

---

## What's Included

```
claude-chief-of-staff/
├── CLAUDE.md                    # Your AI operating system — customize this
├── install.sh                   # One-command setup
├── goals.yaml                   # Quarterly objectives template
├── my-tasks.yaml                # Task tracking
├── schedules.yaml               # Automation schedules
├── contacts/
│   └── example-contact.md       # Contact file template
├── commands/
│   ├── gm.md                    # Morning briefing
│   ├── triage.md                # Inbox triage
│   ├── my-tasks.md              # Task management
│   └── enrich.md                # Contact enrichment
├── web/                         # Optional browser dashboard + chat (npm start)
│   ├── server/                  # Local server that drives your claude CLI
│   ├── client/                  # React UI
│   └── test/                    # Automated tests (npm test)
└── docs/
    ├── setup-guide.md           # Detailed setup walkthrough
    ├── mcp-servers.md           # MCP server installation
    ├── customization.md         # Make it yours
    └── superpowers/             # Web UI design spec, build plan, CLI findings
```

---

## MCP Servers

More servers = more capability. Start with the essentials, add over time.

| Server | Required? | What It Enables |
|--------|-----------|-----------------|
| Gmail | **Yes** | Email triage, drafting, sending |
| Google Calendar | **Yes** | Scheduling, availability, meeting prep |
| Slack | Recommended | Slack triage, channel monitoring |
| WhatsApp | Optional | WhatsApp message triage |
| iMessage | Optional | iMessage triage (macOS only) |
| Granola | Optional | Meeting notes context |
| PostHog | Optional | Product analytics |

See [docs/mcp-servers.md](docs/mcp-servers.md) for installation instructions.

---

## Customization

The `CLAUDE.md` file is the core. It defines:

- **Who you are** and what you care about
- **How you write** so every draft sounds like you
- **Your goals** so Claude knows what matters
- **Your constraints** (mine: home by 5:30 for dinner)
- **Your relationships** and how to manage them

The longer you use it, the better it gets. Context compounds.

See [docs/customization.md](docs/customization.md) for the full guide.

---

## Philosophy

A few beliefs this system is built on:

1. **AI should push you, not just serve you.** A great chief of staff challenges priorities, says "no" to low-leverage work, and keeps you honest about where your time goes.

2. **Clarity beats comprehensiveness.** Fewer, clearer priorities. Explicit tradeoffs. Fast decisions with flagged assumptions.

3. **Systems compound.** Every interaction makes the system smarter. Contact notes get richer. Writing style gets more accurate. The longer you use it, the better it gets.

4. **Ship, don't polish.** Drafts should be send-ready. Outputs should be usable immediately. Bias toward closing loops.

---

## Contributing

This is early and evolving. If you build useful commands, improve the templates, or add MCP server guides — contributions are very welcome. I'd love to hear what you build with it.

1. Fork the repo
2. Create a feature branch
3. Submit a pull request

Or just open an issue with feedback.

---

## Stay Connected

- [@mimurchison](https://twitter.com/mimurchison) on Twitter/X
- [Mike Murchison](https://linkedin.com/in/mikemurchison) on LinkedIn
- [Ada](https://ada.cx) — the agentic customer experience platform

---

MIT License. See [LICENSE](LICENSE) for details.
