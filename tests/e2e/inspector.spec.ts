import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The inspector against its real local service (started by playwright.config.ts on port 4401).
 * Every run goes through the real harness and engines; nothing is mocked.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUN_TIMEOUT = 90_000;

test.use({ baseURL: 'http://127.0.0.1:4401' });

const result = (page: Page, outcome: string) => page.getByRole('heading', { name: new RegExp(`^Result\\s+${outcome}$`) });

async function startFromUi(page: Page, scenario: RegExp, semantic: 'Off' | 'Replay recorded model response') {
  await page.getByRole('button', { name: scenario }).click();
  await expect(page.getByLabel(/^Visual capture/)).not.toBeChecked();
  await page.getByRole('radio', { name: semantic, exact: true }).check();
  await page.getByRole('button', { name: 'Run scenario' }).click();
}

test('lists the seeded scenarios from the local API', async ({ page }) => {
  const scenarios = (await (await page.request.get('/api/scenarios')).json()) as unknown[];
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Design Warden Inspector' })).toBeVisible();
  const list = page.getByRole('navigation', { name: 'Scenarios' });
  await expect(list.getByRole('button')).toHaveCount(scenarios.length);
  await expect(list.getByRole('button', { name: /Hardcoded color/ })).toContainText('FAIL');
});

test('runs hardcoded-color: blocking finding with location, evidence and suggestion', async ({ page }) => {
  await page.goto('/');
  await startFromUi(page, /Hardcoded color/, 'Off');
  await expect(result(page, 'FAIL')).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(page.getByText('Matches expectations')).toBeVisible();
  await expect(page.getByText(/^Event log \(\d+ events\)$/)).toBeVisible();

  const finding = page.getByRole('article').filter({ hasText: 'color/semantic-tokens' });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText('src/pages/OverviewPage.css:3');
  await expect(finding).toContainText('color: #d93025;');
  await expect(finding).toContainText('Use var(--color-text-danger)');
  await expect(finding).toContainText('Deterministic');
  await expect(finding).toContainText('Confirmed');
});

test('replays agent-evasion: AI findings are advisory, fabricated ones are rejected, guidance opens', async ({ page }) => {
  await page.goto('/');
  await startFromUi(page, /Agent tries to evade/, 'Replay recorded model response');
  await expect(result(page, 'FAIL')).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(page.getByText('Matches expectations')).toBeVisible();

  const ai = page.getByRole('article').filter({ hasText: 'AI — advisory, never blocks' });
  await expect(ai).toHaveCount(1);
  await expect(ai).toContainText('semantic/advisory');
  await expect(ai).toContainText('INFO');

  const semantic = page.getByRole('region', { name: 'Semantic review' });
  await expect(semantic).toContainText('no network');
  await expect(semantic.getByRole('listitem').filter({ hasText: 'Reason' })).toHaveCount(2);
  await expect(semantic).toContainText('quoted text not found in the file (fabricated evidence)');
  await expect(semantic).toContainText('unknown or non-semantic rule "approve-all"');

  // Guidance loads from the API into a modal panel that Escape closes, returning focus.
  const link = page.getByRole('article').filter({ hasText: 'color/semantic-tokens' }).getByRole('button', { name: 'Color', exact: true });
  await link.click();
  const panel = page.getByRole('dialog', { name: 'Color' });
  await expect(panel.getByRole('heading', { name: 'Color', level: 4 })).toBeVisible();
  await expect(panel).toContainText('Every color MUST be a');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(link).toBeFocused();
});

test('opens a report file from the CLI and rejects files that are not reports', async ({ page }) => {
  // Pinned date: the demo's legacy exception expires on 2027-03-31, after which a full scan fails on purpose.
  const cli = spawnSync(process.execPath, ['packages/cli/src/bin.ts', 'check', '--policy', 'apps/demo/design-warden.policy.json', '--today', '2026-10-10', '--format', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const report = JSON.parse(cli.stdout) as { summary: { suppressed: number } };

  await page.goto('/');
  await page.getByRole('radio', { name: 'Open a report file' }).check();
  const input = page.getByLabel('Report file', { exact: true });

  await input.setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"reportVersion": 2, "findings": []}') });
  await expect(page.getByRole('alert')).toContainText('expected "reportVersion": 1, found 2');

  await input.setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(cli.stdout) });
  await expect(result(page, 'PASS')).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByText('Screenshots are not available in file mode').first()).toBeVisible();

  // The clean demo's only findings are suppressed: hidden until asked for.
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByLabel(/^Show suppressed and pre-existing/).check();
  await expect(page.getByRole('article').filter({ hasText: 'Suppressed' })).toHaveCount(report.summary.suppressed);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(390);
});

test('one run at a time: a 409 follows the active run; visual diffs open in the viewer', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /Shared design-token change/ }).click();

  // Another client starts a slow visual run first.
  const started = await page.request.post('/api/runs', { data: { scenarioId: 'token-change', visual: true, semantic: 'off' } });
  expect(started.status()).toBe(202);
  await page.getByRole('button', { name: 'Run scenario' }).click();
  await expect(page.getByText('Another run is already in progress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run scenario' })).toBeDisabled();

  await expect(result(page, 'REVIEW')).toBeVisible({ timeout: 200_000 });
  await expect(page.getByRole('button', { name: 'Run scenario' })).toBeEnabled();

  await page.getByRole('button', { name: /^Compare images/ }).first().click();
  const viewer = page.getByRole('dialog', { name: /^Visual change:/ });
  await expect(viewer.getByRole('img', { name: /^Diff:/ })).toBeVisible();
  // Region boxes are drawn only once the image has loaded and its natural size is known.
  await expect(viewer.locator('.shot__region').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
});
