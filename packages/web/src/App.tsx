import { useEffect, useMemo, useState } from 'react';
import { useClyde } from './store';
import { QuestionsPanel, deriveQuestions } from './components/Questions';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { WorkBar } from './components/WorkBar';
import { TopBar } from './components/TopBar';
import { Rail, capabilityLabel, type Capability } from './components/Rail';
import { DecisionsPanel } from './components/Decisions';
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
  deriveAgents,
} from './components/Sidebars';

// Shell layout (Design Vision): stable top bar · icon rail · one capability panel ·
// conversation center · right workbench. The workbench is the attention surface
// (DECISIONS 2026-08-18): it carries structured interaction that needs the user's
// eyes now — Questions today, review ceremonies and live exhibits soon. Durable
// reference state (Goal, Artifacts) lives in the left rail. One tab for now; the
// tab bar stays because more attention tenants are coming (no placeholder tabs).

type WbTab = 'questions';

const store = {
  get: (k: string, fallback: string) => localStorage.getItem(k) ?? fallback,
  set: (k: string, v: string) => localStorage.setItem(k, v),
};

export default function App() {
  const { state, send } = useClyde();
  const [capability, setCapability] = useState<Capability>(() => store.get('clyde.capability', 'tasks') as Capability);
  const [leftOpen, setLeftOpen] = useState(() => store.get('clyde.leftOpen', '1') === '1');
  const [leftW, setLeftW] = useState(() => Number(store.get('clyde.leftW', '300')) || 300);
  const [rightOpen, setRightOpen] = useState(() => store.get('clyde.rightOpen', '1') === '1');
  const [rightW, setRightW] = useState(() => Number(store.get('clyde.rightW', '340')) || 340);
  const [wbTab, setWbTab] = useState<WbTab>(() => {
    // Migration: 'goal'/'panels' moved to the left rail as capabilities — any
    // stored workbench default falls back to the one remaining tab.
    if (store.get('clyde.wbTab', 'questions') !== 'questions') store.set('clyde.wbTab', 'questions');
    return 'questions';
  });

  const drag = (apply: (clientX: number) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const dragLeft = drag((x) => {
    const w = Math.min(520, Math.max(230, x - 46));
    setLeftW(w);
    store.set('clyde.leftW', String(w));
  });
  const dragRight = drag((x) => {
    const w = Math.min(720, Math.max(250, window.innerWidth - x));
    setRightW(w);
    store.set('clyde.rightW', String(w));
  });

  const selectCapability = (c: Capability) => {
    if (c === capability && leftOpen) {
      setLeftOpen(false);
      store.set('clyde.leftOpen', '0');
      return;
    }
    setCapability(c);
    setLeftOpen(true);
    store.set('clyde.capability', c);
    store.set('clyde.leftOpen', '1');
  };

  // Tasks currently delegated: dispatches naming a task that are still running (R8),
  // per the one rule in deriveAgents — a background spawn ack is not completion;
  // dispatch_update (or a real synchronous tool_result) is.
  const { delegated, agentsRunning } = useMemo(() => {
    const open = deriveAgents(state.events).filter((a) => a.running);
    return {
      delegated: new Set(open.map((a) => a.dispatch.description ?? '')),
      agentsRunning: open.length,
    };
  }, [state.events]);

  const status = state.connected ? state.status : 'disconnected';

  // The workbench is the attention surface: a new pending question flips it open
  // onto the Questions tab (without persisting over the user's chosen default).
  const questions = useMemo(() => deriveQuestions(state.events), [state.events]);
  const pendingQuestionId = questions.pending?.questionId ?? null;
  useEffect(() => {
    if (!pendingQuestionId) return;
    setWbTab('questions');
    setRightOpen(true);
  }, [pendingQuestionId]);

  // Artifacts attention: amber count of panels_updated events the user hasn't
  // looked at. In-memory only — baselined at the first snapshot (history never
  // badges; the full log replays on every hello, so the baseline survives
  // reconnects), re-baselined when the log shrinks (new session), cleared while
  // the artifacts capability is open.
  const panelUpdates = useMemo(() => state.events.filter((e) => e.type === 'panels_updated').length, [state.events]);
  const [panelUpdatesSeen, setPanelUpdatesSeen] = useState<number | null>(null);
  useEffect(() => {
    if (!state.connected) return;
    if (panelUpdatesSeen === null || panelUpdates < panelUpdatesSeen || (leftOpen && capability === 'artifacts')) {
      setPanelUpdatesSeen(panelUpdates);
    }
  }, [state.connected, panelUpdates, panelUpdatesSeen, leftOpen, capability]);
  const artifactsNew = panelUpdatesSeen === null ? 0 : Math.max(0, panelUpdates - panelUpdatesSeen);

  return (
    <div className="app">
      <TopBar
        projectName={state.projectName}
        gitStatus={state.gitStatus}
        status={state.status}
        connected={state.connected}
        contextTokens={state.contextTokens}
        costUsd={state.costUsd}
        send={send}
        onContextClick={() => selectCapability('context')}
      />

      <div className="columns">
        <Rail
          active={leftOpen ? capability : null}
          badges={{
            tasksInProgress: state.tasks.filter((t) => t.status === 'in_progress').length,
            agentsRunning,
            dirtyFiles: state.gitStatus?.dirtyFiles ?? 0,
            artifactsNew,
          }}
          onSelect={selectCapability}
        />

        {leftOpen && (
          <>
            <aside className="left-panel" style={{ width: leftW }}>
              <header className="panel-head">{capabilityLabel(capability)}</header>
              <div className="panel-scroll">
                {capability === 'goal' && <GoalPanel markdown={state.goalMarkdown} />}
                {capability === 'tasks' && <TasksPanel tasks={state.tasks} delegated={delegated} />}
                {capability === 'git' && <GitPanel commits={state.commits} />}
                {capability === 'decisions' && <DecisionsPanel />}
                {capability === 'reviews' && <ReviewsPanel />}
                {capability === 'artifacts' && <PushedPanels panels={state.panels} />}
                {capability === 'agents' && <AgentsPanel events={state.events} />}
                {capability === 'activity' && <ActivityPanel events={state.events} />}
                {capability === 'context' && (
                  <ContextPanel
                    events={state.events}
                    contextTokens={state.contextTokens}
                    costUsd={state.costUsd}
                    status={state.status}
                    send={send}
                  />
                )}
                {capability === 'logs' && <LogsPanel />}
              </div>
            </aside>
            <div className="resizer" onMouseDown={dragLeft} title="Drag to resize" />
          </>
        )}

        <main className="center">
          <Conversation
            events={state.events}
            threads={state.threads}
            liveText={state.liveText}
            status={status}
            send={send}
          />
          <WorkBar status={status} since={state.workingSince} tasks={state.tasks} events={state.events} />
          <Composer status={state.status} queue={state.queue} model={state.model} send={send} />
        </main>

        {rightOpen ? (
          <>
            <div className="resizer" onMouseDown={dragRight} title="Drag to resize" />
            <aside className="right-panel" style={{ width: rightW }}>
              <nav className="wb-tabs">
                {(['questions'] as WbTab[]).map((t) => (
                  <button
                    key={t}
                    className={wbTab === t ? 'active' : ''}
                    onClick={() => {
                      setWbTab(t);
                      store.set('clyde.wbTab', t);
                    }}
                  >
                    Questions
                    {questions.pending && <span className="wb-attn" />}
                  </button>
                ))}
                <button
                  className="wb-collapse"
                  title="Collapse the workbench"
                  onClick={() => {
                    setRightOpen(false);
                    store.set('clyde.rightOpen', '0');
                  }}
                >
                  ⟩
                </button>
              </nav>
              <div className="panel-scroll">
                {wbTab === 'questions' && <QuestionsPanel events={state.events} send={send} />}
              </div>
            </aside>
          </>
        ) : (
          <button
            className="wb-expand"
            title="Open the workbench"
            onClick={() => {
              setRightOpen(true);
              store.set('clyde.rightOpen', '1');
            }}
          >
            ⟨
          </button>
        )}
      </div>
    </div>
  );
}
