import { useEffect, useState, type ReactNode } from 'react';
import type { GuidanceRef } from '@design-warden/core';
import { api, type Guidance } from './api.ts';
import { Alert, Dialog } from './ui.tsx';

/** Side panel that loads a guidance excerpt from the local API. */
export function GuidanceDialog({ guidance, onClose }: { guidance: GuidanceRef; onClose: () => void }) {
  const [state, setState] = useState<{ data?: Guidance; error?: string }>({});
  useEffect(() => {
    let current = true;
    api.guidance(guidance.id).then(
      (data) => current && setState({ data }),
      (err: Error) => current && setState({ error: err.message }),
    );
    return () => {
      current = false;
    };
  }, [guidance.id]);

  const source = state.data ?? guidance;
  return (
    <Dialog title={guidance.title} variant="side" onClose={onClose}>
      {source.path && (
        <p className="hint">
          Source <code>{source.path}{source.section ? ` › ${source.section}` : ''}</code>
        </p>
      )}
      {state.error ? (
        <Alert tone="danger">Could not load this guidance: {state.error}</Alert>
      ) : !state.data ? (
        <p role="status">Loading guidance…</p>
      ) : (
        <>
          {state.data.url && (
            <p className="hint">
              Linked page (shown as text, not opened): <code>{state.data.url}</code>
            </p>
          )}
          <Markdown text={state.data.text} />
        </>
      )}
    </Dialog>
  );
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'pre'; text: string; table: boolean };

/**
 * A deliberately tiny Markdown subset for repository text (untrusted): headings, paragraphs,
 * lists, code spans, bold, fenced code and tables (kept as preformatted text). Everything becomes
 * React text; no HTML is interpreted and no URL becomes a link.
 */
function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null; // the block the previous line belongs to
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      while (++i < lines.length && !lines[i]!.trimStart().startsWith('```')) body.push(lines[i]!);
      blocks.push({ kind: 'pre', text: body.join('\n'), table: false });
      open = null;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) open = null;
    else if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      open = null;
    } else if (line.trimStart().startsWith('|')) {
      if (open?.kind === 'pre' && open.table) open.text += `\n${line}`;
      else blocks.push((open = { kind: 'pre', text: line, table: true }));
    } else if (item) {
      const ordered = item[1] !== undefined;
      if (open?.kind === 'list' && open.ordered === ordered) open.items.push(item[2]!);
      else blocks.push((open = { kind: 'list', ordered, items: [item[2]!] }));
    } else if (open?.kind === 'list') open.items.push(`${open.items.pop()} ${line.trim()}`); // wrapped item
    else if (open?.kind === 'paragraph') open.text += ` ${line.trim()}`;
    else blocks.push((open = { kind: 'paragraph', text: line.trim() }));
  }
  return blocks;
}

/** Code spans and bold; every other character stays literal text. */
const inline = (text: string): ReactNode[] =>
  text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .map((part, i) => (i % 2 === 0 ? part : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <strong key={i}>{part.slice(2, -2)}</strong>));

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((b, i) => {
        if (b.kind === 'heading') {
          const H = `h${Math.min(6, b.level + 2)}` as 'h3'; // the panel title is the h2
          return <H key={i}>{inline(b.text)}</H>;
        }
        if (b.kind === 'paragraph') return <p key={i}>{inline(b.text)}</p>;
        if (b.kind === 'pre') return <pre key={i}>{b.text}</pre>;
        const List = b.ordered ? 'ol' : 'ul';
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
