import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { ClientMessage, SessionEvent, Thread } from '@clyde/shared';
import { Md } from './Md';

// The conversation document: prose only, tool noise collapsed to chips,
// threads rendered under their anchor messages.

type ActivityItem = Extract<SessionEvent, { type: 'tool_call' | 'dispatch' }>;
type Item =
  | { kind: 'user'; event: Extract<SessionEvent, { type: 'user_message' }> }
  | { kind: 'assistant'; event: Extract<SessionEvent, { type: 'assistant_message' }> }
  | { kind: 'activity'; items: ActivityItem[]; id: string }
  | { kind: 'commit'; event: Extract<SessionEvent, { type: 'commit' }> }
  | { kind: 'compaction'; event: Extract<SessionEvent, { type: 'compaction' }> };

interface PendingComment {
  messageId: string;
  quote: string;
  x: number;
  y: number;
}

/** One autosize for every message box — main composer, thread reply, new thread. */
function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, 280)}px`;
}

export function Conversation({
  events,
  threads,
  liveText,
  status,
  send,
}: {
  events: SessionEvent[];
  threads: Thread[];
  liveText: Record<string, string>;
  status: string;
  send: (msg: ClientMessage) => void;
}) {
  const working = status === 'working';
  const [pending, setPending] = useState<PendingComment | null>(null);
  // quote === null → message-level thread (anchored to the whole message, no span).
  const [composing, setComposing] = useState<{ messageId: string; quote: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true); // near the bottom → follow new content
  const hydratedRef = useRef(false);

  const { items, threadMessages } = useMemo(() => deriveItems(events), [events]);

  // Speaker headers appear on speaker change only — consecutive same-speaker
  // messages read as one continuous passage (document, not chat bubbles).
  const { heads, liveNeedsHead } = useMemo(() => {
    const heads = new Map<string, boolean>();
    let last: 'user' | 'assistant' | null = null;
    for (const it of items) {
      if (it.kind === 'user' || it.kind === 'assistant') {
        heads.set(it.event.id, last !== it.kind);
        last = it.kind;
      }
    }
    return { heads, liveNeedsHead: last !== 'assistant' };
  }, [items]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || events.length === 0) return;
    const last = events[events.length - 1];
    const ownSend = last.type === 'user_message' && !last.threadId;
    if (!hydratedRef.current || pinnedRef.current || ownSend) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
      pinnedRef.current = true;
      hydratedRef.current = true;
    }
  }, [events, liveText]);
  const threadsByMessage = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      const list = map.get(t.anchor.messageId) ?? [];
      list.push(t);
      map.set(t.anchor.messageId, list);
    }
    return map;
  }, [threads]);

  const onMouseUp = (e: MouseEvent, messageId: string) => {
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    if (quote.length > 2) {
      setPending({ messageId, quote, x: e.clientX, y: e.clientY });
    } else {
      setPending(null);
    }
  };

  // Shared per-message thread affordances — identical for user and assistant messages.

  /** Ghost button in the message margin: start a thread on the whole message. */
  const threadAffordance = (messageId: string) => (
    <button
      className="thread-affordance"
      title="Start a thread on this message"
      onClick={() => setComposing({ messageId, quote: null })}
    >
      ⊕ Thread
    </button>
  );

  /** The thread-start box, if it is open on this message. `sourceText` locates
   *  span offsets for quoted threads; message-level threads anchor bare. */
  const threadStart = (messageId: string, sourceText: string) => {
    if (composing?.messageId !== messageId) return null;
    const quote = composing.quote;
    return (
      <ThreadStartBox
        quote={quote}
        working={working}
        onSubmit={(text, urgent) => {
          send({
            type: 'create_thread',
            anchor: quote
              ? {
                  messageId,
                  start: Math.max(0, sourceText.indexOf(quote)),
                  end: Math.max(0, sourceText.indexOf(quote)) + quote.length,
                  quote,
                }
              : { messageId },
            text,
            urgent,
          });
          setComposing(null);
        }}
        onCancel={() => setComposing(null)}
      />
    );
  };

  /** Every thread anchored on this message, span and message-level alike. */
  const threadCards = (messageId: string) =>
    (threadsByMessage.get(messageId) ?? []).map((t) => (
      <ThreadCard key={t.id} thread={t} messages={threadMessages.get(t.id) ?? []} working={working} send={send} />
    ));

  return (
    <div
      className="conversation"
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      onMouseDown={() => setPending(null)}
    >
      <div className="conversation-doc">
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.event.id} id={`msg-${item.event.id}`} className="msg msg-user">
                {threadAffordance(item.event.id)}
                {heads.get(item.event.id) && <SpeakerHead who="user" ts={item.event.ts} />}
                <div className="user-body">
                  <Md>{item.event.text}</Md>
                  {(item.event.attachments?.length ?? 0) > 0 && (
                    <div className="msg-attachments">
                      {item.event.attachments!.map((p) => (
                        <a
                          key={p}
                          href={`/api/project-file?path=${encodeURIComponent(p)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/\.(png|jpe?g|gif|webp|svg)$/i.test(p) ? (
                            <img src={`/api/project-file?path=${encodeURIComponent(p)}`} alt={p} />
                          ) : (
                            <span className="attachment-file">📄 {p.split('/').pop()}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {threadStart(item.event.id, item.event.text)}
                {threadCards(item.event.id)}
              </div>
            );
          case 'assistant': {
            return (
              <div key={item.event.id} id={`msg-${item.event.id}`} className="msg msg-assistant-wrap">
                {threadAffordance(item.event.id)}
                {heads.get(item.event.id) && <SpeakerHead who="clyde" ts={item.event.ts} />}
                <div className="msg-assistant" onMouseUp={(e) => onMouseUp(e, item.event.id)}>
                  <Md>{item.event.markdown}</Md>
                </div>
                {threadStart(item.event.id, item.event.markdown)}
                {threadCards(item.event.id)}
              </div>
            );
          }
          case 'activity':
            return <ActivityChip key={item.id} items={item.items} />;
          case 'commit':
            return (
              <div key={item.event.id} className="divider commit-divider">
                <span className="commit-sha">{item.event.commit.sha.slice(0, 7)}</span>
                <span>{item.event.commit.subject}</span>
                <span className="diffstat">
                  +{item.event.commit.insertions} −{item.event.commit.deletions}
                </span>
              </div>
            );
          case 'compaction':
            return (
              <div key={item.event.id} className="divider compaction-divider">
                context compacted{item.event.preTokens ? ` (${Math.round(item.event.preTokens / 1000)}k tokens before)` : ''}
              </div>
            );
        }
      })}

      {Object.entries(liveText).map(([turnId, text]) =>
        text ? (
          <div key={turnId} className="msg msg-assistant-wrap">
            {liveNeedsHead && <SpeakerHead who="clyde" ts={new Date().toISOString()} />}
            <div className="msg-assistant live">
              <Md>{text.replace(/^\s*\[\[sidebar[^\]]*\]\]\s*/, '')}</Md>
              <span className="cursor">▋</span>
            </div>
          </div>
        ) : null,
      )}
      </div>

      {pending && (
        <button
          className="comment-fab"
          style={{ left: pending.x, top: pending.y + 12 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            setComposing({ messageId: pending.messageId, quote: pending.quote });
            setPending(null);
          }}
        >
          💬 Start thread
        </button>
      )}
    </div>
  );
}

function SpeakerHead({ who, ts }: { who: 'user' | 'clyde'; ts: string }) {
  return (
    <div className="msg-head">
      {who === 'clyde' ? (
        <span className="avatar avatar-clyde">◆</span>
      ) : (
        <span className="avatar avatar-user">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="10" cy="6.5" r="3" />
            <path d="M4 16.5c1.2-3 3.5-4.5 6-4.5s4.8 1.5 6 4.5" />
          </svg>
        </span>
      )}
      <span className="msg-name">{who === 'clyde' ? 'Clyde' : 'You'}</span>
      <span className="msg-time">
        {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function deriveItems(events: SessionEvent[]) {
  const items: Item[] = [];
  const threadMessages = new Map<string, SessionEvent[]>();
  let activity: ActivityItem[] = [];
  const flush = () => {
    if (activity.length) {
      items.push({ kind: 'activity', items: activity, id: activity[0].id });
      activity = [];
    }
  };
  for (const e of events) {
    switch (e.type) {
      case 'user_message':
      case 'assistant_message': {
        // Auto-resume plumbing stays in the log but out of the document.
        if (e.type === 'user_message' && e.text.startsWith('[Auto-resume]')) {
          flush();
          break;
        }
        if (e.threadId) {
          const list = threadMessages.get(e.threadId) ?? [];
          list.push(e);
          threadMessages.set(e.threadId, list);
          break;
        }
        flush();
        items.push(e.type === 'user_message' ? { kind: 'user', event: e } : { kind: 'assistant', event: e });
        break;
      }
      case 'tool_call':
      case 'dispatch':
        activity.push(e);
        break;
      case 'commit':
        flush();
        items.push({ kind: 'commit', event: e });
        break;
      case 'compaction':
        flush();
        items.push({ kind: 'compaction', event: e });
        break;
      default:
        break;
    }
  }
  flush();
  return { items, threadMessages };
}

function ActivityChip({ items }: { items: ActivityItem[] }) {
  const [open, setOpen] = useState(false);
  const tools = items.filter((i) => i.type === 'tool_call');
  const dispatches = items.filter((i) => i.type === 'dispatch');
  return (
    <div className="activity-chip">
      <button onClick={() => setOpen(!open)}>
        ⚙ {tools.length} tool call{tools.length === 1 ? '' : 's'}
        {dispatches.length > 0 && ` · ${dispatches.length} subagent${dispatches.length === 1 ? '' : 's'}`} {open ? '▾' : '▸'}
      </button>
      {open && (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              {i.type === 'tool_call' ? (
                <>
                  <code>{i.tool.replace(/^mcp__\w+?__/, '')}</code> {summarizeInput(i.tool, i.input)}
                </>
              ) : (
                <>
                  <code>dispatch</code> {i.description ?? i.agentType ?? ''}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function summarizeInput(tool: string, input: unknown): string {
  const i = input as Record<string, unknown> | null;
  if (!i) return '';
  const pathVal = i.file_path ?? i.path;
  if (typeof pathVal === 'string') return shortPath(pathVal);
  const val = i.command ?? i.pattern ?? i.description ?? '';
  return typeof val === 'string' ? val.slice(0, 80) : '';
}

/** Absolute paths are noise in the document — show a tail the eye can parse. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

function ThreadCard({
  thread,
  messages,
  working,
  send,
}: {
  thread: Thread;
  messages: SessionEvent[];
  working: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const [reply, setReply] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const submit = (urgent: boolean) => {
    if (!reply.trim()) return;
    send({ type: 'thread_reply', threadId: thread.id, text: reply.trim(), urgent });
    setReply('');
    if (taRef.current) taRef.current.style.height = '';
  };
  if (thread.status === 'resolved' && !showResolved) {
    // Message-level threads have no quote — the stub falls back to the opening message.
    const first = messages[0];
    const label =
      thread.anchor.quote ??
      (first?.type === 'user_message' ? first.text : first?.type === 'assistant_message' ? first.markdown : 'thread');
    return (
      <button className="thread-stub" onClick={() => setShowResolved(true)}>
        ✓ “{label.slice(0, 90)}” · {messages.length} repl{messages.length === 1 ? 'y' : 'ies'} ▸
      </button>
    );
  }
  return (
    <div className={`thread-card ${thread.status}`}>
      {thread.anchor.quote && <div className="thread-quote">“{thread.anchor.quote.slice(0, 200)}”</div>}
      {messages.map((m) => (
        <div key={m.id} className={m.type === 'user_message' ? 'thread-user' : 'thread-assistant'}>
          <Md>{m.type === 'user_message' ? m.text : m.type === 'assistant_message' ? m.markdown : ''}</Md>
        </div>
      ))}
      {thread.status === 'open' ? (
        <div className="thread-actions">
          <textarea
            ref={taRef}
            rows={1}
            value={reply}
            placeholder="Reply in thread…"
            onChange={(e) => {
              setReply(e.target.value);
              autosize(e.target);
            }}
            onKeyDown={(e) => {
              // Slack semantics everywhere: Enter sends, Shift+Enter inserts a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(false);
              }
            }}
          />
          {working && (
            <button
              className="danger"
              disabled={!reply.trim()}
              title="Interrupt in-flight work and deliver this reply now"
              onClick={() => submit(true)}
            >
              Stop &amp; send
            </button>
          )}
          <button
            className="primary"
            disabled={!reply.trim()}
            title="Enter sends · Shift+Enter for newline"
            onClick={() => submit(false)}
          >
            Send ⏎
          </button>
          <button onClick={() => send({ type: 'resolve_thread', threadId: thread.id })}>Resolve</button>
        </div>
      ) : (
        <button className="thread-resolved linklike" onClick={() => setShowResolved(false)}>
          ✓ resolved — collapse ▾
        </button>
      )}
    </div>
  );
}

function ThreadStartBox({
  quote,
  working,
  onSubmit,
  onCancel,
}: {
  /** null → message-level thread: anchored to the whole message, no quote line. */
  quote: string | null;
  working: boolean;
  onSubmit: (text: string, urgent: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  // The box mounts below the message (possibly past open threads) — bring it to the eye.
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <div className="comment-box" ref={boxRef}>
      {quote && <div className="thread-quote">“{quote.slice(0, 200)}”</div>}
      <textarea
        autoFocus
        value={text}
        placeholder="Start a thread…"
        onChange={(e) => {
          setText(e.target.value);
          autosize(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
            e.preventDefault();
            onSubmit(text.trim(), false);
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="thread-actions">
        {working && (
          <button
            className="danger"
            disabled={!text.trim()}
            title="Interrupt in-flight work and deliver this now"
            onClick={() => onSubmit(text.trim(), true)}
          >
            Stop &amp; send
          </button>
        )}
        <button
          className="primary"
          disabled={!text.trim()}
          title="Enter sends · Shift+Enter for newline"
          onClick={() => onSubmit(text.trim(), false)}
        >
          Send ⏎
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
