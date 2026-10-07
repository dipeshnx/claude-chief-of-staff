import { Fragment, useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '../../../shared/types';

// Every input field is shown; these come first and are emphasised: who it goes to and what it says/does.
const HIGHLIGHT = [
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'attendees', 'channel', 'channel_id', 'draftId',
  'subject', 'summary', 'body', 'htmlBody', 'text', 'message', 'forwardText', 'attachments',
  'file_path', 'command', 'content', 'old_string', 'new_string', 'description',
];

export const prettyTool = (name: string) => name.replace(/^mcp__/, '').replace(/__/g, ' › ');
const show = (v: unknown) => (typeof v === 'string' ? v : String(JSON.stringify(v, null, 2)));
const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** All input keys, highlighted ones first (in HIGHLIGHT order), then the rest in input order. */
export function approvalFields(input: unknown): { key: string; highlight: boolean }[] {
  const keys = Object.keys(asObject(input));
  return [
    ...HIGHLIGHT.filter((k) => keys.includes(k)).map((key) => ({ key, highlight: true })),
    ...keys.filter((k) => !HIGHLIGHT.includes(k)).map((key) => ({ key, highlight: false })),
  ];
}

export function ApprovalCard({ request, chatTitle, connected, onDecide }: {
  request: ApprovalRequest;
  chatTitle?: string;
  connected: boolean;
  /** Returns false if the decision could not be sent. */
  onDecide(id: string, allow: boolean, message?: string): boolean;
}) {
  const [reason, setReason] = useState('');
  // Stays true until the card is removed (approval.resolved), so a decision can't be sent twice,
  // unless the send failed or the socket reconnected (the card may be the snapshot's re-delivery).
  const [deciding, setDeciding] = useState(false);
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) setDeciding(false);
    wasConnected.current = connected;
  }, [connected]);
  const disabled = !connected || deciding;
  const decide = (allow: boolean, message?: string) => {
    setDeciding(true);
    if (!onDecide(request.id, allow, message)) setDeciding(false);
  };
  const input = asObject(request.input);
  const fields = approvalFields(request.input);
  return (
    <section className="approval" role="alertdialog" aria-label={`Approve ${prettyTool(request.toolName)}?`}>
      <header title={request.toolName}>
        <strong>Claude wants to use {prettyTool(request.toolName)}</strong>
        {chatTitle && <span className="muted"> · {chatTitle}</span>}
        <div className="muted tool-name"><code>{request.toolName}</code></div>
      </header>
      {fields.length > 0 && (
        <dl>
          {fields.map(({ key, highlight }) => (
            <Fragment key={key}>
              <dt className={highlight ? 'key' : undefined}>{key}</dt>
              <dd><pre>{show(input[key])}</pre></dd>
            </Fragment>
          ))}
        </dl>
      )}
      <details>
        <summary>Full input</summary>
        <pre>{String(JSON.stringify(request.input ?? null, null, 2))}</pre>
      </details>
      <div className="row">
        <button className="primary" disabled={disabled} onClick={() => decide(true)}>Approve</button>
        <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="danger" disabled={disabled} onClick={() => decide(false, reason)}>Deny</button>
      </div>
      {!connected && <p className="muted">Reconnecting — decision unavailable</p>}
    </section>
  );
}
