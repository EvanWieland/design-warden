import fs from 'node:fs';
import {
  compareText,
  guidanceExcerpt,
  inScope,
  type ChangeSet,
  type EngineStatusKind,
  type FindingDraft,
  type LoadedPolicy,
  type ProvenanceRecord,
  type SemanticSummary,
} from '@design-warden/core';
import { buildPrompt, type PromptFile } from './prompt.ts';
import { ProviderError, type ReviewRequest, type SemanticProvider } from './provider.ts';
import { MalformedResponseError, verifyResponse } from './verify.ts';

export interface SemanticReviewInput {
  loaded: LoadedPolicy;
  provider: SemanticProvider;
  changes?: ChangeSet;
  /** Head content of a project file, or null if unreadable. */
  readFile: (path: string) => string | null;
  /** Guidance file content from a trusted source (the base ref when --policy-ref is used). */
  readGuidance: (path: string) => string | null;
  deterministic: FindingDraft[];
  provenance: ProvenanceRecord[];
  /** After-images of changed captures; at most MAX_SCREENSHOTS are read, and only when the policy allows. */
  screenshots?: { name: string; path: string }[];
  timeoutMs?: number;
  /** Write the exact request to this file and stop before sending anything. */
  dryRunFile?: string;
}

export interface SemanticReviewOutput {
  status: EngineStatusKind;
  reason?: string;
  drafts: FindingDraft[];
  summary: SemanticSummary;
}

const MAX_FINDINGS = 25;
const MAX_SCREENSHOTS = 3;

export async function runSemanticReview(input: SemanticReviewInput): Promise<SemanticReviewOutput> {
  const { policy } = input.loaded;
  const config = policy.semanticReview;
  const summary: SemanticSummary = {
    provider: input.provider.name,
    model: input.provider.model,
    endpoint: input.provider.endpoint,
    dataSent: { files: [], characters: 0, screenshots: 0, redactions: 0 },
    accepted: 0,
    downgraded: 0,
    rejected: [],
  };
  const done = (status: EngineStatusKind, reason?: string, drafts: FindingDraft[] = []): SemanticReviewOutput => ({ status, reason, drafts, summary });

  if (!config?.enabled) return done('skipped', 'semantic review is disabled in the policy');
  if (!input.changes) return done('skipped', 'semantic review needs a change set (use --base)');

  // Files the model may see: changed, in project scope, readable. Novel patterns and files with findings first.
  const priority = (p: string) =>
    (input.provenance.some((r) => r.file === p && r.classification !== 'established') ? 0 : 2) -
    (input.deterministic.some((d) => d.location?.file === p) ? 1 : 0);
  const candidates = input.changes.files
    .filter((f) => f.status !== 'deleted' && inScope(f.path, policy.project.include, policy.project.exclude))
    .sort((a, b) => priority(a.path) - priority(b.path) || compareText(a.path, b.path));
  const files: PromptFile[] = [];
  for (const c of candidates.slice(0, config.maxFiles)) {
    const text = input.readFile(c.path);
    if (text !== null) files.push({ path: c.path, text, changedLines: c.status === 'added' ? undefined : c.changedLines });
  }
  if (!files.length) return done('skipped', 'no changed files in scope to review');
  const omitted = candidates.length - files.length;

  const semanticRules = policy.rules.filter((r) => r.verify.by === 'semantic');
  const guidanceIds = [...new Set([...config.guidance, ...semanticRules.flatMap((r) => r.guidance)])];
  const guidance = guidanceIds.flatMap((id) => {
    const g = policy.guidance[id];
    const text = g?.path ? input.readGuidance(g.path) : null;
    return g && text ? [{ id, title: g.title, text: guidanceExcerpt(text, g.section) }] : [];
  });
  const images: ReviewRequest['images'] =
    config.includeScreenshots && input.provider.supportsImages
      ? (input.screenshots ?? []).slice(0, MAX_SCREENSHOTS).map((s) => ({ name: s.name, mediaType: 'image/png', base64: fs.readFileSync(s.path).toString('base64') }))
      : [];

  const built = buildPrompt({
    policy,
    semanticRules,
    files,
    deterministic: input.deterministic,
    provenance: input.provenance,
    guidance,
    images,
    maxFileChars: config.maxFileChars,
  });
  summary.dataSent = { files: files.map((f) => f.path), characters: built.characters, screenshots: images.length, redactions: built.redactions };

  if (input.dryRunFile) {
    const preview = { provider: input.provider.name, endpoint: input.provider.endpoint ?? null, model: input.provider.model, request: { ...built.request, images: images.map((i) => ({ name: i.name, bytes: i.base64.length })) } };
    fs.writeFileSync(input.dryRunFile, `${JSON.stringify(preview, null, 2)}\n`);
    summary.dryRun = true;
    return done('skipped', `dry run: request written to ${input.dryRunFile}; nothing was sent`);
  }

  let result;
  try {
    result = await input.provider.review(built.request, AbortSignal.timeout(input.timeoutMs ?? 180_000));
  } catch (err) {
    if (err instanceof ProviderError) return done('failed', `${err.kind}: ${err.message}`);
    if ((err as Error).name === 'TimeoutError') return done('failed', 'timeout: no response within the time limit');
    return done('failed', `unexpected provider error: ${(err as Error).message}`);
  }
  summary.model = result.model ?? summary.model;
  summary.usage = result.usage;
  if (result.truncated) return done('failed', 'the response was cut off at the output limit; no findings were accepted');

  try {
    const verified = verifyResponse(result.text, {
      semanticRules: new Set(semanticRules.map((r) => r.id)),
      guidanceIds: new Set(Object.keys(policy.guidance)),
      files: built.fileLines,
      maxFindings: MAX_FINDINGS,
    });
    Object.assign(summary, { accepted: verified.accepted, downgraded: verified.downgraded, rejected: verified.rejected });
    return omitted > 0
      ? done('incomplete', `${omitted} changed file(s) were not reviewed (maxFiles is ${config.maxFiles})`, verified.drafts)
      : done('completed', undefined, verified.drafts);
  } catch (err) {
    if (err instanceof MalformedResponseError) return done('failed', `malformed response: ${err.message}`);
    throw err;
  }
}

export { anthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic.ts';
export { openAiCompatibleProvider } from './providers/openai-compatible.ts';
export { replayProvider } from './providers/replay.ts';
export { ProviderError, type ProviderResult, type ReviewRequest, type SemanticProvider } from './provider.ts';
export { buildPrompt } from './prompt.ts';
export { verifyResponse, sanitize, responseJsonSchema, MalformedResponseError, type VerifyContext, type Verified } from './verify.ts';
