import { useEffect, useState } from 'react';
import type { SessionEvent, TaskItem } from '@clyde/shared';

/** Prominent agent-state strip above the composer: pulsing working indicator with
 *  a live elapsed timer and what the agent is working on (current task + last tool). */
export function WorkBar({
  status,
  since,
  tasks,
  events,
}: {
  status: string;
  since: string | null;
  tasks: TaskItem[];
  events: SessionEvent[];
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'working') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'working') {
    const secs = since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000)) : 0;
    const label = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    const task = tasks.find((t) => t.status === 'in_progress');
    const lastTool = [...events].reverse().find((e) => e.type === 'tool_call');
    return (
      <div className="workbar working">
        <span className="workbar-dot" />
        Clyde is working · {label}
        {task && <span className="workbar-detail">— {task.activeForm ?? task.subject}</span>}
        {lastTool?.type === 'tool_call' && <code className="workbar-tool">{lastTool.tool}</code>}
      </div>
    );
  }
  if (status === 'compacting') {
    return (
      <div className="workbar compacting">
        <span className="workbar-dot" />
        compacting context — summarizing older turns (can take a couple of minutes)…
      </div>
    );
  }
  if (status === 'idle') {
    return (
      <div className="workbar idle">
        <span className="workbar-dot" />
        idle — ready for your message
      </div>
    );
  }
  return (
    <div className="workbar disconnected">
      <span className="workbar-dot" />
      disconnected — reconnecting…
    </div>
  );
}
