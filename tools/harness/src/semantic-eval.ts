import { parseArgs } from 'node:util';
import { runScenario, type SemanticMode } from './run.ts';
import { listScenarios } from './scenarios.ts';

/**
 * Opt-in evaluation of the semantic reviewer against hand-written labels in scenario.json
 * (expected.semantic). Kept separate from the deterministic benchmark: a model is never scored
 * by its own output, and nothing here runs in the default test suite.
 *
 *   pnpm eval:semantic                       recorded responses (no network): checks the pipeline
 *   pnpm eval:semantic --provider anthropic  live model; needs credentials and costs money
 */
const { values } = parseArgs({ options: { provider: { type: 'string', default: 'replay' } } });
const mode = values.provider as SemanticMode;
if (mode !== 'replay' && mode !== 'anthropic') throw new Error('--provider must be replay or anthropic');
if (mode === 'anthropic') console.log('Live evaluation: changed source files of each scenario are sent to the Anthropic API.\n');

// Approximate list prices in USD per million tokens, from the provider's published pricing on 2026-09-25.
const PRICES: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-4-5': [1, 5] };

let labels = 0;
let hits = 0;
let falseAlarms = 0;
let accepted = 0;
let rejected = 0;
let downgraded = 0;
let failures = 0;
let tokensIn = 0;
let tokensOut = 0;
let cost = 0;
const rows: string[] = [];

for (const s of listScenarios().filter((x) => x.expected.semantic)) {
  const started = performance.now();
  const run = await runScenario(s.id, { semantic: mode });
  const ms = Math.round(performance.now() - started);
  const engine = run.report.engines.find((e) => e.engine === 'semantic');
  const sem = run.report.semantic;
  const ai = run.report.findings.filter((f) => f.origin === 'ai');
  const want = s.expected.semantic!;
  const got = want.mustInclude.filter((l) => ai.some((f) => f.ruleId === l.ruleId && l.verdicts.includes(f.verdict)));
  const alarms = want.noViolations ? ai.filter((f) => f.verdict === 'violation' || f.verdict === 'probable-violation').length : 0;
  labels += want.mustInclude.length;
  hits += got.length;
  falseAlarms += alarms;
  accepted += sem?.accepted ?? 0;
  rejected += sem?.rejected.length ?? 0;
  downgraded += sem?.downgraded ?? 0;
  if (engine?.status === 'failed') failures++;
  tokensIn += sem?.usage?.inputTokens ?? 0;
  tokensOut += sem?.usage?.outputTokens ?? 0;
  const price = sem?.model ? PRICES[sem.model] : undefined;
  if (price && sem?.usage) cost += ((sem.usage.inputTokens ?? 0) * price[0] + (sem.usage.outputTokens ?? 0) * price[1]) / 1e6;
  rows.push(
    `| ${s.id} | ${engine?.status ?? '-'} | ${got.length}/${want.mustInclude.length} | ${alarms} | ${sem?.accepted ?? 0} / ${sem?.downgraded ?? 0} / ${sem?.rejected.length ?? 0} | ${ms} ms |`,
  );
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
console.log(`Semantic evaluation (${mode})\n`);
console.log('| Scenario | Engine | Labels hit | False alarms on clean code | Accepted / downgraded / rejected | Wall time |');
console.log('|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log(`\nLabel recall: ${pct(hits, labels)} (${hits}/${labels}). False alarms: ${falseAlarms}. Engine failures: ${failures}.`);
console.log(`Reference rejection rate: ${pct(rejected, accepted + rejected)}; downgrade rate: ${pct(downgraded, accepted)}.`);
console.log(`Tokens: ${tokensIn} in / ${tokensOut} out${cost ? `; estimated cost $${cost.toFixed(3)}` : ''}.`);
if (mode === 'replay') console.log('\nReplay mode measures the pipeline with recorded responses, not model quality.');
