import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ChangeSetError, exitCodeFor, EXIT_CODES, loadPolicyFile, PathError, policyJsonSchema, PolicyError, type ChangeScope } from '@design-warden/core';
import { anthropicProvider, openAiCompatibleProvider, replayProvider, type SemanticProvider } from '@design-warden/semantic-review';
import { VisualError } from '@design-warden/visual-analysis';
import { accessibilityCapture, ALL_CHECKS, analyze, UsageError, VERSION, type AnalyzeOptions } from './analyze.ts';
import { testPolicyExamples } from './policy-test.ts';
import { parseReport, parseSectionArg, renderComment, type CommentPart } from './reporters/comment.ts';
import { emitGithub } from './reporters/github.ts';
import { renderGitlab } from './reporters/gitlab.ts';
import { renderMarkdown } from './reporters/markdown.ts';
import { renderSarif } from './reporters/sarif.ts';
import { renderTerminal } from './reporters/terminal.ts';

const HELP = `design-warden ${VERSION} - verify frontend changes against a design policy

Usage:
  design-warden check [options]           Analyze the project (exit 0 pass/review, 1 fail, 2 usage, 3 engine error)
  design-warden capture [options]         Capture screenshots of the policy's routes and states
  design-warden policy validate|test|schema [--policy <file>]
  design-warden checks                    List the built-in checks
  design-warden comment [check=|visual=|semantic=]<report.json>...
                                          Render saved JSON reports as one pull-request comment (markdown)

check options:
  --policy <file>            Policy file (default: design-warden.policy.json)
  --policy-ref <git-ref>     Load the policy and guidance from this ref (recommended in CI: the base branch)
  --base <git-ref>           Compare with this ref; findings outside the change become pre-existing
  --base-dir <dir>           Compare with an older copy of the project in this directory (no git history needed)
  --scope <scope>            changed-lines (default with --base) | changed-files | all
  --visual-base <dir>        Capture directory of the base revision
  --visual-head <dir>        Capture directory of the head revision
  --artifacts <dir>          Where diff images go (default: .design-warden/artifacts)
  --semantic <provider>      anthropic | openai-compatible | replay (default: off)
  --semantic-model <id>      Model id (anthropic default: claude-opus-5-5)
  --semantic-replay <file>   Recorded response for the replay provider
  --semantic-dry-run <file>  Write the exact model request to a file and send nothing
  --semantic-timeout <s>     Seconds before the review is reported as failed (default 180)
  --format <format>          terminal (default) | json | markdown | github | sarif | gitlab
  --report <file>            Also write the JSON report to this file
  --fail-on <level>          fail (default) | review: also exit 1 when review is requested
  --only <engine>            visual | semantic: report and gate on that engine's findings only
                             (for CI jobs that leave the blocking source check to another job)
  --verbose                  List suppressed and pre-existing findings too
  --today <YYYY-MM-DD>       Evaluate exception expiry as of this date (reproducible runs)

capture options:
  --policy <file>            Policy file with a "visual" section
  --url <url> | --serve <dir>  A running app, or a built app directory to serve on 127.0.0.1
  --out <dir>                Output directory (required)

Environment (only used with --semantic):
  ANTHROPIC_API_KEY                        anthropic provider credentials (or an "ant auth login" profile)
  DESIGN_WARDEN_OPENAI_BASE_URL            e.g. http://127.0.0.1:11434/v1 (Ollama) or https://api.openai.com/v1
  DESIGN_WARDEN_OPENAI_API_KEY             optional bearer token
  DESIGN_WARDEN_OPENAI_TOKEN_PARAM         max_tokens (default) | max_completion_tokens
`;

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(`${s}\n`), err: (s: string) => void = (s) => process.stderr.write(`${s}\n`)): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      out(HELP);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      out(VERSION);
      return 0;
    }
    if (command === 'check') return await check(rest, out, err);
    if (command === 'capture') return await capture(rest, out);
    if (command === 'policy') return await policy(rest, out);
    if (command === 'comment') {
      if (rest.length === 0) throw new UsageError('usage: design-warden comment [check=|visual=|semantic=]<report.json>...');
      // A report that cannot be read becomes a placeholder section: stopping would leave the previous comment in place.
      const parts = rest.map(parseSectionArg).map(({ section, file }): CommentPart => {
        try {
          return { section, report: parseReport(readText(file), file) };
        } catch (e) {
          if (!(e instanceof UsageError)) throw e;
          err(`design-warden: ${e.message}`);
          return { section, unreadable: `The report could not be read: ${e.message}` };
        }
      });
      out(renderComment(parts));
      return 0;
    }
    if (command === 'checks') {
      for (const c of ALL_CHECKS) out(`${c.id.padEnd(22)} ${c.engine.padEnd(7)} ${c.description}`);
      return 0;
    }
    throw new UsageError(`unknown command "${command}". Run design-warden --help.`);
  } catch (e) {
    if (e instanceof UsageError || e instanceof PolicyError || e instanceof ChangeSetError || e instanceof PathError || e instanceof VisualError) {
      err(`design-warden: ${e.message}`);
      return EXIT_CODES.usage;
    }
    if ((e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      err(`design-warden: ${(e as Error).message}`);
      return EXIT_CODES.usage;
    }
    err(`design-warden: internal error: ${(e as Error).stack ?? e}`);
    return EXIT_CODES.error;
  }
}

async function check(argv: string[], out: (s: string) => void, err: (s: string) => void): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    strict: true,
    options: {
      policy: { type: 'string', default: 'design-warden.policy.json' },
      'policy-ref': { type: 'string' },
      base: { type: 'string' },
      'base-dir': { type: 'string' },
      scope: { type: 'string' },
      'visual-base': { type: 'string' },
      'visual-head': { type: 'string' },
      artifacts: { type: 'string', default: '.design-warden/artifacts' },
      semantic: { type: 'string' },
      'semantic-model': { type: 'string' },
      'semantic-replay': { type: 'string' },
      'semantic-dry-run': { type: 'string' },
      'semantic-timeout': { type: 'string', default: '180' },
      format: { type: 'string', default: 'terminal' },
      report: { type: 'string' },
      'fail-on': { type: 'string', default: 'fail' },
      only: { type: 'string' },
      today: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (v.help) return (out(HELP), 0);
  const format = oneOf(v.format, ['terminal', 'json', 'markdown', 'github', 'sarif', 'gitlab'], '--format');
  const failOn = oneOf(v['fail-on'], ['fail', 'review'], '--fail-on');
  const scope = v.scope === undefined ? undefined : (oneOf(v.scope, ['changed-lines', 'changed-files', 'all'], '--scope') as ChangeScope);
  if (Boolean(v['visual-base']) !== Boolean(v['visual-head'])) throw new UsageError('--visual-base and --visual-head must be given together');
  const only = v.only === undefined ? undefined : (oneOf(v.only, ['visual', 'semantic'], '--only') as 'visual' | 'semantic');
  if (only === 'visual' && !v['visual-base']) throw new UsageError('--only visual needs --visual-base and --visual-head');
  if (only === 'semantic' && !v.semantic) throw new UsageError('--only semantic needs --semantic <provider>');
  if (v.today && !/^\d{4}-\d{2}-\d{2}$/.test(v.today)) throw new UsageError('--today must be YYYY-MM-DD');
  const timeoutMs = Number(v['semantic-timeout']) * 1000;
  if (!(timeoutMs > 0)) throw new UsageError('--semantic-timeout must be a positive number of seconds');

  const opts: AnalyzeOptions = {
    policyPath: v.policy!,
    policyRef: v['policy-ref'],
    base: v.base,
    baseDir: v['base-dir'],
    scope,
    today: v.today,
    only,
    visual: v['visual-base'] ? { baseDir: v['visual-base'], headDir: v['visual-head']!, artifactDir: v.artifacts! } : undefined,
    semantic: v.semantic ? { provider: semanticProvider(v.semantic, v['semantic-model'], v['semantic-replay']), dryRunFile: v['semantic-dry-run'], timeoutMs } : undefined,
  };
  const report = await analyze(opts);
  report.exitCode = exitCodeFor(report.outcome, failOn as 'fail' | 'review');
  if (v.report) {
    fs.mkdirSync(path.dirname(path.resolve(v.report)), { recursive: true });
    fs.writeFileSync(v.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  const projectRoot = path.dirname(path.resolve(v.policy!));
  if (format === 'json') out(JSON.stringify(report, null, 2));
  else if (format === 'markdown') out(renderMarkdown(report));
  else if (format === 'sarif' || format === 'gitlab') {
    // Code scanning and Code Quality read missing results as fixed, so an engine failure writes nothing.
    // Also when the failure policy let the run pass: the result is incomplete either way.
    const broken = report.engines.find((e) => e.status === 'failed' || e.status === 'incomplete');
    const why = broken ? `the ${broken.engine} engine ${broken.status}${broken.reason ? `: ${broken.reason}` : ''}` : report.outcome === 'error' ? (report.outcomeReasons[0] ?? 'the analysis did not complete') : null;
    if (why) err(`No ${format === 'sarif' ? 'SARIF' : 'Code Quality report'} written: ${why}.`);
    else out(format === 'sarif' ? renderSarif(report) : renderGitlab(report));
  }
  else {
    if (format === 'github') {
      // The human report contains repository and model text. Between stop-commands markers with an
      // unguessable token, GitHub does not interpret any "::command::" inside it.
      const token = randomBytes(16).toString('hex');
      out(`::stop-commands::${token}`);
      out(renderTerminal(report, { verbose: v.verbose }));
      out(`::${token}::`);
      emitGithub(report, projectRoot, out);
    } else {
      out(renderTerminal(report, { verbose: v.verbose }));
    }
  }
  return report.exitCode;
}

function semanticProvider(name: string, model: string | undefined, replay: string | undefined): SemanticProvider {
  if (name === 'anthropic') return anthropicProvider({ model });
  if (name === 'replay') {
    if (!replay) throw new UsageError('--semantic replay needs --semantic-replay <file>');
    return replayProvider(replay);
  }
  if (name === 'openai-compatible') {
    const baseUrl = process.env.DESIGN_WARDEN_OPENAI_BASE_URL;
    if (!baseUrl) throw new UsageError('openai-compatible needs DESIGN_WARDEN_OPENAI_BASE_URL');
    if (!model) throw new UsageError('openai-compatible needs --semantic-model');
    const param = process.env.DESIGN_WARDEN_OPENAI_TOKEN_PARAM;
    return openAiCompatibleProvider({
      baseUrl,
      model,
      apiKey: process.env.DESIGN_WARDEN_OPENAI_API_KEY,
      tokenLimitParam: param === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    });
  }
  throw new UsageError(`unknown semantic provider "${name}" (anthropic | openai-compatible | replay)`);
}

async function capture(argv: string[], out: (s: string) => void): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    strict: true,
    options: { policy: { type: 'string', default: 'design-warden.policy.json' }, url: { type: 'string' }, serve: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (v.help) return (out(HELP), 0);
  if (!v.out) throw new UsageError('capture needs --out <dir>');
  if (Boolean(v.url) === Boolean(v.serve)) throw new UsageError('capture needs exactly one of --url or --serve');
  // Otherwise every state fails in the browser, which reads like an app that is down.
  if (v.serve && !fs.existsSync(path.join(v.serve, 'index.html'))) throw new UsageError(`--serve ${v.serve} has no index.html; build the app first, or pass the directory that contains it`);
  const loaded = loadPolicyFile(v.policy!, ALL_CHECKS);
  if (!loaded.policy.visual) throw new UsageError('the policy has no "visual" section');
  // Loaded lazily so commands that do not capture never load Playwright.
  const { captureAll, serveStatic } = await import('@design-warden/visual-analysis/capture');
  const server = v.serve ? await serveStatic(v.serve) : null;
  try {
    const manifest = await captureAll({
      baseUrl: server?.url ?? v.url!,
      visual: loaded.policy.visual,
      outDir: v.out,
      accessibility: accessibilityCapture(loaded),
      onProgress: (m) => out(`  ${m}`),
    });
    const failed = manifest.captures.filter((c) => c.error);
    out(`Captured ${manifest.captures.length - failed.length}/${manifest.captures.length} states into ${v.out}`);
    for (const f of failed) out(`  failed: ${f.id}: ${f.error}`);
    // Some failures are reported later as insufficient evidence; all of them failing means the app is not there.
    if (manifest.captures.length > 0 && failed.length === manifest.captures.length) {
      out('No state could be captured; is the app being served at that address?');
      return EXIT_CODES.error;
    }
    return 0;
  } finally {
    await server?.close();
  }
}

async function policy(argv: string[], out: (s: string) => void): Promise<number> {
  const [sub, ...rest] = argv;
  const { values: v } = parseArgs({ args: rest, strict: true, options: { policy: { type: 'string', default: 'design-warden.policy.json' }, help: { type: 'boolean', short: 'h' } } });
  if (v.help || sub === '--help' || sub === '-h') return (out(HELP), 0);
  if (sub === 'schema') {
    out(JSON.stringify(policyJsonSchema(), null, 2));
    return 0;
  }
  const loaded = loadPolicyFile(v.policy!, ALL_CHECKS);
  if (sub === 'validate') {
    const count = (c: string) => loaded.policy.rules.filter((r) => r.category === c).length;
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const { rules, components, patterns, exceptions, approvals } = loaded.policy;
    out(
      `Policy valid: ${loaded.policy.name} (rev ${loaded.policy.revision}) - ${n(rules.length, 'rule')} ` +
        `(${count('mandatory')} mandatory, ${count('required-pattern')} required-pattern, ${count('preferred')} preferred, ${count('advisory')} advisory), ` +
        `${n(components.length, 'component')}, ${n(patterns.length, 'pattern')}, ${n(exceptions.length, 'exception')}, ${n(approvals.length, 'approval')}`,
    );
    return 0;
  }
  if (sub === 'test') {
    const results = await testPolicyExamples(loaded);
    for (const r of results) out(`${r.ok ? 'ok  ' : 'FAIL'} ${r.ruleId} [expect ${r.expect}] ${r.file}: ${r.detail}`);
    const failed = results.filter((r) => !r.ok).length;
    out(`${results.length - failed}/${results.length} examples behave as declared`);
    return failed ? EXIT_CODES.fail : 0;
  }
  throw new UsageError('usage: design-warden policy validate|test|schema [--policy <file>]');
}

function oneOf(value: string | undefined, allowed: string[], flag: string): string {
  if (value === undefined || !allowed.includes(value)) throw new UsageError(`${flag} must be one of: ${allowed.join(', ')}`);
  return value;
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
}
