import { finalizeFindings, gitChangeSet, readFileAtCommit } from '@design-warden/core';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/index.ts';
import { treeEditDistance, treeSimilarity, type Tree } from '../src/jsx.ts';
import { cleanup, commitAll, makeProject, TEST_POLICY, TOKENS, writeFiles } from './helpers.ts';

afterAll(cleanup);

const ORDERS_PAGE = `import { Button, Card, DataTable, Badge } from '../ds';
export function OrdersPage() {
  return (
    <Card>
      <header><h1>Orders</h1><Button variant="primary">New</Button></header>
      <DataTable rows={[]} status="ready" emptyState={<p>None</p>} />
      <Badge tone="info">Live</Badge>
    </Card>
  );
}
`;

const policy = { ...TEST_POLICY, patterns: [{ id: 'filterable-list', name: 'Filterable list', reference: 'src/app/OrdersPage.tsx', description: 'list' }] };

async function scenario(changes: Record<string, string>) {
  const { root, loaded } = makeProject({ 'src/app/OrdersPage.tsx': ORDERS_PAGE, 'src/app/legacy.css': '.old {\n  color: #123456;\n}\n' }, policy);
  commitAll(root);
  writeFiles(root, changes);
  const changeSet = await gitChangeSet(root, 'main');
  const readBase = (f: string) => readFileAtCommit(root, changeSet.base.sha, f);
  const result = await analyzeSource({ loaded, changes: changeSet, scope: 'changed-lines', readBase });
  return { ...result, changeSet, loaded };
}

describe('pattern provenance', () => {
  it('classifies new components against reference patterns and existing components', async () => {
    const { provenance } = await scenario({
      'src/app/CustomersPage.tsx': ORDERS_PAGE.replace('OrdersPage', 'CustomersPage').replace('Orders', 'Customers'),
      'src/app/ActivityTimeline.tsx':
        "import { Card } from '../ds';\nexport function ActivityTimeline() {\n  return <Card><ol><li><time>09:00</time><h3>Shipped</h3></li></ol><figure /></Card>;\n}\n",
      'src/app/Tiny.tsx': 'export function Tiny() { return <span>x</span>; }\n',
    });
    const byName = Object.fromEntries(provenance.map((p) => [p.component, p]));
    expect(byName.CustomersPage).toMatchObject({ classification: 'established', nearest: { kind: 'pattern', id: 'filterable-list' } });
    expect(byName.ActivityTimeline?.classification).toBe('novel');
    expect(byName.Tiny?.classification).toBe('insufficient-evidence');
  });

  it('compares with reference patterns as they were before the change, so editing a reference cannot vouch for new code', async () => {
    const timeline = "import { Card } from '../ds';\nexport function ActivityTimeline() {\n  return <Card><ol><li><time>09:00</time><h3>Shipped</h3></li></ol><figure /></Card>;\n}\n";
    const { provenance } = await scenario({ 'src/app/OrdersPage.tsx': timeline.replace('ActivityTimeline', 'OrdersPage'), 'src/app/ActivityTimeline.tsx': timeline });
    expect(provenance.find((p) => p.component === 'ActivityTimeline')).toMatchObject({ classification: 'novel', nearest: { kind: 'pattern', id: 'filterable-list' } });
  });

  it('reports a structural change to an existing component as modified', async () => {
    const { provenance } = await scenario({ 'src/app/OrdersPage.tsx': ORDERS_PAGE.replace('<Badge tone="info">Live</Badge>', '<nav><a href="/x">x</a></nav>') });
    expect(provenance).toEqual([expect.objectContaining({ component: 'OrdersPage', classification: 'modified' })]);
  });
});

describe('tree edit distance (Zhang-Shasha)', () => {
  const t = (label: string, ...children: Tree[]): Tree => ({ label, children });
  it('counts inserts, deletes and relabels', () => {
    expect(treeEditDistance(t('f', t('a'), t('b')), t('f', t('a'), t('b')))).toBe(0);
    expect(treeEditDistance(t('f', t('a')), t('f', t('a'), t('b')))).toBe(1);
    expect(treeEditDistance(t('f', t('a')), t('f', t('x')))).toBe(1);
    // The classic example from Zhang and Shasha (1989): moving "c" above "d" costs two edits.
    expect(treeEditDistance(t('f', t('d', t('a'), t('c', t('b'))), t('e')), t('f', t('c', t('d', t('a'), t('b'))), t('e')))).toBe(2);
  });

  it('does not compare shapes over 300 nodes, where the distance gets expensive: composition decides alone', () => {
    const wide = (n: number, labels: string[]) => t('', ...Array.from({ length: n }, (_, i) => t(labels[i % labels.length]!)));
    expect(treeSimilarity(wide(300, ['a', 'b']), wide(300, ['c', 'd']))).toBe(0);
    expect(treeSimilarity(wide(301, ['a', 'b']), wide(301, ['c', 'd']))).toBe(1);
  });
});

describe('pattern provenance by tree shape', () => {
  it('reports a rearranged component as modified even when it renders the same kinds of elements', async () => {
    const moved = ORDERS_PAGE.replace('<Badge tone="info">Live</Badge>\n', '').replace('<Button variant="primary">New</Button>', '<Button variant="primary">New</Button><Badge tone="info">Live</Badge>');
    const { provenance } = await scenario({ 'src/app/OrdersPage.tsx': moved });
    expect(provenance).toEqual([expect.objectContaining({ component: 'OrdersPage', classification: 'modified' })]);
  });

  it('keeps a component established when the change only repeats an element or adds generic wrappers', async () => {
    const repeated = ORDERS_PAGE.replace('<Button variant="primary">New</Button>', '<div><Button variant="primary">New</Button><Button variant="secondary">Export</Button></div>');
    const { provenance } = await scenario({ 'src/app/OrdersPage.tsx': repeated });
    expect(provenance).toEqual([expect.objectContaining({ component: 'OrdersPage', classification: 'established' })]);
  });

  it('does not call a new layout established just because it uses the same components as a pattern', async () => {
    const inverted = `import { Button, Card, DataTable, Badge } from '../ds';
export function InvertedPage() {
  return (
    <DataTable rows={[]} status="ready" emptyState={<Card><header><Badge tone="info">Live</Badge><h1>Orders</h1></header><Button variant="primary">New</Button></Card>} />
  );
}
`;
    const { provenance } = await scenario({ 'src/app/InvertedPage.tsx': inverted });
    expect(provenance.find((p) => p.component === 'InvertedPage')?.classification).not.toBe('established');
  });
});

describe('shared-change', () => {
  it('reports token changes with before/after values and downstream usages', async () => {
    const { drafts } = await scenario({
      'src/ds/tokens.css': TOKENS.replace('--color-danger: #b91c1c;', '--color-danger: #dc2626;').replace('  --space-2: 8px;\n', ''),
      'src/app/alert.css': '.alert { color: var(--color-danger); padding: var(--space-2); }\n',
    });
    const shared = drafts.find((d) => d.ruleId === 'governance/shared');
    expect(shared?.message).toBe('2 design token(s) changed in src/ds/tokens.css, affecting 2 usage(s). 1 usage(s) reference removed tokens and will break.');
    expect(shared?.evidence).toEqual(
      expect.arrayContaining([
        { kind: 'token-change', token: '--color-danger', before: '#b91c1c', after: '#dc2626', usages: ['src/app/alert.css:1'] },
        { kind: 'token-change', token: '--space-2', before: '8px', after: null, usages: ['src/app/alert.css:1'] },
      ]),
    );
  });

  it('follows aliases: changing a primitive reports the semantic tokens built on it', async () => {
    const { drafts } = await scenario({
      'src/ds/tokens.css': TOKENS.replace('--palette-blue: #2563eb;', '--palette-blue: #7c3aed;'),
      'src/app/cta.css': '.cta { background: var(--color-action); }\n',
    });
    const shared = drafts.find((d) => d.ruleId === 'governance/shared');
    expect(shared?.evidence).toEqual([
      { kind: 'token-change', token: '--palette-blue', before: '#2563eb', after: '#7c3aed', usages: [] },
      { kind: 'token-change', token: '--color-action', before: '#2563eb', after: '#7c3aed', usages: ['src/app/cta.css:1'] },
    ]);
  });

  it('reports a changed design-system component with its usages', async () => {
    const { drafts } = await scenario({ 'src/ds/Button.tsx': DS_BUTTON_CHANGED });
    const shared = drafts.find((d) => d.ruleId === 'governance/shared');
    expect(shared?.message).toContain('Shared design-system file changed (Button); 1 usage(s)');
    expect(shared?.evidence).toContainEqual({ kind: 'usage', file: 'src/app/OrdersPage.tsx', line: 5, detail: '<Button>' });
  });
});

describe('change sets cannot be evaded (security review 2026-10-10)', () => {
  const blocking = async (changes: Record<string, string>) => {
    const { drafts, changeSet, loaded } = await scenario(changes);
    return finalizeFindings(drafts, { policy: loaded.policy, changes: changeSet, scope: 'changed-lines', today: '2026-10-10' }).filter((f) => f.outcome === 'fail');
  };

  it('sees files whose names contain spaces', async () => {
    const fails = await blocking({ 'src/app/legacy.css': '.old {\n  color: #123456;\n}\n', 'src/app/Order Details.css': '.d { color: #ff0000; }\n' });
    expect(fails.map((f) => f.location?.file)).toEqual(['src/app/Order Details.css']);
  });

  /** Commits `base`, applies `head`, and returns the blocking findings of the change. */
  const change = async (base: Record<string, string>, head: Record<string, string>) => {
    const { root, loaded } = makeProject(base);
    commitAll(root);
    writeFiles(root, head);
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines' });
    return { changes, fails: finalizeFindings(drafts, { policy: loaded.policy, changes, scope: 'changed-lines', today: '2026-10-10' }).filter((f) => f.outcome === 'fail') };
  };

  it('ignores a .gitattributes in the change that marks sources as binary', async () => {
    const { changes, fails } = await change(
      { 'src/app/a.css': '.a {\n  color: var(--color-text);\n}\n' },
      { '.gitattributes': '*.css -diff\n*.json binary\n', 'src/app/a.css': '.a {\n  color: #ff0000;\n}\n' },
    );
    expect(changes.files.find((f) => f.path === 'src/app/a.css')?.changedLines).toEqual([{ start: 2, end: 2 }]);
    expect(fails.map((f) => f.ruleId)).toEqual(['color/no-literal']);
  });

  it('keeps an edit to the inner line of a multi-line value in scope', async () => {
    const before = '.card {\n  box-shadow:\n    0 1px 2px var(--color-text),\n    0 0 0 1px var(--color-text);\n}\n';
    const { fails } = await change({ 'src/app/card.css': before }, { 'src/app/card.css': before.replace('0 0 0 1px var(--color-text)', '0 0 0 1px #e2e8f0') });
    expect(fails.map((f) => [f.ruleId, f.location?.line, f.location?.endLine])).toEqual([['color/no-literal', 2, 4]]);
  });
});

describe('change scoping', () => {
  it('marks findings outside the changed lines as pre-existing', async () => {
    const { drafts, changeSet, loaded } = await scenario({ 'src/app/legacy.css': '.old {\n  color: #123456;\n}\n.new {\n  color: #654321;\n}\n' });
    const findings = finalizeFindings(drafts, { policy: loaded.policy, changes: changeSet, scope: 'changed-lines', today: '2026-10-10' });
    const colors = findings.filter((f) => f.ruleId === 'color/no-literal');
    expect(colors.map((f) => [f.location?.line, f.preexisting ?? false, f.outcome])).toEqual([
      [5, false, 'fail'],
      [2, true, 'info'],
    ]);
  });

  it('only checks changed files when a change set is given', async () => {
    const { drafts } = await scenario({ 'src/app/new.css': '.n { color: var(--color-text); }\n' });
    expect(drafts.filter((d) => d.location?.file === 'src/app/legacy.css')).toEqual([]);
  });
});

const DS_BUTTON_CHANGED = `export function Button(props: { variant?: string; children?: unknown }) { return <button className="ds-button ds-button--rounded">{props.children as never}</button>; }`;

describe('shared-change with a DTCG token file', () => {
  it('reports changed values in a *.tokens.json source with their usages', async () => {
    const json = (brand: string) => JSON.stringify({ color: { $type: 'color', brand: { $value: brand } } });
    const dtcgPolicy = { ...TEST_POLICY, tokens: { sources: ['src/ds/design.tokens.json'], allowedPrefixes: ['--color-'] } };
    const { root, loaded } = makeProject({ 'src/ds/design.tokens.json': json('#2563eb'), 'src/app/a.css': '.a { color: var(--color-brand); }\n' }, dtcgPolicy);
    commitAll(root);
    writeFiles(root, { 'src/ds/design.tokens.json': json('#1d4ed8') });
    const changeSet = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes: changeSet, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changeSet.base.sha, f) });
    const shared = drafts.find((d) => d.ruleId === 'governance/shared');
    expect(shared?.message).toBe('1 design token(s) changed in src/ds/design.tokens.json, affecting 1 usage(s).');
    expect(shared?.evidence).toEqual([{ kind: 'token-change', token: '--color-brand', before: '#2563eb', after: '#1d4ed8', usages: ['src/app/a.css:1'] }]);
  });
});
