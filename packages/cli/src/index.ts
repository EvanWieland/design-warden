// Programmatic API, used by the inspector service and the scenario harness.
export { accessibilityCapture, analyze, ALL_CHECKS, UsageError, VERSION, type AnalyzeOptions, type ProgressEvent } from './analyze.ts';
export { main } from './main.ts';
export { renderMarkdown } from './reporters/markdown.ts';
export { renderSarif } from './reporters/sarif.ts';
export { renderGitlab } from './reporters/gitlab.ts';
export { renderTerminal } from './reporters/terminal.ts';
export { githubAnnotations } from './reporters/github.ts';
export { testPolicyExamples } from './policy-test.ts';
