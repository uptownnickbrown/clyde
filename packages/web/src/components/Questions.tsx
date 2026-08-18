import { useMemo, useState } from 'react';
import type { ClientMessage, Question, QuestionAnswers, SessionEvent } from '@clyde/shared';

// The question experience — first tenant of the attention-surface ruling: Clyde's
// AskUserQuestion calls render here in the right workbench, block the turn, and
// collapse into an answered history once resolved.

interface QuestionRecord {
  questionId: string;
  questions: Question[];
  answers?: QuestionAnswers;
  response?: string;
  expired: boolean;
}

export interface QuestionState {
  pending: QuestionRecord | null;
  history: QuestionRecord[];
}

/** A question is answerable only while its turn is still open in this session:
 *  an answer, a turn_complete, or a session restart after it kills the card
 *  (the blocking canUseTool promise did not survive whatever ended the turn). */
export function deriveQuestions(events: SessionEvent[]): QuestionState {
  const records: QuestionRecord[] = [];
  const byId = new Map<string, QuestionRecord>();
  for (const e of events) {
    if (e.type === 'question') {
      const rec: QuestionRecord = { questionId: e.questionId, questions: e.questions, expired: false };
      byId.set(e.questionId, rec);
      records.push(rec);
    } else if (e.type === 'question_answered') {
      const rec = byId.get(e.questionId);
      if (rec) {
        rec.answers = e.answers;
        rec.response = e.response;
      }
    } else if (e.type === 'turn_complete' || e.type === 'session_started') {
      for (const rec of records) if (!rec.answers) rec.expired = true;
    }
  }
  const last = records[records.length - 1];
  const pending = last && !last.answers && !last.expired ? last : null;
  return { pending, history: records.filter((r) => r !== pending).reverse() };
}

export function QuestionsPanel({ events, send }: { events: SessionEvent[]; send: (m: ClientMessage) => void }) {
  const { pending, history } = useMemo(() => deriveQuestions(events), [events]);
  return (
    <div className="questions-panel">
      {pending ? (
        <QuestionCard key={pending.questionId} record={pending} send={send} />
      ) : (
        <p className="empty">No open questions — when a fork needs your judgment, Clyde asks here.</p>
      )}
      {history.length > 0 && (
        <>
          <div className="group-label">Answered</div>
          {history.map((h) => (
            <div key={h.questionId} className={`q-history${h.expired ? ' expired' : ''}`}>
              {h.questions.map((q) => (
                <div key={q.question} className="q-history-row">
                  <span className="q-history-q">{q.question}</span>
                  <span className="q-history-a">
                    {h.expired ? 'expired — the turn moved on unanswered' : formatAnswer(h.answers?.[q.question], h.response)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function formatAnswer(a: string | string[] | undefined, response?: string): string {
  if (Array.isArray(a)) return a.join(', ');
  if (a) return a;
  return response ? `“${response}”` : '—';
}

function QuestionCard({ record, send }: { record: QuestionRecord; send: (m: ClientMessage) => void }) {
  const { questionId, questions } = record;
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((s) => {
      const cur = s[qi] ?? [];
      if (multi) return { ...s, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      return { ...s, [qi]: [label] };
    });
    if (!multi) setOther((s) => ({ ...s, [qi]: '' }));
  };

  const answerFor = (qi: number): string | string[] | null => {
    const text = (other[qi] ?? '').trim();
    const sel = selected[qi] ?? [];
    if (questions[qi].multiSelect) {
      const all = text ? [...sel, text] : sel;
      return all.length ? all : null;
    }
    return text || sel[0] || null;
  };
  const complete = questions.every((_, qi) => answerFor(qi) !== null);

  const submit = () => {
    const answers: QuestionAnswers = {};
    questions.forEach((q, qi) => {
      answers[q.question] = answerFor(qi)!;
    });
    setSent(true);
    send({ type: 'answer_question', questionId, answers });
  };

  return (
    <div className="question-card">
      <div className="q-kicker">
        <span className="q-kicker-dot" /> Clyde asks
      </div>
      {questions.map((q, qi) => (
        <div className="q-block" key={q.question}>
          <div className="q-text">
            {q.header && <span className="q-header">{q.header}</span>}
            {q.question}
          </div>
          <div className="q-options">
            {q.options.map((o) => {
              const on = (selected[qi] ?? []).includes(o.label);
              return (
                <button
                  key={o.label}
                  className={`q-option${on ? ' selected' : ''}`}
                  disabled={sent}
                  onClick={() => toggle(qi, o.label, !!q.multiSelect)}
                >
                  <span className="q-check">{q.multiSelect ? (on ? '▣' : '▢') : on ? '●' : '○'}</span>
                  <span className="q-option-main">
                    <span className="q-option-label">{o.label}</span>
                    {o.description && <span className="q-option-desc">{o.description}</span>}
                    {o.preview && <span className="q-preview" dangerouslySetInnerHTML={{ __html: o.preview }} />}
                  </span>
                </button>
              );
            })}
            <input
              className="q-other"
              placeholder="Other — type your own answer…"
              value={other[qi] ?? ''}
              disabled={sent}
              onChange={(e) => {
                setOther((s) => ({ ...s, [qi]: e.target.value }));
                if (!q.multiSelect && e.target.value) setSelected((s) => ({ ...s, [qi]: [] }));
              }}
            />
          </div>
        </div>
      ))}
      <div className="q-actions">
        <button className="primary" disabled={!complete || sent} onClick={submit}>
          {sent ? 'Answered' : 'Answer'}
        </button>
        <span className="q-note">{sent ? 'sending…' : 'Clyde is blocked until you answer'}</span>
      </div>
    </div>
  );
}
