import { useState } from 'react';
import { useClyde } from './store';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import {
  ActivityPanel,
  ContextPanel,
  GitPanel,
  GoalPanel,
  PushedPanels,
  TasksPanel,
} from './components/Sidebars';

type RightTab = 'goal' | 'panels' | 'activity' | 'context';

export default function App() {
  const { state, send } = useClyde();
  const [tab, setTab] = useState<RightTab>('goal');

  const pct = state.contextTokens ? Math.min(100, (state.contextTokens / 1_000_000) * 100) : 0;

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
          <TasksPanel tasks={state.tasks} />
          <GitPanel commits={state.commits} />
        </aside>

        <main className="center">
          <Conversation events={state.events} threads={state.threads} liveText={state.liveText} send={send} />
          <Composer status={state.status} queue={state.queue} send={send} />
        </main>

        <aside className="right-rail">
          <nav className="tabs">
            {(['goal', 'panels', 'activity', 'context'] as RightTab[]).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          {tab === 'goal' && <GoalPanel markdown={state.goalMarkdown} />}
          {tab === 'panels' && <PushedPanels panels={state.panels} />}
          {tab === 'activity' && <ActivityPanel events={state.events} />}
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
