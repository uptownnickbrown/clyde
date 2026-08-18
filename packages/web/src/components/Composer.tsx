import { useRef, useState } from 'react';
import type { ClientMessage, QueuedItem } from '@clyde/shared';

interface PendingFile {
  path: string;
  name: string;
  mime: string;
  uploading: boolean;
}

export function Composer({
  status,
  queue,
  model,
  send,
}: {
  status: string;
  queue: QueuedItem[];
  model: string | null;
  send: (msg: ClientMessage) => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const working = status === 'working';

  const ready = files.filter((f) => !f.uploading && f.path);
  const canSend = Boolean(text.trim() || ready.length);

  const upload = (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const entry: PendingFile = { path: '', name: f.name, mime: f.type, uploading: true };
      setFiles((cur) => [...cur, entry]);
      fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
        .then((r) => r.json())
        .then(({ path }) =>
          setFiles((cur) => cur.map((x) => (x === entry ? { ...x, path, uploading: false } : x))),
        )
        .catch(() => setFiles((cur) => cur.filter((x) => x !== entry)));
    }
  };

  const submit = (urgent: boolean) => {
    if (!canSend) return;
    send({
      type: 'send_message',
      text: text.trim() || '(see attached files)',
      urgent,
      attachments: ready.length ? ready.map((f) => f.path) : undefined,
    });
    setText('');
    setFiles([]);
    if (taRef.current) taRef.current.style.height = '';
  };

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      }}
    >
      {queue.length > 0 && (
        <div className="queue">
          {queue.map((q) => (
            <div key={q.id} className="queue-item">
              <span>
                {q.text.slice(0, 120)}
                {q.attachments?.length ? ` 📎${q.attachments.length}` : ''}
              </span>
              <button onClick={() => send({ type: 'withdraw_queued', queuedId: q.id })}>✕</button>
            </div>
          ))}
          <div className="queue-note">queued — delivers in order</div>
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        placeholder={working ? 'Message Clyde — delivered mid-turn…' : 'Message Clyde…'}
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
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            upload(e.clipboardData.files);
          }
        }}
      />
      {files.length > 0 && (
        <div className="attachments">
          {files.map((f, i) => (
            <div key={i} className="attachment">
              {f.mime.startsWith('image/') && f.path ? (
                <img src={`/api/project-file?path=${encodeURIComponent(f.path)}`} alt={f.name} />
              ) : (
                <span className="attachment-file">📄 {f.name}</span>
              )}
              {f.uploading && <span className="attachment-uploading">uploading…</span>}
              <button className="attachment-x" title="Remove" onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-actions">
        <div>
          <button className="attach" title="Attach files" onClick={() => pickerRef.current?.click()}>
            ＋
          </button>
          <input
            ref={pickerRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = '';
            }}
          />
          {model && (
            <span className="model-chip" title={`Agent model: ${model}`}>
              {model.replace(/^claude-/, '')}
            </span>
          )}
        </div>
        <div>
          {working && (
            <button
              className="danger"
              title={canSend ? 'Interrupt in-flight work and deliver this message now' : 'Interrupt in-flight work'}
              onClick={() => (canSend ? submit(true) : send({ type: 'interrupt' }))}
            >
              {canSend ? 'Stop & send' : 'Stop'}
            </button>
          )}
          <button
            className="primary"
            disabled={!canSend}
            onClick={() => submit(false)}
            title="Enter sends · Shift+Enter for newline"
          >
            Send ⏎
          </button>
        </div>
      </div>
    </div>
  );
}
