import { useEffect, useState } from 'react';
import type { ClientMessage, GitStatus } from '@clyde/shared';

// The stable shell frame (Design Vision §1): identity, branch, agent state,
// context, cost — plus the only two global actions, Stop and New session.
// Every control here is real; missing chrome is a designed slot, not a dead button.

export function TopBar({
  projectName,
  gitStatus,
  status,
  connected,
  contextTokens,
  costUsd,
  send,
  onContextClick,
}: {
  projectName: string;
  gitStatus: GitStatus | null;
  status: string;
  connected: boolean;
  contextTokens: number | null;
  costUsd: number | null;
  send: (msg: ClientMessage) => void;
  onContextClick: () => void;
}) {
  const [confirmNew, setConfirmNew] = useState(false);
  useEffect(() => {
    if (!confirmNew) return;
    const t = setTimeout(() => setConfirmNew(false), 6000);
    return () => clearTimeout(t);
  }, [confirmNew]);

  const pct = contextTokens ? Math.min(100, (contextTokens / 1_000_000) * 100) : 0;
  const shownStatus = connected ? status : 'disconnected';
  const working = shownStatus === 'working';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand">
          <span className="logo">◆</span> Clyde
        </span>
        <span className="project-name">{projectName}</span>
        {gitStatus && (
          <span className="branch-chip" title={`${gitStatus.dirtyFiles} uncommitted file${gitStatus.dirtyFiles === 1 ? '' : 's'}`}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="6" cy="5" r="2" />
              <circle cx="6" cy="15" r="2" />
              <circle cx="14" cy="8" r="2" />
              <path d="M6 7v6M14 10c0 3-4 2.5-6 4" />
            </svg>
            {gitStatus.branch}
            {gitStatus.dirtyFiles > 0 && <em>±{gitStatus.dirtyFiles}</em>}
          </span>
        )}
      </div>

      <div className="topbar-right">
        <button
          className="mini-gauge"
          onClick={onContextClick}
          title={`context ~${Math.round((contextTokens ?? 0) / 1000)}k / 1M — open Context panel`}
        >
          <span className="gauge-fill" style={{ width: `${pct}%` }} />
        </button>
        {costUsd != null && (
          <span className="cost" title="Session-cumulative API cost">
            ${costUsd.toFixed(2)}
          </span>
        )}
        <span className={`status status-${shownStatus}`}>
          <span className="status-dot" />
          {shownStatus.replace('_', ' ')}
        </span>
        {working && (
          <button className="topbar-btn danger" title="Interrupt the in-flight turn" onClick={() => send({ type: 'interrupt' })}>
            Stop
          </button>
        )}
        {confirmNew ? (
          <span className="confirm-new">
            fresh session?
            <button
              className="topbar-btn danger"
              onClick={() => {
                send({ type: 'new_session' });
                setConfirmNew(false);
              }}
            >
              Start
            </button>
            <button className="topbar-btn" onClick={() => setConfirmNew(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="topbar-btn"
            title="Start a fresh conversation — tasks, decisions, and panels persist"
            onClick={() => setConfirmNew(true)}
          >
            ＋ New session
          </button>
        )}
      </div>
    </header>
  );
}
