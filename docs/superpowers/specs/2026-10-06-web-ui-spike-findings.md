# Web UI spike findings (claude CLI 2.1.292, subscription login, no API key)

Spike script was throwaway (scratchpad). All scenarios ran with cwd `/tmp`,
`--verbose --include-partial-messages -p --input-format stream-json --output-format stream-json
--mcp-config <http cos_ui> --permission-prompt-tool mcp__cos_ui__approve`, `MCP_TOOL_TIMEOUT=1900000`.
Each run reports `total_cost_usd` of roughly $0.19-0.30 (subscription usage; no API key).

## Summary

| Check | Result | Gate branch |
|---|---|---|
| (a) one process, multiple stdin turns | PASS | none |
| (b) `--permission-prompt-tool` + HTTP MCP, input `{tool_name,input,tool_use_id}` | PASS | none |
| (c) allow/deny response shape | PASS | none |
| (d) approval waits 150 s | PASS | none |
| (e) claude.ai connectors in `init.mcp_servers` | PASS | none |
| (f) SIGINT | PASS (mid-turn: `result` error_during_execution then exit 0, stdin open) | none; Task 10 must respawn with `--resume` after stop |
| (g) inherited `CLAUDE_CODE_*` env | PASS, no observable difference | none |

No gate branch triggered; no later task needs changing because of these results.
Spec notes (additions, not corrections) are under each check.

## (a) Multi-turn on one process: PASS
```
[result] success ... session=f525a0fd-... text="one"
[result] success ... session=f525a0fd-... text="two"
[exit] code=0 signal=null pid=35647
```
One pid, same session_id, two results, single exit after stdin end.
Note: a `system/init` event is emitted once PER TURN (2 init events in the fixture), not once per process.
Stream event type counts for the 2-turn run: stream_event 12, system/init 2, system/status 2, assistant 2,
result 2, system/hook_started 1, system/hook_response 1, rate_limit_event 1. Fixture:
`web/test/fixtures/real-stream.ndjson` (paths and username scrubbed).

## (b) permission-prompt-tool via HTTP MCP: PASS
The hidden flag is accepted. `init.mcp_servers` shows `{"name":"cos_ui","status":"connected","source":"dynamic"}`.
Tool input exactly:
```
[approve called] {"tool_name":"Write","input":{"file_path":"/tmp/cos-spike.txt","content":"hi"},"tool_use_id":"toolu_..."}
```
`tool_use_id` is shown here as `toolu_...` with the value elided; it is present (kept optional in zod schema is fine).

## (c) Response shape: PASS
MCP tool result `content:[{type:'text', text: JSON.stringify(d)}]` with:
- allow: `{"behavior":"allow","updatedInput":<input>}` -> file created (`[file ... exists] true`)
- deny: `[approve called] {"tool_name":"Write","input":{"file_path":"/tmp/cos-spike.txt","content":"hi"},"tool_use_id":"toolu_..."}`; `{"behavior":"deny","message":"Denied by spike"}` -> file NOT created (`false`); the model is told the
  message ("Denied by spike") and reports it, result is still `success`/`is_error=false`.

## (d) 150 s approval wait: PASS
approve-slow literal lines:
```
[approve called] {"tool_name":"Write","input":{"file_path":"/tmp/cos-spike.txt","content":"hi"},"tool_use_id":"toolu_..."}
[approve returning] {"behavior":"allow","updatedInput":{"file_path":"/tmp/cos-spike.txt","content":"hi"}}
[result] success is_error=false cost=0.2021 text="I created `/tmp/cos-spike.txt` containing `hi` with the Write tool. I didn't use Bash."
[exit] code=0 signal=null
```
Held 150 s, returned allow; `[result] success`, file exists `true`, total wall time
2:39.6. No timeout error with `MCP_TOOL_TIMEOUT=1900000`.

## (e) Connectors in init: PASS
`init.mcp_servers` entries have `name`, `status`, `source` (`user` | `claudeai` | `dynamic`).
Connectors appear with names like `claude.ai Gmail`, `claude.ai Google Calendar`, `claude.ai Slack`,
all `connected`, `source: claudeai`. Connectors the account hasn't authorized show `needs-auth`.
User-configured MCP servers (from `~/.claude` settings) appear with `source: user`.
Also `init` has `cwd`, `tools`, `slash_commands`, `skills`, `plugins`, `permissionMode`, `apiKeySource`, `claude_code_version`.

## (f) SIGINT: PASS (SIGINT alone ends the process)
Deviation from brief: the brief's sigint prompt ("count 1 to 300", SIGINT at 5 s) was unusable. At 5 s the CLI was
still starting (before `init`), and with a faster model the count finishes in under 20 s. I used the prompt
"Write a 3000-word essay about the history of bridges." and a SIGINT delay of 12 s (env `SIGINT_MS`).

- Attempt 1 (brief's prompt, SIGINT at 5 s, stdin OPEN, before `init`): exit code=0 signal=null, no `result`
  (stream: hook_started, hook_response, rate_limit_event only). So SIGINT with stdin open exited 0, but during startup.
- Attempt 2 (brief's prompt, delay 20 s): turn finished first, no signal sent. Unrepresentative.
- Attempt 3 (essay prompt, SIGINT at 12 s, spike closed stdin after `result`): `result` subtype
  `error_during_execution`, then exit 0. Weak evidence: exit could have come from stdin closing.
- Attempt 4 (decisive; essay prompt, SIGINT at 12 s mid-turn, stdin left OPEN after `result`, waited 10 s):
```
[sending SIGINT]
[result] error_during_execution is_error=true cost=0.1955 session=f2ae80ae-... text=undefined
[stdin left open; waiting 10s]
[exit] code=0 signal=null pid=47465
```
The process exited on its own (code 0, no signal) within the 10 s wait, so the follow-up message branch was not
reached (no "still alive" line). SIGINT mid-turn emits `result` (`error_during_execution`) and then the process
exits 0 without stdin closing. Verdict: PASS. Gate branch (SIGTERM in Task 10 `stop()`) does NOT apply.
Consequence for design: SIGINT is NOT an in-process interrupt. Stopping a turn kills the process, so the next
turn needs a new process with `--resume <session_id>`. (An in-process interrupt, if wanted, would have to be a
different mechanism and was not tested.)

## (g) Inherited env vars: PASS (no difference)
Vars present in the spike's environment (names only): `CLAUDECODE`, `CLAUDE_CODE_ENABLE_TASKS`,
`CLAUDE_CODE_EMIT_STARTUP_TIMING`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`,
`CLAUDE_CODE_QUESTION_PREVIEW_FORMAT`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`,
`CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`.
`init` with and without `--strip-env`: both `[result] success text="ok"`, identical mcp_servers (names and statuses),
identical event-type sequence. Only per-run fields differed (session_id, uuid, agents, scratchpad_path,
messaging_socket_path, fast_mode_disabled_reason, startup_timing). Note `messaging_socket_path` is set in the
non-stripped run, i.e. inherited vars leak parent-session wiring into init, but nothing functional broke.
Scope: only `init` and the event-type sequence were compared; the permission-prompt flow was NOT re-run with stripped env.
Recommendation: still strip them (harmless, avoids parent-session coupling), keep the Task 9 regex as is.

## Fixture caveats (for Tasks 8-11)
`web/test/fixtures/real-stream.ndjson` is reference only. Line 2 (`system/hook_response`) and the `system/init` lines
are environment-specific (hooks, plugins, skills, paths, connectors) and tests MUST NOT assert on them.
Consumers must dispatch on `.type` (and `.subtype`) and never rely on field order or line position.

## Other observations
- Run cost per tiny turn is ~$0.19-0.30 reported, due to large system prompt/tools.
- Without `--permission-mode`, Write triggered the prompt tool (as desired).

## Smoke test (2026-10-07, real CLI via Playwright)

- Check 1 /gm streams: PASS. Briefing streamed (~2.7k chars in the chat panel), sections seen: CALENDAR, TASKS, GOALS, URGENT, FOCUS RECOMMENDATION. Ended with a cost line.
- Check 2 approve then live update: PASS with a caveat. Edit card on my-tasks.yaml approved; Tasks view showed the task and grep found it. Claude capitalized the title ("Web UI smoke test"), so a case-sensitive grep fails. I tested the Tasks view via in-app navigation, not by watching an already-open Tasks view update.
- Check 3 deny: PASS. Write card for ~/cos-web-deny-test.txt denied with reason "test"; Claude reported the denial; the file does not exist.
- Check 4 stop then resume: PASS (with a changed prompt). "1 to 300" finished in about 6s, too fast to stop. Used "1 to 5000" instead. The first Stop, at 1.1s, was before any output. The second Stop, at 608, left no error bubble. The follow-up answer said it was counting to 5000 and had reached 608.
- Check 5 goal edit keeps comments: PASS. Comment line count 15 before and after. Diff touched only last_updated, progress (0.0 to 0.05) and one inline-comment spacing change (`"on_track"   #` became `"on_track" #`).
- Check 6 UI delete: PASS. Confirm dialog accepted; task gone; my-tasks.yaml identical to the backup.

Approval cards seen:
- claude_ai_Google_Calendar list_events (read-only): approved
- claude_ai_Gmail search_threads (read-only): approved
- Edit on ~/.claude/my-tasks.yaml (adds the test task): approved
- Write on ~/cos-web-deny-test.txt: denied
- ToolSearch, Bash and Read ran during /gm and /my-tasks with no card (presumably already allowed in settings).

Cleanup and restore:
- Server stopped, port 4317 free, no `claude -p` children left.
- goals.yaml restored from backup (diff showed only the edit); my-tasks.yaml was already identical to the backup.
- `shasum -c` OK for both files. ~/.claude/cos-web/sessions.json is left in place (app chat index). .playwright-mcp removed.

Surprising:
- A bulk-approve via page script was blocked by the auto-mode classifier, so the cards were approved one by one with real clicks.
- Claude's own reply to the task add questioned the task's priority and asked which web UI it meant.
- The goals save normalizes the whitespace before inline comments.
