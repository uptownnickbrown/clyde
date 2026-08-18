import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** All markdown in the app renders through this so GFM (tables, strikethrough,
 *  task lists, autolinks) works everywhere — SCOPE.md's risk table included. */
export function Md({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>;
}
