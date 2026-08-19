import { useState } from 'react';
import type { ClientMessage, Exhibit, ExhibitVerdict, TaskItem } from '@clyde/shared';
import { PanelBody } from './PanelContent';

// Blocking exhibits — the second tenant of the attention surface (DECISIONS
// 2026-08-18: needs-my-eyes matures by letting the agent push BLOCKING evidence for
// approval). The agent calls request_review, the turn stops, and the evidence lands
// here: not "looks good" in prose, but the thing itself, with Approve / Decline.
// The verdict returns to the blocked tool call; the comment is the fix list.

export function ExhibitsPanel({
  exhibits,
  tasks,
  send,
}: {
  exhibits: Exhibit[];
  tasks: TaskItem[];
  send: (msg: ClientMessage) => void;
}) {
  const pending = exhibits.filter((x) => x.status === 'pending');
  const settled = exhibits.filter((x) => x.status !== 'pending');
  return (
    <div className="exhibits-panel">
      {pending.length === 0 && (
        <p className="empty">
          Nothing awaiting your verdict — when evidence needs judging, Clyde puts it here and waits.
        </p>
      )}
      {pending.map((x) => (
        <ExhibitCard key={x.id} exhibit={x} task={tasks.find((t) => t.id === x.taskId)} send={send} />
      ))}
      {settled.length > 0 && (
        <>
          <div className="group-label">Ruled on</div>
          {[...settled].reverse().map((x) => (
            <SettledExhibit key={x.id} exhibit={x} />
          ))}
        </>
      )}
    </div>
  );
}

function ExhibitCard({
  exhibit,
  task,
  send,
}: {
  exhibit: Exhibit;
  task?: TaskItem;
  send: (msg: ClientMessage) => void;
}) {
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState<ExhibitVerdict | null>(null);

  const rule = (verdict: ExhibitVerdict) => {
    setSent(verdict);
    const trimmed = comment.trim();
    send({ type: 'exhibit_response', exhibitId: exhibit.id, verdict, ...(trimmed ? { comment: trimmed } : {}) });
  };

  return (
    <section className="exhibit-card">
      <div className="q-kicker">
        <span className="q-kicker-dot" /> Clyde needs a verdict
      </div>
      <div className="ex-title">{exhibit.title}</div>
      {task && (
        <span className="ex-task" title={task.subject}>
          #{task.id} {task.subject}
        </span>
      )}
      {exhibit.detail && <p className="ex-detail">{exhibit.detail}</p>}
      <div className="ex-content">
        <PanelBody content={exhibit.content} />
      </div>
      <textarea
        className="ex-comment"
        rows={2}
        placeholder="Comment (optional — on a decline, this is the fix list)"
        value={comment}
        disabled={sent !== null}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="q-actions">
        <button className="primary" disabled={sent !== null} onClick={() => rule('approved')}>
          {sent === 'approved' ? 'Approved' : 'Approve'}
        </button>
        <button className="ex-decline" disabled={sent !== null} onClick={() => rule('declined')}>
          {sent === 'declined' ? 'Declined' : 'Decline'}
        </button>
        <span className="q-note">{sent ? 'sending…' : 'Clyde is blocked until you rule'}</span>
      </div>
    </section>
  );
}

/** Settled and expired collapse to one outcome row — the record, not the ask. */
function SettledExhibit({ exhibit }: { exhibit: Exhibit }) {
  const glyph = exhibit.status === 'approved' ? '✓' : exhibit.status === 'declined' ? '✗' : '⊘';
  const when = exhibit.settledTs ?? exhibit.ts;
  return (
    <div className={`ex-settled ex-${exhibit.status}`}>
      <div className="ex-settled-line">
        <span className="ex-verdict">
          {glyph} {exhibit.status === 'expired' ? 'expired' : exhibit.status}
        </span>
        <span className="ex-settled-title">{exhibit.title}</span>
        <span className="ex-settled-time">{when.slice(11, 16)}</span>
      </div>
      {exhibit.comment && <div className="ex-settled-comment">“{exhibit.comment}”</div>}
      {exhibit.status === 'expired' && (
        <div className="ex-settled-comment">no longer awaiting a verdict — the blocked call did not survive</div>
      )}
    </div>
  );
}
