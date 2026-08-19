// The far-left icon rail — Clyde's primary navigation. Each icon is a workspace
// capability that opens one panel to its right; clicking the active icon
// collapses the panel (Design Vision §2). Badges communicate attention, not decoration.

export type Capability =
  | 'goal'
  | 'tasks'
  | 'git'
  | 'decisions'
  | 'reviews'
  | 'artifacts'
  | 'agents'
  | 'activity'
  | 'context'
  | 'logs';

export interface RailBadges {
  tasksInProgress: number;
  agentsRunning: number;
  dirtyFiles: number;
  /** Panels pushed/updated since the user last opened the artifacts capability. */
  artifactsNew: number;
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICONS: Record<Capability, JSX.Element> = {
  // Concentric target — the north star. First in the rail on purpose.
  goal: (
    <svg viewBox="0 0 20 20" {...S}>
      <circle cx="10" cy="10" r="6.75" />
      <circle cx="10" cy="10" r="3" />
      <path d="M10 10h.01" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 20 20" {...S}>
      <path d="M3.5 5.5l1.5 1.5 2.5-3" />
      <path d="M3.5 12.5l1.5 1.5 2.5-3" />
      <path d="M10.5 6h6M10.5 13h6" />
    </svg>
  ),
  git: (
    <svg viewBox="0 0 20 20" {...S}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="15" r="2" />
      <circle cx="14" cy="8" r="2" />
      <path d="M6 7v6M14 10c0 3-4 2.5-6 4" />
    </svg>
  ),
  decisions: (
    <svg viewBox="0 0 20 20" {...S}>
      <path d="M10 2.5l6 3.5v4.5c0 3.5-2.7 5.9-6 7-3.3-1.1-6-3.5-6-7V6z" />
      <path d="M7.5 9.8l1.8 1.8 3.4-3.6" />
    </svg>
  ),
  reviews: (
    <svg viewBox="0 0 20 20" {...S}>
      <rect x="4" y="3" width="12" height="14" rx="2" />
      <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" />
    </svg>
  ),
  // 2×2 tile grid — the pushed-panel registry (galleries, metrics, exhibits).
  artifacts: (
    <svg viewBox="0 0 20 20" {...S}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </svg>
  ),
  agents: (
    <svg viewBox="0 0 20 20" {...S}>
      <circle cx="10" cy="5" r="2.2" />
      <circle cx="5" cy="14.5" r="2.2" />
      <circle cx="15" cy="14.5" r="2.2" />
      <path d="M8.8 6.8L6 12.5M11.2 6.8L14 12.5" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 20 20" {...S}>
      <path d="M2.5 10h3l2-5 3.5 10 2-5h4.5" />
    </svg>
  ),
  context: (
    <svg viewBox="0 0 20 20" {...S}>
      <path d="M10 3a7 7 0 1 1-6.6 9.3" />
      <path d="M10 6.5V10l2.5 2" />
    </svg>
  ),
  logs: (
    <svg viewBox="0 0 20 20" {...S}>
      <path d="M4 5.5l3.5 3.5L4 12.5" />
      <path d="M10 14.5h6" />
    </svg>
  ),
};

/** Rail order tells the story of the loop (audit 2026-08-19): intent (Goal) →
 *  plan (Tasks) → execution (Git, Agents) → evidence (Artifacts) → judgment
 *  (Decisions, Reviews) — then a bottom-anchored system cluster (Activity,
 *  Context, Logs) for introspection. Key order below IS the render order. */
const LABELS: Record<Capability, string> = {
  goal: 'Goal',
  tasks: 'Tasks',
  git: 'Git timeline',
  agents: 'Agents',
  artifacts: 'Artifacts',
  decisions: 'Decisions',
  reviews: 'Reviews',
  activity: 'Activity',
  context: 'Context',
  logs: 'Logs',
};

export const CAPABILITIES = Object.keys(LABELS) as Capability[];
export const capabilityLabel = (c: Capability) => LABELS[c];

export function Rail({
  active,
  badges,
  onSelect,
}: {
  active: Capability | null;
  badges: RailBadges;
  onSelect: (c: Capability) => void;
}) {
  const badgeFor = (c: Capability): { n: number; tone: string } | null => {
    if (c === 'tasks' && badges.tasksInProgress) return { n: badges.tasksInProgress, tone: 'warn' };
    if (c === 'agents' && badges.agentsRunning) return { n: badges.agentsRunning, tone: 'accent' };
    if (c === 'git' && badges.dirtyFiles) return { n: badges.dirtyFiles, tone: 'dim' };
    // Amber = attention: the agent pushed/updated panels you haven't looked at.
    if (c === 'artifacts' && badges.artifactsNew) return { n: badges.artifactsNew, tone: 'warn' };
    return null;
  };
  return (
    <nav className="rail">
      {CAPABILITIES.map((c) => {
        const b = badgeFor(c);
        return (
          <button
            key={c}
            className={`rail-btn${active === c ? ' active' : ''}${c === 'activity' ? ' rail-bottom' : ''}`}
            title={LABELS[c]}
            aria-label={LABELS[c]}
            onClick={() => onSelect(c)}
          >
            {ICONS[c]}
            {b && <span className={`rail-badge rail-badge-${b.tone}`}>{b.n > 9 ? '9+' : b.n}</span>}
          </button>
        );
      })}
    </nav>
  );
}
