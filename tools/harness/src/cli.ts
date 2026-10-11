import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderTerminal } from 'design-warden';
import { applyScenario, resetDemo } from './apply.ts';
import { runScenario, type SemanticMode } from './run.ts';
import { listScenarios, REPO_ROOT, WORK_DIR } from './scenarios.ts';

const USAGE = `pnpm scenario <command>
  list                                  List the seeded scenarios and their expected outcomes
  run <id|all> [--visual] [--semantic off|replay|anthropic]
                                        Run in an isolated git workspace and compare with the expectations
  apply <id>                            Copy a scenario into apps/demo (to see it in the running app)
  reset                                 Restore apps/demo to its clean state
  clean                                 Delete previous run workspaces and cached captures`;

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { visual: { type: 'boolean', default: false }, semantic: { type: 'string', default: 'off' }, help: { type: 'boolean', short: 'h', default: false } },
  });
  const [command, arg] = values.help ? [] : positionals;
  if (command === 'list') {
    for (const s of listScenarios()) console.log(`${String(s.number).padStart(2)}  ${s.id.padEnd(26)} ${s.expected.outcome.padEnd(7)} ${s.title}`);
  } else if (command === 'run' && arg) {
    const semantic = values.semantic as SemanticMode;
    if (!['off', 'replay', 'anthropic'].includes(semantic)) throw new Error('--semantic must be off, replay or anthropic');
    const ids = arg === 'all' ? listScenarios().map((s) => s.id) : [arg];
    let failures = 0;
    for (const id of ids) {
      const run = await runScenario(id, { visual: values.visual, semantic });
      if (ids.length === 1) {
        console.log(renderTerminal(run.report));
        console.log(`\nReport: ${path.relative(REPO_ROOT, path.join(run.runDir, 'report.json'))}`);
      }
      const ok = run.mismatches.length === 0;
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(26)} expected ${run.scenario.expected.outcome.padEnd(7)} got ${run.report.outcome}`);
      for (const m of run.mismatches) console.log(`       ${m}`);
    }
    process.exitCode = failures ? 1 : 0;
  } else if (command === 'apply' && arg) {
    const s = applyScenario(arg);
    console.log(`Applied "${s.scenario}" to apps/demo (added ${s.added.length}, modified ${s.modified.length} file(s)). Run "pnpm scenario reset" to undo.`);
  } else if (command === 'clean') {
    for (const d of ['runs', 'cache']) fs.rmSync(path.join(WORK_DIR, d), { recursive: true, force: true });
    console.log('Removed .design-warden/runs and .design-warden/cache.');
  } else if (command === 'reset') {
    const s = resetDemo();
    console.log(s ? `Reset apps/demo (removed scenario "${s.scenario}").` : 'apps/demo is already clean.');
  } else {
    console.log(USAGE);
    process.exitCode = command ? 2 : 0;
  }
} catch (err) {
  console.error(`scenario: ${(err as Error).message}`);
  if ((err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) console.error(USAGE);
  process.exitCode = 2;
}
