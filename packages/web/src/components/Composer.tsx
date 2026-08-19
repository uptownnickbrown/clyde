import { useRef, useState } from 'react';
import type { ClientMessage, QueuedItem } from '@clyde/shared';
import type { AsideCard } from '../store';
import { Md } from './Md';

interface PendingFile {
  path: string;
  name: string;
  mime: string;
  uploading: boolean;
}

const MODELS: [id: string, label: string][] = [
  ['claude-fable-5', 'Fable 5'],
  ['claude-opus-5', 'Opus 5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-haiku-4-5', 'Haiku 4.5'],
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Model + effort picker. Applying rotates the agent session in place (same
 *  conversation, resumed under the new settings), so switching is idle-only —
 *  the popover always opens; Apply is what waits for idle. */
function ModelPicker({
  model,
  effort,
  busy,
  send,
}: {
  model: string;
  effort: string | null;
  busy: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickModel, setPickModel] = useState(model);
  const [pickEffort, setPickEffort] = useState(effort ?? 'xhigh');
  // A scratch session may run an alias (CLYDE_MODEL=haiku) — keep it selectable.
  const options: [string, string][] = MODELS.some(([id]) => id === model)
    ? MODELS
    : [[model, model.replace(/^claude-/, '')], ...MODELS];
  const dirty = pickModel !== model || pickEffort !== (effort ?? 'xhigh');
  return (
    <span className="model-picker">
      <button
        className="model-chip"
        title="Switch the agent model or reasoning effort"
        onClick={() => {
          setPickModel(model);
          setPickEffort(effort ?? 'xhigh');
          setOpen((o) => !o);
        }}
      >
        {model.replace(/^claude-/, '')}
        {effort ? ` · ${effort}` : ''}
      </button>
      {open && (
        <>
          <div className="model-pop-backdrop" onClick={() => setOpen(false)} />
          <div className="model-pop">
            <div className="model-pop-label">Model</div>
            {options.map(([id, label]) => (
              <button
                key={id}
                className={`model-opt${pickModel === id ? ' selected' : ''}`}
                onClick={() => setPickModel(id)}
              >
                {pickModel === id ? '●' : '○'} {label}
              </button>
            ))}
            <div className="model-pop-label">Effort</div>
            <div className="effort-row">
              {EFFORTS.map((e) => (
                <button
                  key={e}
                  className={`effort-opt${pickEffort === e ? ' selected' : ''}`}
                  onClick={() => setPickEffort(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="model-pop-actions">
              <button
                className="primary"
                disabled={!dirty || busy}
                onClick={() => {
                  send({ type: 'set_model', model: pickModel, effort: pickEffort });
                  setOpen(false);
                }}
              >
                Apply
              </button>
              <span className="model-pop-note">
                {busy ? 'applies when Clyde is idle — wait for the turn to end' : 'restarts the agent loop — conversation continues'}
              </span>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/** The ephemeral aside stack: thread-like cards that live above the composer and
 *  never touch the conversation document. Question, then the observer's answer —
 *  dismissed by the user, dropped on reload. The cost chip is per-aside on
 *  purpose: aside spend is never folded into the session gauge. */
function AsideStack({ asides, onDismiss }: { asides: AsideCard[]; onDismiss: (id: string) => void }) {
  if (!asides.length) return null;
  return (
    <div className="aside-stack">
      {asides.map((a) => (
        <div key={a.asideId} className={`aside-card${a.done ? '' : ' running'}`}>
          <div className="aside-head">
            <span className="aside-tag">/btw</span>
            <span className="aside-question">{a.question}</span>
            <button className="aside-x" title="Dismiss this aside" onClick={() => onDismiss(a.asideId)}>
              ✕
            </button>
          </div>
          {a.done ? (
            <>
              {a.error ? (
                <div className="aside-error">{a.error}</div>
              ) : (
                <div className="aside-answer">
                  <Md>{a.answer ?? ''}</Md>
                </div>
              )}
              <div className="aside-meta">
                <span className="aside-chip">
                  {a.model.replace(/^claude-/, '')}
                  {a.durationMs != null ? ` · ${(a.durationMs / 1000).toFixed(1)}s` : ''}
                  {a.costUsd != null ? ` · $${a.costUsd < 0.01 ? a.costUsd.toFixed(4) : a.costUsd.toFixed(2)}` : ''}
                </span>
                <span className="aside-note">ephemeral — never entered the conversation</span>
              </div>
            </>
          ) : (
            <div className="aside-running">
              <span className="aside-spinner" />
              observer reading the workspace…
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Composer({
  status,
  queue,
  model,
  effort,
  asides,
  onDismissAside,
  send,
}: {
  status: string;
  queue: QueuedItem[];
  model: string | null;
  effort: string | null;
  asides: AsideCard[];
  onDismissAside: (asideId: string) => void;
  send: (msg: ClientMessage) => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [review, setReview] = useState(false);
  // Asides are exclusive with review intake: one is "make this a batch of work",
  // the other is "this is not work at all".
  const [aside, setAside] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const working = status === 'working';

  const ready = files.filter((f) => !f.uploading && f.path);
  // An aside is a question, not a delivery: attachments do not travel with it.
  const canSend = Boolean(aside ? text.trim() : text.trim() || ready.length);

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
    // Armed /btw: the message goes to the observer instead of the agent, and the
    // toggle disarms — asides are one-shot, never a mode you forget you are in.
    if (aside) {
      send({ type: 'aside', asideId: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text: text.trim() });
      setText('');
      setAside(false);
      if (taRef.current) taRef.current.style.height = '';
      return;
    }
    send({
      type: 'send_message',
      text: text.trim() || '(see attached files)',
      urgent,
      attachments: ready.length ? ready.map((f) => f.path) : undefined,
      reviewIntake: review || undefined,
    });
    setText('');
    setFiles([]);
    setReview(false);
    if (taRef.current) taRef.current.style.height = '';
  };

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}${review ? ' review-armed' : ''}${aside ? ' aside-armed' : ''}`}
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
      <AsideStack asides={asides} onDismiss={onDismissAside} />
      {aside && (
        <div className="aside-banner">
          <span>
            <strong>Aside</strong> — answered by a read-only observer over git, <code>.clyde/</code> and the
            event log. Nothing here reaches Clyde or the conversation.
          </span>
          <button title="Leave aside mode" onClick={() => setAside(false)}>
            ✕
          </button>
        </div>
      )}
      {review && (
        <div className="review-banner">
          <span>
            <strong>Review intake</strong> — this whole message is saved verbatim as one batch; Clyde
            distills it into numbered items and confirms before filing tasks.
          </span>
          <button title="Leave review mode" onClick={() => setReview(false)}>
            ✕
          </button>
        </div>
      )}
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
        placeholder={
          aside
            ? 'Ask an aside — answered by a read-only observer; never enters the conversation…'
            : review
              ? 'Dump all your feedback — every point, big or small, in one go…'
              : working
                ? 'Message Clyde — delivered mid-turn…'
                : 'Message Clyde…'
        }
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
          <button
            className={`review-toggle${review ? ' armed' : ''}`}
            title={review ? 'Leave review mode' : 'Start a review: dump batch feedback, get a distilled checklist to confirm'}
            onClick={() => {
              setReview(!review);
              setAside(false);
            }}
          >
            ☰ Review
          </button>
          <button
            className={`aside-toggle${aside ? ' armed' : ''}`}
            title={
              aside
                ? 'Leave aside mode'
                : 'Ask an aside: a read-only observer answers from git, .clyde/ and the event log — never enters the conversation'
            }
            onClick={() => {
              setAside(!aside);
              setReview(false);
            }}
          >
            ⌥ /btw
          </button>
          {model && (
            <ModelPicker model={model} effort={effort} busy={working || status === 'awaiting_input'} send={send} />
          )}
        </div>
        <div>
          {working && (
            <button
              className="danger"
              // An aside never interrupts: it is not delivered to the agent at all,
              // so the urgent variant is meaningless while /btw is armed.
              title={canSend && !aside ? 'Interrupt in-flight work and deliver this message now' : 'Interrupt in-flight work'}
              onClick={() => (canSend && !aside ? submit(true) : send({ type: 'interrupt' }))}
            >
              {canSend && !aside ? 'Stop & send' : 'Stop'}
            </button>
          )}
          <button
            className={`primary${aside ? ' aside-send' : ''}`}
            disabled={!canSend}
            onClick={() => submit(false)}
            title={
              aside
                ? 'Ask the observer · Enter sends · Shift+Enter for newline'
                : 'Enter sends · Shift+Enter for newline'
            }
          >
            {aside ? 'Ask ⏎' : 'Send ⏎'}
          </button>
        </div>
      </div>
    </div>
  );
}
