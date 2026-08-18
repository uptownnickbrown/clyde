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

export function Conversation({
  events,
  threads,
  liveText,
  send,
}: {
  events: SessionEvent[];
  threads: Thread[];
  liveText: Record<string, string>;
  send: (msg: ClientMessage) => void;
}) {
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [composing, setComposing] = useState<{ messageId: string; quote: string } | null>(null);

  const { items, threadMessages } = useMemo(() => deriveItems(events), [events]);
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

  return (
    <div className="conversation" onMouseDown={() => setPending(null)}>
      <div className="conversation-doc">
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.event.id} className="msg-user">
                <Md>{item.event.text}</Md>
              </div>
            );
          case 'assistant': {
            const anchored = threadsByMessage.get(item.event.id) ?? [];
            return (
              <div key={item.event.id} id={`msg-${item.event.id}`} className="msg-assistant-wrap">
                <div className="msg-assistant" onMouseUp={(e) => onMouseUp(e, item.event.id)}>
                  <Md>{item.event.markdown}</Md>
                </div>
                {composing?.messageId === item.event.id && (
                  <CommentBox
                    quote={composing.quote}
                    onSubmit={(text, urgent) => {
                      send({
                        type: 'create_thread',
                        anchor: {
                          messageId: item.event.id,
                          start: Math.max(0, item.event.markdown.indexOf(composing.quote)),
                          end: Math.max(0, item.event.markdown.indexOf(composing.quote)) + composing.quote.length,
                          quote: composing.quote,
                        },
                        text,
                        urgent,
                      });
                      setComposing(null);
                    }}
                    onCancel={() => setComposing(null)}
                  />
                )}
                {anchored.map((t) => (
                  <ThreadCard key={t.id} thread={t} messages={threadMessages.get(t.id) ?? []} send={send} />
                ))}
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
          <div key={turnId} className="msg-assistant live">
            <Md>{text.replace(/^\s*\[\[sidebar[^\]]*\]\]\s*/, '')}</Md>
            <span className="cursor">▋</span>
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
          💬 Comment
        </button>
      )}
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
                  <code>{i.tool}</code> {summarizeInput(i.tool, i.input)}
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
  send,
}: {
  thread: Thread;
  messages: SessionEvent[];
  send: (msg: ClientMessage) => void;
}) {
  const [reply, setReply] = useState('');
  return (
    <div className={`thread-card ${thread.status}`}>
      <div className="thread-quote">“{thread.anchor.quote.slice(0, 200)}”</div>
      {messages.map((m) => (
        <div key={m.id} className={m.type === 'user_message' ? 'thread-user' : 'thread-assistant'}>
          <Md>{m.type === 'user_message' ? m.text : m.type === 'assistant_message' ? m.markdown : ''}</Md>
        </div>
      ))}
      {thread.status === 'open' ? (
        <div className="thread-actions">
          <input
            value={reply}
            placeholder="Reply in thread…"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reply.trim()) {
                send({ type: 'thread_reply', threadId: thread.id, text: reply.trim() });
                setReply('');
              }
            }}
          />
          <button onClick={() => send({ type: 'resolve_thread', threadId: thread.id })}>Resolve</button>
        </div>
      ) : (
        <div className="thread-resolved">✓ resolved</div>
      )}
    </div>
  );
}

function CommentBox({
  quote,
  onSubmit,
  onCancel,
}: {
  quote: string;
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
      <div className="thread-quote">“{quote.slice(0, 200)}”</div>
      <textarea
        autoFocus
        value={text}
        placeholder="Comment on this…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="thread-actions">
        <button disabled={!text.trim()} onClick={() => onSubmit(text.trim(), false)}>
          Comment
        </button>
        <button disabled={!text.trim()} onClick={() => onSubmit(text.trim(), true)} title="Interrupt current work">
          Comment now (interrupt)
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
