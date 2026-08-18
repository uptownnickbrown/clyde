import { useEffect, useReducer, useRef } from 'react';
import type {
  ClientMessage,
  CommitInfo,
  PanelSpec,
  QueuedItem,
  ServerMessage,
  SessionEvent,
  Snapshot,
  TaskItem,
  Thread,
} from '@clyde/shared';

export interface UIState {
  connected: boolean;
  projectName: string;
  goalMarkdown: string | null;
  events: SessionEvent[];
  threads: Thread[];
  queue: QueuedItem[];
  panels: PanelSpec[];
  tasks: TaskItem[];
  commits: CommitInfo[];
  status: string;
  /** In-flight streamed text per turn, cleared as final messages land. */
  liveText: Record<string, string>;
  contextTokens: number | null;
  costUsd: number | null;
  /** When the current working stretch began (drives the work-bar timer). */
  workingSince: string | null;
}

const initial: UIState = {
  connected: false,
  projectName: '',
  goalMarkdown: null,
  events: [],
  threads: [],
  queue: [],
  panels: [],
  tasks: [],
  commits: [],
  status: 'disconnected',
  liveText: {},
  contextTokens: null,
  costUsd: null,
  workingSince: null,
};

type Action =
  | { kind: 'hello'; snapshot: Snapshot }
  | { kind: 'server'; msg: ServerMessage }
  | { kind: 'disconnected' };

function applyEvent(state: UIState, event: SessionEvent): UIState {
  const next = { ...state, events: [...state.events, event] };
  switch (event.type) {
    case 'assistant_message':
      return { ...next, liveText: { ...state.liveText, [event.turnId]: '' } };
    case 'status':
      return {
        ...next,
        status: event.status,
        workingSince:
          event.status === 'working' ? (state.status === 'working' ? state.workingSince : event.ts) : null,
      };
    case 'usage':
      return {
        ...next,
        contextTokens: event.contextTokens ?? state.contextTokens,
        costUsd: event.costUsd ?? state.costUsd,
      };
    case 'compaction':
      // The old count is stale the moment the summary lands; the next turn's usage refreshes it.
      return { ...next, contextTokens: null };
    case 'tasks_updated':
      return { ...next, tasks: event.tasks };
    case 'panels_updated':
      return { ...next, panels: event.panels };
    case 'commit':
      return { ...next, commits: [event.commit, ...state.commits] };
    case 'turn_complete': {
      const liveText = { ...state.liveText };
      delete liveText[event.turnId];
      return { ...next, liveText };
    }
    default:
      return next;
  }
}

function reducer(state: UIState, action: Action): UIState {
  switch (action.kind) {
    case 'hello': {
      const s = action.snapshot;
      // Context size only counts usage since the last compaction; cost is session-cumulative.
      const lastCompact = s.events.reduce((acc, e, i) => (e.type === 'compaction' ? i : acc), -1);
      const usage = [...s.events.slice(lastCompact + 1)].reverse().find((e) => e.type === 'usage' && e.contextTokens);
      const cost = [...s.events].reverse().find((e) => e.type === 'usage' && e.costUsd != null);
      const lastStatus = [...s.events].reverse().find((e) => e.type === 'status');
      return {
        ...initial,
        connected: true,
        projectName: s.projectName,
        goalMarkdown: s.goalMarkdown,
        events: s.events,
        threads: s.threads,
        queue: s.queue,
        panels: s.panels,
        tasks: s.tasks,
        commits: s.commits,
        status: s.status,
        contextTokens: usage?.type === 'usage' ? (usage.contextTokens ?? null) : null,
        costUsd: cost?.type === 'usage' ? (cost.costUsd ?? null) : null,
        workingSince: s.status === 'working' && lastStatus ? lastStatus.ts : null,
      };
    }
    case 'server': {
      const msg = action.msg;
      switch (msg.type) {
        case 'event':
          return applyEvent(state, msg.event);
        case 'delta':
          return {
            ...state,
            liveText: { ...state.liveText, [msg.turnId]: (state.liveText[msg.turnId] ?? '') + msg.text },
          };
        case 'queue':
          return { ...state, queue: msg.items };
        case 'threads':
          return { ...state, threads: msg.threads };
        default:
          return state;
      }
    }
    case 'disconnected':
      return { ...state, connected: false, status: 'disconnected' };
  }
}

export function useClyde(): { state: UIState; send: (msg: ClientMessage) => void } {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'hello') dispatch({ kind: 'hello', snapshot: msg.snapshot });
        else dispatch({ kind: 'server', msg });
      };
      ws.onclose = () => {
        dispatch({ kind: 'disconnected' });
        if (!closed) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  const send = (msg: ClientMessage) => wsRef.current?.send(JSON.stringify(msg));
  return { state, send };
}
