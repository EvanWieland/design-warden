import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const sources = (dir: string) => fs.globSync(`${dir}/**/*.ts`, { cwd: root }).map((f) => f.split(path.sep).join('/'));

describe('repository invariants', () => {
  // SECURITY.md claims the network boundary is auditable per package. Keep it true.
  it('only the semantic-review providers and the capture module touch the network', () => {
    const network = /\bfetch\(|from 'node:(?:http|https|net|tls|dgram)'|@anthropic-ai\/sdk|new WebSocket/;
    const offenders = ['packages/core/src', 'packages/source-analysis/src', 'packages/cli/src', 'packages/visual-analysis/src', 'tools/*/src']
      .flatMap(sources)
      .filter((f) => f !== 'packages/visual-analysis/src/capture.ts' && network.test(read(f)));
    expect(offenders).toEqual([]);
    const semantic = sources('packages/semantic-review/src').filter((f) => network.test(read(f)));
    expect(semantic.sort()).toEqual(['packages/semantic-review/src/providers/anthropic.ts', 'packages/semantic-review/src/providers/openai-compatible.ts']);
    // The inspector's loopback server (ADR 0010); its UI only calls that server.
    const inspector = sources('apps/inspector/server').filter((f) => !f.endsWith('.test.ts') && network.test(read(f)));
    expect(inspector).toEqual(['apps/inspector/server/app.ts']);
  });

  it('never executes a shell or evaluates code', () => {
    // execFile/execFileSync (no shell) are allowed; exec/execSync, shell: true, eval and new Function are not.
    const dangerous = /shell:\s*true|import\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s*'node:child_process'|\beval\(|new Function\(/;
    const offenders = ['packages', 'tools', 'apps/inspector/server'].flatMap(sources).filter((f) => !f.includes('/test/') && dangerous.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the starter policy example validates, its rule examples hold, and its project passes', async () => {
    const { main } = await import('../packages/cli/src/index.ts');
    const policy = path.join(root, 'examples/policy/design-warden.policy.json');
    const quiet = () => {};
    expect(await main(['policy', 'test', '--policy', policy], quiet, quiet)).toBe(0);
    expect(await main(['check', '--policy', policy], quiet, quiet)).toBe(0);
  });

  // Importing svelte/compiler costs about 400 ms; runs without .vue or .svelte files must not pay for it.
  it('loads the Vue and Svelte compilers only when such a file is parsed', () => {
    const eager = sources('packages/source-analysis/src').filter((f) => /^import (?!type )[^\n]*from '(?:@vue\/compiler-dom|svelte\/compiler)'/m.test(read(f)));
    expect(eager).toEqual([]);
  });

  it('ships the starter policy in the design-warden package exactly as the example', () => {
    for (const f of ['design-warden.policy.json', 'GUIDANCE.md']) expect(read(`packages/cli/starter/${f}`), f).toBe(read(`examples/policy/${f}`));
    expect(JSON.parse(read('examples/policy/design-warden.policy.json')).$schema).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@design-warden\/core@\d+\.\d+\/schema\/policy\.schema\.json$/);
  });

  it('the example GitHub workflow and the one this repository runs are identical', () => {
    expect(read('.github/workflows/design-warden.yml')).toBe(read('examples/github-actions/design-warden.yml'));
  });

  // Tags can be moved; a full commit SHA cannot. The comment keeps the version readable for updates.
  it('pins every GitHub Action, in the workflows and the docs, to a full commit SHA with its version in a comment', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/design-warden.yml', '.github/workflows/macos.yml', 'examples/github-actions/design-warden.yml', 'docs/ci-integration.md'];
    const unpinned = files.flatMap((f) =>
      read(f)
        .split('\n')
        .filter((line) => /^\s*(?:-\s+)?uses:/.test(line) && !/uses: [\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/.test(line))
        .map((line) => `${f}: ${line.trim()}`),
    );
    expect(unpinned).toEqual([]);
  });

  // `-latest` labels move to a new OS on GitHub's schedule (ubuntu-latest → 26.04 from 2026-10-19), changing CI underneath us.
  it('pins every runner image to an OS version, in the workflows and the docs', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/design-warden.yml', '.github/workflows/macos.yml', 'examples/github-actions/design-warden.yml', 'docs/ci-integration.md'];
    const floating = files.flatMap((f) => (read(f).match(/^.*runs-on:.*-latest.*$/gm) ?? []).map((line) => `${f}: ${line.trim()}`));
    expect(floating).toEqual([]);
  });

  // In a container job, `${{ runner.temp }}` and `${{ github.workspace }}` are host paths that do not exist inside the
  // container: upload-artifact then fell back to `/` and silently left the diff images out (PR #2, 2026-10-11).
  it('passes only container paths to the actions of the visual (container) job', () => {
    const visual = /^ {2}visual:\n([\s\S]*?)^ {2}\w+:$/m.exec(read('.github/workflows/design-warden.yml'))?.[1] ?? '';
    expect(visual).toContain('container:');
    expect(visual.match(/\$\{\{\s*(runner\.temp|github\.workspace)\s*\}\}/g)).toBeNull();
  });

  // Baselines are compared only within one environment, so the container must not move under a tag.
  it('runs visual capture in the Playwright container of the pinned npm version, pinned by digest', () => {
    const { dependencies } = JSON.parse(read('packages/visual-analysis/package.json')) as { dependencies: Record<string, string> };
    const containers = read('.github/workflows/design-warden.yml').match(/^\s*container: .*$/gm) ?? [];
    expect(containers.map((c) => c.trim().replace(/[0-9a-f]{64}/, '<digest>'))).toEqual([
      `container: mcr.microsoft.com/playwright:v${dependencies.playwright}-noble@sha256:<digest> # the tag for people, the digest for the runner`,
    ]);
  });
});
