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
} from './components/Sidebars';

// Shell layout (Design Vision): stable top bar · icon rail · one capability panel ·
// conversation center · contextual right workbench. Panels resize and remember.

type WbTab = 'questions' | 'goal' | 'panels';

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
  const [wbTab, setWbTab] = useState<WbTab>(() => store.get('clyde.wbTab', 'goal') as WbTab);

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

  // Tasks currently delegated: dispatches naming a task whose result hasn't landed (R8).
  const { delegated, agentsRunning } = useMemo(() => {
    const resultIds = new Set(
      state.events.filter((e) => e.type === 'tool_result').map((e) => (e.type === 'tool_result' ? e.toolUseId : '')),
    );
    const open = state.events.filter((e) => e.type === 'dispatch' && !resultIds.has(e.toolUseId));
    return {
      delegated: new Set(open.map((e) => (e.type === 'dispatch' ? (e.description ?? '') : ''))),
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
          }}
          onSelect={selectCapability}
        />

        {leftOpen && (
          <>
            <aside className="left-panel" style={{ width: leftW }}>
              <header className="panel-head">{capabilityLabel(capability)}</header>
              <div className="panel-scroll">
                {capability === 'tasks' && <TasksPanel tasks={state.tasks} delegated={delegated} />}
                {capability === 'git' && <GitPanel commits={state.commits} />}
                {capability === 'decisions' && <DecisionsPanel />}
                {capability === 'reviews' && <ReviewsPanel />}
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
                {(['questions', 'goal', 'panels'] as WbTab[]).map((t) => (
                  <button
                    key={t}
                    className={wbTab === t ? 'active' : ''}
                    onClick={() => {
                      setWbTab(t);
                      store.set('clyde.wbTab', t);
                    }}
                  >
                    {t === 'questions' ? 'Questions' : t === 'goal' ? 'Goal' : 'Panels'}
                    {t === 'questions' && questions.pending && <span className="wb-attn" />}
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
                {wbTab === 'goal' && <GoalPanel markdown={state.goalMarkdown} />}
                {wbTab === 'panels' && <PushedPanels panels={state.panels} />}
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
