import { useRef, useState } from 'react';
import type { ClientMessage, QueuedItem } from '@clyde/shared';

export function Composer({
  status,
  queue,
  send,
}: {
  status: string;
  queue: QueuedItem[];
  send: (msg: ClientMessage) => void;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const working = status === 'working';

  const submit = (urgent: boolean) => {
    if (!text.trim()) return;
    send({ type: 'send_message', text: text.trim(), urgent });
    setText('');
    if (taRef.current) taRef.current.style.height = '';
  };

  return (
    <div className="composer">
      {queue.length > 0 && (
        <div className="queue">
          {queue.map((q) => (
            <div key={q.id} className="queue-item">
              <span>{q.text.slice(0, 120)}</span>
              <button onClick={() => send({ type: 'withdraw_queued', queuedId: q.id })}>✕</button>
            </div>
          ))}
          <div className="queue-note">queued — delivers when the current turn completes</div>
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        placeholder={working ? 'Message (queues until turn boundary)…' : 'Message Clyde…'}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 280)}px`;
        }}
        onKeyDown={(e) => {
          // Slack semantics: Enter sends, Shift+Enter inserts a newline.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(false);
          }
        }}
      />
      <div className="composer-actions">
        <span className={`status status-${status}`}>{status}</span>
        <div>
          {working && (
            <button className="danger" onClick={() => send({ type: 'interrupt' })}>
              Interrupt
            </button>
          )}
          {working && (
            <button className="danger" disabled={!text.trim()} onClick={() => submit(true)}>
              Send now
            </button>
          )}
          <button className="primary" disabled={!text.trim()} onClick={() => submit(false)} title="Enter sends · Shift+Enter for newline">
            {working ? 'Queue' : 'Send'} ⏎
          </button>
        </div>
      </div>
    </div>
  );
}
