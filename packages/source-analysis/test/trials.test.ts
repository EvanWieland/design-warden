import { finalizeFindings, gitChangeSet, readFileAtCommit } from '@design-warden/core';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/index.ts';
import { features, importsOf, jsxUsages, makeComponentAt, makeDsMatcher } from '../src/jsx.ts';
import { parseFile } from '../src/parse.ts';
import { customProperties } from '../src/style-values.ts';
import { cleanup, commitAll, makeProject, TEST_POLICY, writeFiles } from './helpers.ts';

// Regressions found by running Design Warden on Excalidraw, VitePress and shadcn/ui (docs/PLAN.md, 2026-10-12).
afterAll(cleanup);

type Policy = typeof TEST_POLICY;
const withPolicy = (change: (p: Policy) => void): Policy => {
  const p = structuredClone(TEST_POLICY);
  change(p);
  return p;
};

async function run(files: Record<string, string>, rule?: string, policy: object = TEST_POLICY) {
  const { loaded } = makeProject(files, policy);
  const { drafts } = await analyzeSource({ loaded });
  return drafts.filter((d) => (!rule || d.ruleId === rule) && d.location?.file.startsWith('src/app/'));
}
const messages = (d: { message: string }[]) => d.map((x) => x.message);
const TAILWIND = { 'package.json': JSON.stringify({ devDependencies: { tailwindcss: '4.3.0' } }) };

describe('token sources', () => {
  it('reads tokens from an SCSS file with // comments', async () => {
    const policy = withPolicy((p) => void (p.tokens.sources = ['src/ds/theme.scss']));
    const d = await run(
      {
        'src/ds/theme.scss': '// Theme\n.app {\n  --color-text: #0f172a; // body text\n  --space-2: 8px;\n}\n',
        'src/app/a.css': '.a { color: var(--color-text); padding: var(--space-2); }\n.b { color: #0f172a; }\n',
      },
      undefined,
      policy,
    );
    expect(d.map((x) => [x.ruleId, x.suggestion])).toEqual([['color/no-literal', 'Use var(--color-text), which has exactly this value.']]);
  });

  it('takes the default value from :root, not from an earlier media query or theme selector', async () => {
    const tokens = '@media (min-width: 640px) { :root { --space-2: 10px; } }\n.theme-dense { --space-2: 6px; }\n:root { --space-2: 8px; --space-3: 12px; --space-4: 16px; --color-text: #0f172a; }\n';
    const d = await run({ 'src/ds/tokens.css': tokens, 'src/app/a.css': '.a { padding: 8px; }' }, 'spacing/scale');
    expect(messages(d)).toEqual(['`8px` in `padding` is hardcoded; the `--space-*` scale has a token for it.']);
  });

  it('reports a changed token in any theme block, not only its first definition', async () => {
    const base = ':root {\n  --color-text: #0f172a;\n}\n.dark {\n  --color-text: #f8fafc;\n}\n';
    const { root, loaded } = makeProject({ 'src/ds/tokens.css': base, 'src/app/a.css': '.a { color: var(--color-text); }\n' });
    commitAll(root);
    writeFiles(root, { 'src/ds/tokens.css': base.replace('#f8fafc', '#e2e8f0') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    expect(drafts.find((d) => d.ruleId === 'governance/shared')?.evidence).toEqual([
      { kind: 'token-change', token: '--color-text', selector: '.dark', before: '#f8fafc', after: '#e2e8f0', usages: ['src/app/a.css:1'] },
    ]);
  });

  // Architecture review: a token changed in two themes is one token, with its usages counted once.
  it('counts a token changed in several themes once', async () => {
    const base = ':root {\n  --color-text: #0f172a;\n}\n.dark {\n  --color-text: #f8fafc;\n}\n';
    const { root, loaded } = makeProject({ 'src/ds/tokens.css': base, 'src/app/a.css': '.a { color: var(--color-text); }\n' });
    commitAll(root);
    writeFiles(root, { 'src/ds/tokens.css': base.replace('#0f172a', '#111111').replace('#f8fafc', '#eeeeee') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    const shared = drafts.find((d) => d.ruleId === 'governance/shared');
    expect(shared?.message).toBe('1 design token(s) changed in src/ds/tokens.css, affecting 1 usage(s).');
    expect(shared?.evidence).toHaveLength(2); // the default and the .dark override, each with its values
  });
});

describe('token-usage: custom properties that are not tokens', () => {
  it('accepts a custom property defined anywhere in the project, in CSS or with style.setProperty', async () => {
    const d = await run(
      {
        'src/app/vars.css': '.card { --card-gap: 4px; }\n.cal { @apply p-3 [--cell-radius:var(--space-2)]; }',
        'src/app/switch.ts': "export const move = (el: HTMLElement, x: number) => el.style.setProperty('--switch-x', `${x}px`);",
        'src/app/a.css': '.a { gap: var(--card-gap); transform: translateX(var(--switch-x)); border-radius: var(--cell-radius); }',
      },
      'tokens/semantic',
    );
    expect(d).toEqual([]);
  });

  it('accepts an undefined property with a fallback (a hook), unless it is a likely typo of a token', async () => {
    // A fallback excuses a hook, not a name with a token prefix: `--space-card` claims to be a token that does not exist.
    const d = await run({ 'src/app/a.css': '.a { top: var(--layout-top-height, 0px); color: var(--color-actoin, #0f172a); padding: var(--space-card, 12px); }' }, 'tokens/semantic');
    expect(messages(d)).toEqual(['`--color-actoin` is not a defined design token.', '`--space-card` is not a defined design token.']);
  });

  it('accepts names a template literal defines at runtime (`--chart-${key}`), unless they are likely typos', async () => {
    // Only a name family (a prefix ending in "-") counts: `--c${k}` must not excuse every name that starts with --c.
    const chart = 'export const css = (key: string, color: string) => `--chart-${key}: ${color}; --c${key}: ${color};`;';
    const d = await run({ 'src/app/chart.ts': chart, 'src/app/Bar.tsx': 'export const Bar = () => <rect fill="var(--chart-desktop)" stroke="var(--color-actoin)" color="var(--cosmic)" />;' }, 'tokens/semantic');
    expect(messages(d)).toEqual(['`--color-actoin` is not a defined design token.', '`--cosmic` is not a defined design token.']);
  });

  // Detection audit: a runtime family inside a token prefix (`--color-${key}`, with --color- allowed) cannot vouch for a token.
  it('asks for review of a token-prefixed name that only a runtime family could define', async () => {
    const chart = 'export const css = (key: string, color: string) => `--color-${key}: ${color};`;';
    const d = await run({ 'src/app/chart.ts': chart, 'src/app/Bar.tsx': 'export const Bar = () => <rect fill="var(--color-desktop)" />;' }, 'tokens/semantic');
    expect(d.map((x) => [x.verdict, x.message])).toEqual([['insufficient-evidence', '`--color-desktop` is not a defined design token; a name built at runtime from `--color-` (src/app/chart.ts) may set it.']]);
  });

  it('accepts properties set by libraries when the rule lists their prefixes as external', async () => {
    const policy = withPolicy((p) => {
      const rule = p.rules.find((r) => r.id === 'tokens/semantic')!;
      rule.verify = { by: 'check', check: 'token-usage', options: { external: ['--radix-', '--available-height'] } } as typeof rule.verify;
    });
    const css = '.a { max-height: var(--radix-select-content-available-height); height: var(--available-height); width: var(--anchor-width); }';
    const d = await run({ 'src/app/a.css': css }, 'tokens/semantic', policy);
    expect(messages(d)).toEqual(['`--anchor-width` is not a defined design token.']);
  });

  it('still reports a property defined nowhere (the real bugs found in Excalidraw and VitePress)', async () => {
    const d = await run({ 'src/app/a.css': '.a { box-shadow: var(--color-shadow-3); }' }, 'tokens/semantic');
    expect(messages(d)).toEqual(['`--color-shadow-3` is not a defined design token.']);
  });

  it('compares themes through aliases: a theme that overrides a primitive changes the tokens built on it', async () => {
    const tokens = ':root { --palette-white: #fff; --palette-base: #fff; --color-bg: var(--palette-base); --color-surface: #fff; }\n.dark { --palette-base: #000; }\n';
    const d = await run({ 'src/ds/tokens.css': tokens, 'src/app/a.css': '.a { background: var(--palette-white); }' }, 'tokens/semantic');
    expect(d.map((x) => x.suggestion)).toEqual(['Use var(--color-surface), which resolves to the same value.']);
  });

  it('suggests only tokens with the same value in every theme, and words a single suggestion correctly', async () => {
    const tokens = ':root { --palette-white: #fff; --color-bg: #fff; --color-surface: #fff; }\n.dark { --color-bg: #000; }\n';
    const d = await run({ 'src/ds/tokens.css': tokens, 'src/app/a.css': '.a { background: var(--palette-white); }' }, 'tokens/semantic');
    expect(d.map((x) => x.suggestion)).toEqual(['Use var(--color-surface), which resolves to the same value.']);
  });
});

describe('security review fixes', () => {
  // A custom property set from script is defined (token-usage accepts it), so its literal value must be judged where it is set.
  it('reads literal values set from script: style.setProperty and style.x = …', async () => {
    const ts = "export const paint = (el: HTMLElement, c: string) => {\n  el.style.setProperty('--brand', '#39ff14');\n  el.style.setProperty('color', 'red');\n  el.style.backgroundColor = '#000';\n  el.style.padding = '13px';\n  el.style.setProperty('--accent', c);\n  el.style.color = c;\n};\n";
    const d = await run({ 'src/app/paint.ts': ts, 'src/app/a.css': '.a { color: var(--brand); }' });
    expect(d.map((x) => [x.ruleId, x.location?.line, x.message])).toEqual([
      ['color/no-literal', 2, 'Hardcoded color `#39ff14` in inline style `--brand` (custom property defined outside the token sources).'],
      ['color/no-literal', 3, 'Hardcoded color `red` in inline style `color`.'],
      ['color/no-literal', 4, 'Hardcoded color `#000` in inline style `background-color`.'],
      ['spacing/scale', 5, '`13px` in inline style `padding` is not on the `--space-*` scale.'],
    ]);
  });

  it('reads a long run of dashes in a template in linear time', () => {
    const f = parseFile('src/app/x.ts', `export const s = \`${'-'.repeat(100_000)};\`;`);
    const started = performance.now();
    customProperties([f]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('takes the last definition under the same selector, as CSS does', async () => {
    const d = await run({ 'src/ds/tokens.css': ':root { --space-2: 6px; --space-3: 12px; }\n:root { --space-2: 8px; }\n', 'src/app/a.css': '.a { padding: 8px; }' }, 'spacing/scale');
    expect(messages(d)).toEqual(['`8px` in `padding` is hardcoded; the `--space-*` scale has a token for it.']);
  });

  it('reports a token that a * rule overrides: it is a theme, not the default', async () => {
    const base = ':root {\n  --color-text: #0f172a;\n}\n';
    const { root, loaded } = makeProject({ 'src/ds/tokens.css': base, 'src/app/a.css': '.a { color: var(--color-text); }\n' });
    commitAll(root);
    writeFiles(root, { 'src/ds/tokens.css': `${base}* { --color-text: #ff00ff; }\n` });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    expect(drafts.find((d) => d.ruleId === 'governance/shared')?.evidence).toEqual([
      { kind: 'token-change', token: '--color-text', selector: '*', before: '#0f172a', after: '#ff00ff', usages: ['src/app/a.css:1'] }, // before: what * inherited
    ]);
  });
});

describe('no-hardcoded-color precision', () => {
  it('reads only color properties as colors: no review requests for computed dash arrays, widths and radii', async () => {
    const d = await run({ 'src/app/A.tsx': 'export const A = ({ c, r }: { c: number; r: number }) => <circle style={{ strokeDasharray: `${c} ${c}`, strokeWidth: c, borderRadius: r, borderColor: c }} />;' }, 'color/no-literal');
    expect(messages(d)).toEqual(['inline style `border-color` is computed from `c`; static analysis cannot confirm it resolves to a color token.']);
  });

  it('does not call a color function built from a token hardcoded', async () => {
    const d = await run(
      {
        'src/app/a.css': '.a { color: rgb(from var(--color-text) r g b / 50%); background: rgba(var(--color-text), 0.5); border-color: hsl(var(--color-text)); outline-color: rgb(0 0 0 / 50%); }',
        'src/app/B.tsx': "export const B = () => <div className='bg-[oklch(from_var(--color-action)_0.93_calc(c*0.4)_h)]' />;",
      },
      'color/no-literal',
    );
    expect(messages(d)).toEqual(['Hardcoded color `rgb(0 0 0 / 50%)` in `outline-color`.']);
  });

  it('does not read a named color passed to a component as a CSS color, but still reads hex values', async () => {
    const d = await run({ 'src/app/A.tsx': "import { Card } from '../ds';\nexport const A = () => <><Card color=\"lime\" /><Card color=\"#00ff00\" /><svg><path fill=\"red\" /></svg></>;" }, 'color/no-literal');
    expect(messages(d)).toEqual(['Hardcoded color `#00ff00` in prop `color`.', 'Hardcoded color `red` in prop `fill`.']);
  });

  it('ignores fills inside <clipPath> and <mask>, which only shape what is drawn', async () => {
    const svg = '<svg><defs><clipPath id="a"><path fill="#fff" /></clipPath><mask id="m"><rect fill="white" /></mask></defs><path fill="#123456" /></svg>';
    const d = await run({ 'src/app/Icon.tsx': `export const Icon = () => ${svg};` }, 'color/no-literal');
    expect(messages(d)).toEqual(['Hardcoded color `#123456` in prop `fill`.']);
  });

  it('reads custom property keys written with a type cast, and template keys with a static prefix', async () => {
    const d = await run({ 'src/app/A.tsx': "export const A = ({ k }: { k: string }) => <div style={{ ['--card-color' as any]: '#fff', [`--tone-${k}`]: '#000' }} />;" }, 'color/no-literal');
    expect(messages(d)).toEqual([
      'Hardcoded color `#fff` in inline style `--card-color` (custom property defined outside the token sources).',
      'Hardcoded color `#000` in inline style `--tone-*` (custom property defined outside the token sources).',
    ]);
  });

  it('reads both branches of a conditional style object', async () => {
    const d = await run({ 'src/app/A.tsx': "export const A = ({ busy }: { busy: boolean }) => <><i style={busy ? { visibility: 'hidden' } : {}} /><b style={busy ? { color: '#f00' } : undefined} /></>;" }, 'color/no-literal');
    expect(messages(d)).toEqual(['Hardcoded color `#f00` in inline style `color`.']);
  });

  it('reads a Sass keyword argument as an argument, not as a $variable', async () => {
    const d = await run({ 'src/app/a.scss': '@use "sass:color";\n.a { background: color.adjust(#ffffff, $alpha: -0.75); }\n' }, 'color/no-literal');
    expect(d.map((x) => [x.verdict, x.message])).toEqual([['violation', 'Hardcoded color `#ffffff` in `background`.']]);
  });

  it('does not suggest a token named for another role when no token for this role matches', async () => {
    const tokens = ':root { --color-danger-text: #000; --color-ink: #000; --color-bg: #fff; }\n';
    const d = await run({ 'src/ds/tokens.css': tokens, 'src/app/a.css': '.a { background: #000; }' }, 'color/no-literal');
    expect(d.map((x) => x.suggestion)).toEqual(['Use var(--color-ink), which has exactly this value.']);
  });
});

describe('element findings are scoped to the opening tag', () => {
  // VitePress: adding an attribute to a child made the untouched <a> around it a new, blocking finding.
  it('keeps a raw element pre-existing when only its children change', async () => {
    const base = 'export const A = () => (\n  <button\n    type="button">\n    <span>Save</span>\n  </button>\n);\n';
    const { root, loaded } = makeProject({ 'src/app/A.tsx': base });
    commitAll(root);
    writeFiles(root, { 'src/app/A.tsx': base.replace('<span>', '<span dir="auto">') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    const raw = finalizeFindings(drafts, { policy: loaded.policy, changes, scope: 'changed-lines', today: '2026-10-12' }).filter((f) => f.ruleId === 'components/raw');
    expect(raw.map((f) => [f.location?.line, f.location?.endLine, f.preexisting])).toEqual([[2, 3, true]]);
  });

  // Architecture review: a Svelte snippet inside a component is one of its props, so its lines belong to the element's span.
  it('keeps a Svelte snippet that passes a prop inside the span of its component', async () => {
    const base = '<script lang="ts">\n  import { DataTable } from \'../ds\';\n  let { rows } = $props();\n</script>\n\n<DataTable {rows} status="ready">\n  <p>Intro</p>\n  {#snippet emptyState()}<p>None</p>{/snippet}\n</DataTable>\n';
    const { root, loaded } = makeProject({ 'src/app/T.svelte': base });
    commitAll(root);
    writeFiles(root, { 'src/app/T.svelte': base.replace('emptyState()', 'empty()') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    const props = finalizeFindings(drafts, { policy: loaded.policy, changes, scope: 'changed-lines', today: '2026-10-12' }).filter((f) => f.ruleId === 'components/props');
    expect(props.map((f) => [f.message, f.preexisting ?? false])).toEqual([['<DataTable> is missing the required `emptyState` prop.', false]]);
  });

  it('spans the opening tag in Vue and Svelte templates too', async () => {
    const tpl = '<button\n  type="button">\n  <span>Save</span>\n</button>';
    const d = await run({ 'src/app/A.vue': `<template>\n  ${tpl}\n</template>\n`, 'src/app/B.svelte': `${tpl}\n` }, 'components/raw');
    expect(d.map((x) => [x.location?.file, x.location?.line, x.location?.endLine])).toEqual([
      ['src/app/A.vue', 2, 3],
      ['src/app/B.svelte', 1, 2],
    ]);
  });
});

describe('components', () => {
  it('does not report a raw element handed to a registry component that replaces raw elements (render prop, asChild)', async () => {
    // A trigger that adds behaviour but no styles (DialogTrigger, not in the registry) does not excuse its raw button.
    const tsx = "import { Button, Card, DialogTrigger } from '../ds';\nexport const A = () => <>\n  <Card render={<section />} />\n  <Button asChild><a href=\"/x\">Go</a></Button>\n  <Other render={<button />} />\n  <DialogTrigger asChild><button type=\"button\">Open</button></DialogTrigger>\n</>;\n";
    const policy = withPolicy((p) => {
      (p.components.find((c) => c.name === 'Card') as { replaces?: string[] }).replaces = ['section'];
      (p.components.find((c) => c.name === 'Button') as { replaces?: string[] }).replaces = ['button', 'a'];
    });
    const d = await run({ 'src/app/A.tsx': tsx }, 'components/raw', policy);
    expect(d.map((x) => x.location?.line)).toEqual([5, 6]);
  });

  it('does not report the child of a Vue as-child design-system component', async () => {
    const vue = "<script setup>\nimport { Button } from '../ds';\n</script>\n<template>\n  <Button as-child><a href=\"/x\">Go</a></Button>\n  <a href=\"/y\">Raw</a>\n</template>\n";
    const policy = withPolicy((p) => void ((p.components.find((c) => c.name === 'Button') as { replaces?: string[] }).replaces = ['button', 'a']));
    const d = await run({ 'src/app/A.vue': vue }, 'components/raw', policy);
    expect(d.map((x) => x.location?.line)).toEqual([6]);
  });

  it('counts a design-system component used through a same-file component, or a variant of it, as composition', async () => {
    const tsx = [
      "import { Badge, IconButton } from '../ds';",
      'function StatusPillInner() { return <Badge tone="info">x</Badge>; }',
      'export function StatusPill() { return <StatusPillInner />; }',
      'export function LinkButton() { return <IconButton />; }',
      'export function SubmitButton() { return <button />; }',
    ].join('\n');
    const d = await run({ 'src/app/A.tsx': tsx }, 'components/reuse');
    expect(d.map((x) => x.location?.line)).toEqual([5]);
  });

  it('resolves a design-system default import by its file, whatever its local name, and its members', async () => {
    const tsx = "import Btn from '../ds/Button';\nimport Crd from '../ds/Card';\nexport function ProfileCard() { return <Crd.Header><Btn variant=\"ghost\" /></Crd.Header>; }\n";
    const d = await run({ 'src/app/A.tsx': tsx });
    expect(d.filter((x) => x.ruleId !== 'patterns/provenance').map((x) => [x.ruleId, x.message])).toEqual([['components/props', '<Button variant="ghost"> is not an approved value.']]);
  });

  it('resolves a default-imported Vue component by its file', async () => {
    const vue = "<script setup>\nimport Btn from '../ds/Button.vue';\n</script>\n<template>\n  <Btn variant=\"ghost\" />\n</template>\n";
    const policy = withPolicy((p) => void (p.components.find((c) => c.name === 'Button')!.source = 'src/ds/Button.vue'));
    const d = await run({ 'src/ds/Button.vue': '<template><button><slot /></button></template>\n', 'src/app/A.vue': vue }, 'components/props', policy);
    expect(messages(d)).toEqual(['<Button variant="ghost"> is not an approved value.']);
  });
});

describe('Tailwind classes', () => {
  it('knows the palettes added in Tailwind 4.2 (taupe, mauve, olive, mist)', async () => {
    const d = await run({ ...TAILWIND, 'src/app/A.tsx': 'export const A = () => <p className="bg-taupe-500 text-mauve-700 border-olive-200 ring-mist-300" />;' }, 'tokens/semantic');
    expect(d).toHaveLength(4);
  });

  it('reads class strings under className keys of objects', async () => {
    const tsx = "export const A = () => <Toaster toastOptions={{ className: 'ml-[13px]' }} />;\nexport const config = { dotClassName: 'p-[13px]' };\n";
    const d = await run({ 'src/app/A.tsx': tsx }, 'spacing/scale');
    expect(d.map((x) => x.location?.line)).toEqual([1, 2]);
  });

  it('reads calc() written without spaces, as Tailwind does', async () => {
    const d = await run({ 'src/app/A.tsx': 'export const A = () => <p className="p-[calc(13px+2px)] m-[calc(100%-13px)]" />;' }, 'spacing/scale');
    expect(messages(d)).toEqual(['`13px` in class `p-[calc(13px+2px)]` is not on the `--space-*` scale.', '`2px` in class `p-[calc(13px+2px)]` is not on the `--space-*` scale.', '`13px` in class `m-[calc(100%-13px)]` is not on the `--space-*` scale.']);
  });
});

describe('spacing suggestions', () => {
  it('does not offer a "nearest step" twice or half the value', async () => {
    const d = await run({ 'src/ds/tokens.css': ':root { --space-1: 4px; }', 'src/app/a.css': '.a { padding: 8px; margin: 5px; }' }, 'spacing/scale');
    expect(d.map((x) => x.suggestion)).toEqual([undefined, 'Use var(--space-1) (4px), the nearest step.']);
  });
});

describe('pattern provenance features', () => {
  it('ignores inline SVG drawing and text-direction wrappers', () => {
    const f = parseFile('src/app/A.tsx', 'export const A = () => <div><svg><g><path /><circle /></g></svg><bdi>x</bdi><table /></div>;');
    expect([...features(jsxUsages(f, importsOf(f, makeDsMatcher([]), makeComponentAt([]))))]).toEqual(['html:table']);
  });
});

describe('detection audit fixes', () => {
  it('reads a named color passed to a third-party component or a motion element as a CSS color', async () => {
    const tsx = "import { Check } from 'lucide-react';\nimport { motion } from 'framer-motion';\nimport { Card } from '../ds';\nexport const A = () => <>\n  <Check color=\"green\" />\n  <motion.path stroke=\"red\" />\n  <Card color=\"lime\" />\n</>;\n";
    const d = await run({ 'src/app/A.tsx': tsx }, 'color/no-literal');
    expect(d.map((x) => [x.location?.line, x.message])).toEqual([
      [5, 'Hardcoded color `green` in prop `color`.'],
      [6, 'Hardcoded color `red` in prop `stroke`.'],
    ]);
  });

  it('reads every *-color property, vendor prefixes, shadows and filters, bgcolor and Svelte style props as colors', async () => {
    const css = '.a { --overlay-color: black; -webkit-tap-highlight-color: red; text-emphasis-color: red; -webkit-box-shadow: 0 0 0 1px red; filter: drop-shadow(0 0 2px red); }';
    const tsx = "export const A = () => <><i style={{ ['--glow-color' as string]: 'black' }} /><b className=\"[--brand-color:red] drop-shadow-[0_0_2px_red]\" /><table><tbody><tr><td bgcolor=\"#f0f0f0\" /></tr></tbody></table></>;";
    const svelte = "<script>\n  import Slider from './Slider.svelte';\n</script>\n<Slider --track-color=\"black\" />\n";
    const d = await run({ 'src/app/a.css': css, 'src/app/A.tsx': tsx, 'src/app/S.svelte': svelte }, 'color/no-literal');
    expect(d.map((x) => `${x.location?.file.split('/').pop()}: ${x.message}`)).toEqual([
      'A.tsx: Hardcoded color `black` in inline style `--glow-color` (custom property defined outside the token sources).',
      'A.tsx: Hardcoded color `red` in class `[--brand-color:red]` (custom property defined outside the token sources).',
      'A.tsx: Hardcoded color `red` in class `drop-shadow-[0_0_2px_red]`.',
      'A.tsx: Hardcoded color `#f0f0f0` in prop `bgcolor`.',
      'S.svelte: Hardcoded color `black` in inline style `--track-color` (custom property defined outside the token sources).',
      'a.css: Hardcoded color `black` in `--overlay-color` (custom property defined outside the token sources).',
      'a.css: Hardcoded color `red` in `-webkit-tap-highlight-color`.',
      'a.css: Hardcoded color `red` in `text-emphasis-color`.',
      'a.css: Hardcoded color `red` in `-webkit-box-shadow`.',
      'a.css: Hardcoded color `red` in `filter`.',
    ]);
  });

  it('excuses a color function only when a token supplies its origin or a color channel, not just its alpha', async () => {
    const css = '.a { color: rgba(0, 0, 0, var(--a)); background: rgb(0 0 0 / var(--a, 0.1)); border-color: rgb(from #f00 r g b / var(--a)); outline-color: rgba(var(--rgb), 0.5); caret-color: hsl(var(--h) 50% 40%); accent-color: color(display-p3 var(--r) 0 0); }';
    const d = await run({ 'src/app/a.css': css }, 'color/no-literal');
    expect(messages(d)).toEqual([
      'Hardcoded color `rgba(0, 0, 0, var(--a))` in `color`.',
      'Hardcoded color `rgb(0 0 0 / var(--a, 0.1))` in `background`.',
      'Hardcoded color `rgb(from #f00 r g b / var(--a))` in `border-color`.',
    ]);
  });

  it('keeps custom property names whole when spacing out math', async () => {
    const d = await run({ 'src/app/A.tsx': 'export const A = () => <p className="w-[calc(100%-var(--size-ctl-2-5))] p-[calc(var(--space-1-5)*2)]" />;' }, 'tokens/semantic');
    expect(messages(d)).toEqual(['`--size-ctl-2-5` is not a defined design token.', '`--space-1-5` is not a defined design token.']);
  });

  it('gives a token defined only in a theme no default value: no suggestion claims it', async () => {
    // .dark overrides a default token, so it is a theme, and the tokens only it defines have no default value.
    const tokens = ':root { --color-text: #0f172a; }\n.dark { --color-text: #f8fafc; --palette-violet: #8b5cf6; --color-glow: #8b5cf6; }\n';
    const d = await run({ 'src/ds/tokens.css': tokens, 'src/app/a.css': '.a { color: var(--palette-violet); }\n.b { color: #8b5cf6; }' });
    expect(d.map((x) => [x.ruleId, x.suggestion])).toEqual([
      ['color/no-literal', undefined],
      ['tokens/semantic', undefined],
    ]);
  });

  it('reads token names an SCSS source generates (`--space-#{$name}`) as a family', async () => {
    const policy = withPolicy((p) => void (p.tokens.sources = ['src/ds/theme.scss']));
    const scss = ':root {\n  @each $name, $v in (chip: 4px, card: 8px) {\n    --space-#{$name}: #{$v};\n  }\n  --color-text: #0f172a;\n}\n';
    const d = await run({ 'src/ds/theme.scss': scss, 'src/app/a.css': '.a { padding: var(--space-chip); color: var(--color-text); }' }, 'tokens/semantic', policy);
    expect(d).toEqual([]);
  });

  it('reads @property rules as custom property definitions', async () => {
    const css = "@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }\n.a { transform: rotate(var(--angle)); }";
    expect(await run({ 'src/app/a.css': css }, 'tokens/semantic')).toEqual([]);
  });

  it('resolves a default import written with the .js extension of the compiled file', async () => {
    const d = await run({ 'src/app/A.tsx': "import Btn from '../ds/Button.js';\nexport const A = () => <Btn variant=\"ghost\" />;\n" }, 'components/props');
    expect(messages(d)).toEqual(['<Button variant="ghost"> is not an approved value.']);
  });

  it('reports a used token whose every definition is removed, class-scoped themes included', async () => {
    const base = '.app {\n  --color-island: #fff;\n}\n.app.theme--dark {\n  --color-island: #000;\n}\n:root {\n  --color-text: #0f172a;\n}\n';
    const { root, loaded } = makeProject({ 'src/ds/tokens.css': base, 'src/app/a.css': '.a { background: var(--color-island); }\n' });
    commitAll(root);
    writeFiles(root, { 'src/ds/tokens.css': ':root {\n  --color-text: #0f172a;\n}\n' });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    expect(drafts.find((d) => d.ruleId === 'governance/shared')?.message).toBe('1 design token(s) changed in src/ds/tokens.css, affecting 1 usage(s). 1 usage(s) reference removed tokens and will break.');
  });

  it('reports a semantic token that a theme changes through an alias', async () => {
    const base = ':root {\n  --palette-bg: #fff;\n  --color-bg: var(--palette-bg);\n}\n.dark {\n  --palette-bg: #000;\n}\n';
    const { root, loaded } = makeProject({ 'src/ds/tokens.css': base, 'src/app/a.css': '.a { background: var(--color-bg); }\n' });
    commitAll(root);
    writeFiles(root, { 'src/ds/tokens.css': base.replace('#000', '#111') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    const tokenChanges = drafts.find((d) => d.ruleId === 'governance/shared')?.evidence?.filter((e) => e.kind === 'token-change');
    expect(tokenChanges?.map((e) => e.kind === 'token-change' && [e.token, e.selector, e.before, e.after, e.usages])).toEqual([
      ['--palette-bg', '.dark', '#000', '#111', []],
      ['--color-bg', '.dark', '#000', '#111', ['src/app/a.css:1']],
    ]);
  });

  it('keeps an invalid prop value on a Svelte component pre-existing when only its content changes', async () => {
    const base = "<script lang=\"ts\">\n  import { Button } from '../ds';\n</script>\n\n<Button variant=\"nope\">\n  Save\n</Button>\n";
    const { root, loaded } = makeProject({ 'src/app/B.svelte': base });
    commitAll(root);
    writeFiles(root, { 'src/app/B.svelte': base.replace('Save', 'Save all') });
    const changes = await gitChangeSet(root, 'main');
    const { drafts } = await analyzeSource({ loaded, changes, scope: 'changed-lines', readBase: (f) => readFileAtCommit(root, changes.base.sha, f) });
    const props = finalizeFindings(drafts, { policy: loaded.policy, changes, scope: 'changed-lines', today: '2026-10-12' }).filter((f) => f.ruleId === 'components/props');
    expect(props.map((f) => [f.message, f.preexisting])).toEqual([['<Button variant="nope"> is not an approved value.', true]]);
  });
});
