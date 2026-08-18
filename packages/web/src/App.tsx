import { useState } from 'react';
import { useClyde } from './store';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { WorkBar } from './components/WorkBar';
import {
  ActivityPanel,
  AgentsPanel,
  ContextPanel,
  GitPanel,
  GoalPanel,
  LogsPanel,
  PushedPanels,
  ReviewsPanel,
  TasksPanel,
} from './components/Sidebars';

type RightTab = 'goal' | 'panels' | 'reviews' | 'agents' | 'activity' | 'context' | 'logs';

export default function App() {
  const { state, send } = useClyde();
  const [tab, setTab] = useState<RightTab>('goal');
  const [railW, setRailW] = useState(() => Number(localStorage.getItem('clyde.rightRailWidth')) || 290);

  const startRailDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const w = Math.min(720, Math.max(240, window.innerWidth - ev.clientX));
      setRailW(w);
      localStorage.setItem('clyde.rightRailWidth', String(w));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const pct = state.contextTokens ? Math.min(100, (state.contextTokens / 1_000_000) * 100) : 0;

  // Tasks currently delegated: dispatches whose description names a task and whose
  // tool_result hasn't landed yet (the R8 linking convention).
  const resultIds = new Set(
    state.events.filter((e) => e.type === 'tool_result').map((e) => (e.type === 'tool_result' ? e.toolUseId : '')),
  );
  const delegated = new Set(
    state.events
      .filter((e) => e.type === 'dispatch' && e.description && !resultIds.has(e.toolUseId))
      .map((e) => (e.type === 'dispatch' ? e.description! : '')),
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">◆</span> Clyde
          <span className="project-name">{state.projectName}</span>
        </div>
        <div className="header-right">
          <div className="mini-gauge" title={`context ~${Math.round((state.contextTokens ?? 0) / 1000)}k / 1M`}>
            <div className="gauge-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className={`status status-${state.status}`}>
            {state.connected ? state.status : 'connecting…'}
          </span>
        </div>
      </header>

      <div className="columns">
        <aside className="left-rail">
          <TasksPanel tasks={state.tasks} delegated={delegated} />
          <GitPanel commits={state.commits} />
        </aside>

        <main className="center">
          <Conversation events={state.events} threads={state.threads} liveText={state.liveText} send={send} />
          <WorkBar
            status={state.connected ? state.status : 'disconnected'}
            since={state.workingSince}
            tasks={state.tasks}
            events={state.events}
          />
          <Composer status={state.status} queue={state.queue} send={send} />
        </main>

        <div className="rail-resizer" onMouseDown={startRailDrag} title="Drag to resize" />
        <aside className="right-rail" style={{ width: railW }}>
          <nav className="tabs">
            {(['goal', 'panels', 'reviews', 'agents', 'activity', 'context', 'logs'] as RightTab[]).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          {tab === 'goal' && <GoalPanel markdown={state.goalMarkdown} />}
          {tab === 'panels' && <PushedPanels panels={state.panels} />}
          {tab === 'reviews' && <ReviewsPanel />}
          {tab === 'agents' && <AgentsPanel events={state.events} />}
          {tab === 'activity' && <ActivityPanel events={state.events} />}
          {tab === 'logs' && <LogsPanel />}
          {tab === 'context' && (
            <ContextPanel
              events={state.events}
              contextTokens={state.contextTokens}
              costUsd={state.costUsd}
              send={send}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
