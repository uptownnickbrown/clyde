import { useEffect, useState } from 'react';
import type { PanelContent } from '@clyde/shared';
import { Md } from './Md';

// One renderer per content kind, shared by both tenants of the vocabulary: durable
// pushed panels (left rail) and blocking exhibits (attention surface). The agent
// names a file/glob/URL; the server serves it — nothing is inlined in the event log.

export function PanelBody({ content }: { content: PanelContent }) {
  switch (content.kind) {
    case 'image-gallery':
      return <Gallery glob={content.glob} />;
    case 'markdown':
      return <FileMarkdown path={content.path} />;
    case 'metrics':
      return <Metrics path={content.path} />;
    case 'iframe':
      return <iframe src={content.url} title={content.url} className="panel-iframe" />;
  }
}

export function Gallery({ glob }: { glob: string }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/gallery?glob=${encodeURIComponent(glob)}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [glob]);
  return (
    <div className="gallery">
      {files.map((f) => (
        <a key={f} href={`/api/project-file?path=${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">
          <img src={`/api/project-file?path=${encodeURIComponent(f)}`} alt={f} />
        </a>
      ))}
      {files.length === 0 && <div className="empty">no matches for {glob}</div>}
    </div>
  );
}

export function FileMarkdown({ path }: { path: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    fetch(`/api/project-file?path=${encodeURIComponent(path)}`)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [path]);
  return <Md>{text}</Md>;
}

export function Metrics({ path }: { path: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch(`/api/project-file?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [path]);
  if (!data) return <div className="empty">no data</div>;
  return (
    <table className="metrics">
      <tbody>
        {Object.entries(data).map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
