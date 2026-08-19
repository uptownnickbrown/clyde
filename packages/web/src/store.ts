import { useEffect, useReducer, useRef } from 'react';
import type {
  ClientMessage,
  CommitInfo,
  Exhibit,
  GitStatus,
  PanelSpec,
  QueuedItem,
  ServerMessage,
  SessionEvent,
  Snapshot,
  TaskItem,
  Thread,
} from '@clyde/shared';

/** One /btw aside, in memory only. Asides are answered by an ephemeral read-only
 *  observer and never enter the event log, so they live here and nowhere else —
 *  a reload drops them by design (they are questions, not record). */
export interface AsideCard {
  asideId: string;
  question: string;
  model: string;
  startedAt: string;
  /** Set once the observer answers (markdown) or fails. */
  answer?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
  done: boolean;
}

export interface UIState {
  connected: boolean;
  projectName: string;
  goalMarkdown: string | null;
  events: SessionEvent[];
  threads: Thread[];
  queue: QueuedItem[];
  panels: PanelSpec[];
  /** Blocking exhibits with live status — seeded from the snapshot (the server owns
   *  pending-ness: only it knows which blocked calls are still held), then updated
   *  by exhibit / exhibit_settled events. */
  exhibits: Exhibit[];
  tasks: TaskItem[];
  commits: CommitInfo[];
  status: string;
  /** In-flight streamed text per turn, cleared as final messages land. */
  liveText: Record<string, string>;
  contextTokens: number | null;
  costUsd: number | null;
  /** When the current working stretch began (drives the work-bar timer). */
  workingSince: string | null;
  gitStatus: GitStatus | null;
  model: string | null;
  effort: string | null;
  /** Model the "implementer" subagent type runs on (#32). */
  subagentModel: string | null;
  /** Live /btw asides, oldest first. Transient: never restored on reconnect. */
  asides: AsideCard[];
}

const initial: UIState = {
  connected: false,
  projectName: '',
  goalMarkdown: null,
  events: [],
  threads: [],
  queue: [],
  panels: [],
  exhibits: [],
  tasks: [],
  commits: [],
  status: 'disconnected',
  liveText: {},
  contextTokens: null,
  costUsd: null,
  workingSince: null,
  gitStatus: null,
  model: null,
  effort: null,
  subagentModel: null,
  asides: [],
};

type Action =
  | { kind: 'hello'; snapshot: Snapshot }
  | { kind: 'server'; msg: ServerMessage }
  | { kind: 'dismiss_aside'; asideId: string }
  | { kind: 'disconnected' };

/** Nothing holds these open any more — see the turn_complete case. */
const expirePending = (exhibits: Exhibit[]): Exhibit[] =>
  exhibits.some((x) => x.status === 'pending')
    ? exhibits.map((x) => (x.status === 'pending' ? { ...x, status: 'expired' as const } : x))
    : exhibits;

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
    case 'exhibit':
      // A live exhibit event means the server just registered its resolver.
      return {
        ...next,
        exhibits: [
          ...state.exhibits.filter((x) => x.id !== event.exhibitId),
          {
            id: event.exhibitId,
            title: event.title,
            content: event.content,
            taskId: event.taskId,
            detail: event.detail,
            ts: event.ts,
            status: 'pending',
          },
        ],
      };
    case 'exhibit_settled':
      return {
        ...next,
        exhibits: state.exhibits.map((x) =>
          x.id === event.exhibitId
            ? { ...x, status: event.verdict, comment: event.comment, settledTs: event.ts }
            : x,
        ),
      };
    case 'commit':
      return { ...next, commits: [event.commit, ...state.commits] };
    case 'turn_complete': {
      const liveText = { ...state.liveText };
      delete liveText[event.turnId];
      // A blocking exhibit can only outlive its turn if the turn was interrupted or
      // aborted — the server drops those resolvers, so the card must stop offering
      // actions that would reach nobody. Same rule the question cards use.
      return { ...next, liveText, exhibits: expirePending(state.exhibits) };
    }
    case 'session_started':
      return { ...next, exhibits: expirePending(state.exhibits) };
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
        exhibits: s.exhibits ?? [],
        tasks: s.tasks,
        commits: s.commits,
        status: s.status,
        contextTokens: usage?.type === 'usage' ? (usage.contextTokens ?? null) : null,
        costUsd: cost?.type === 'usage' ? (cost.costUsd ?? null) : null,
        workingSince: s.status === 'working' && lastStatus ? lastStatus.ts : null,
        gitStatus: s.gitStatus ?? null,
        model: s.model ?? null,
        effort: s.effort ?? null,
        subagentModel: s.subagentModel ?? null,
        // Asides are client-side cards, not session state: a hello (reconnect,
        // new session, model rotation) must not sweep away answers the user is
        // still reading. Only a page reload drops them.
        asides: state.asides,
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
        case 'git_status':
          return { ...state, gitStatus: msg.status };
        case 'goal':
          return { ...state, goalMarkdown: msg.markdown };
        case 'aside_started':
          return {
            ...state,
            asides: [
              ...state.asides,
              { asideId: msg.asideId, question: msg.question, model: msg.model, startedAt: msg.ts, done: false },
            ],
          };
        case 'aside_result':
          return {
            ...state,
            asides: state.asides.map((a) =>
              a.asideId === msg.asideId
                ? {
                    ...a,
                    done: true,
                    answer: msg.text,
                    error: msg.error,
                    costUsd: msg.costUsd,
                    durationMs: msg.durationMs,
                    model: msg.model,
                  }
                : a,
            ),
          };
        default:
          return state;
      }
    }
    case 'dismiss_aside':
      return { ...state, asides: state.asides.filter((a) => a.asideId !== action.asideId) };
    case 'disconnected':
      // The aside result rides the socket that just died — a card left spinning
      // would wait forever, so say what happened instead.
      return {
        ...state,
        connected: false,
        status: 'disconnected',
        asides: state.asides.map((a) =>
          a.done ? a : { ...a, done: true, error: 'lost the connection before the observer answered' },
        ),
      };
  }
}

export function useClyde(): {
  state: UIState;
  send: (msg: ClientMessage) => void;
  dismissAside: (asideId: string) => void;
} {
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
  const dismissAside = (asideId: string) => dispatch({ kind: 'dismiss_aside', asideId });
  return { state, send, dismissAside };
}
