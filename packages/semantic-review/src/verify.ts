import type { Confidence, FindingDraft, SemanticSummary, Verdict } from '@design-warden/core';
import { z } from 'zod';

const VERDICTS = ['violation', 'probable-violation', 'acceptable-deviation', 'insufficient-evidence'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

/**
 * Response schema in the subset every supported provider accepts: all fields required,
 * additionalProperties false, enums, no numeric or length constraints, no "reasoning" field
 * (docs/research/ai-review.md). Everything is re-validated locally regardless.
 */
export function responseJsonSchema(ruleIds: string[], guidanceIds: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ruleId', 'verdict', 'confidence', 'file', 'line', 'quote', 'explanation', 'guidance', 'remediation'],
          properties: {
            ruleId: { type: 'string', enum: [...ruleIds, 'advisory'] },
            verdict: { type: 'string', enum: [...VERDICTS] },
            confidence: { type: 'string', enum: [...CONFIDENCES] },
            file: { type: 'string', description: 'Path of a file shown in the review, or "" if the finding is not about one file.' },
            line: { type: 'integer', description: 'Line number from the numbered listing; 0 when file is "".' },
            quote: { type: 'string', description: 'Exact text copied from the cited line.' },
            explanation: { type: 'string', description: 'At most 60 words.' },
            guidance: { type: 'array', items: guidanceIds.length ? { type: 'string', enum: guidanceIds } : { type: 'string' } },
            remediation: { type: 'string' },
          },
        },
      },
    },
  };
}

const rawFinding = z.object({
  ruleId: z.string(),
  verdict: z.string(),
  confidence: z.string(),
  file: z.string(),
  line: z.number().int(),
  quote: z.string(),
  explanation: z.string(),
  guidance: z.array(z.string()),
  remediation: z.string(),
});

export class MalformedResponseError extends Error {
  override name = 'MalformedResponseError';
}

export interface VerifyContext {
  semanticRules: Set<string>;
  guidanceIds: Set<string>;
  /** Files that were shown to the model, with their real lines. */
  files: Map<string, string[]>;
  maxFindings: number;
}

export interface Verified {
  drafts: FindingDraft[];
  accepted: number;
  downgraded: number;
  rejected: SemanticSummary['rejected'];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const LOWER_CONFIDENCE: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };

/** Model text is untrusted: plain text only, no links (they can exfiltrate data when rendered), bounded length. */
export function sanitize(text: string, max: number): string {
  const clean = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ') // one line: no control characters, escape sequences or line separators
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?|ftp|file|data|javascript):[^\s)"'<>]*/gi, '[link removed]')
    .replace(/\bwww\.[^\s)"'<>]+/gi, '[link removed]')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Turns raw model output into findings, failing closed: anything that cannot be
 * verified against the files actually shown is downgraded or rejected, never trusted.
 */
export function verifyResponse(text: string, ctx: VerifyContext): Verified {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MalformedResponseError('response is not valid JSON');
  }
  const top = z.object({ findings: z.array(z.unknown()) }).safeParse(json);
  if (!top.success) throw new MalformedResponseError('response has no "findings" array');

  const out: Verified = { drafts: [], accepted: 0, downgraded: 0, rejected: [] };
  for (const item of top.data.findings) {
    const parsed = rawFinding.safeParse(item);
    if (!parsed.success) {
      out.rejected.push({ reason: 'does not match the response schema' });
      continue;
    }
    const f = parsed.data;
    const ref = { ruleId: f.ruleId, file: f.file || undefined, line: f.line || undefined, message: sanitize(f.explanation, 200) };
    const reject = (reason: string) => out.rejected.push({ reason, ...ref });

    const verdict = f.verdict.trim().toLowerCase() as Verdict;
    let confidence = f.confidence.trim().toLowerCase() as Confidence;
    const ruleId = f.ruleId.trim().toLowerCase();
    if (!(VERDICTS as readonly string[]).includes(verdict)) { reject(`unknown verdict "${f.verdict}"`); continue; }
    if (!(CONFIDENCES as readonly string[]).includes(confidence)) { reject(`unknown confidence "${f.confidence}"`); continue; }
    if (ruleId !== 'advisory' && !ctx.semanticRules.has(ruleId)) { reject(`unknown or non-semantic rule "${f.ruleId}"`); continue; }
    if (out.accepted >= ctx.maxFindings) { reject('over the finding limit'); continue; }

    const notes: string[] = [];
    let finalVerdict: Verdict = verdict;
    let location: FindingDraft['location'];
    let snippet: string | undefined;
    if (f.file) {
      const lines = ctx.files.get(f.file);
      if (!lines) { reject('file was not part of the review'); continue; }
      if (f.line < 1 || f.line > lines.length) { reject(`line ${f.line} is outside the file (1-${lines.length})`); continue; }
      let line = f.line;
      const quote = norm(f.quote);
      if (quote.length < 4) {
        finalVerdict = 'insufficient-evidence';
        confidence = 'low';
        notes.push('no verifiable quote; downgraded to insufficient evidence');
      } else if (!norm(lines[line - 1]!).includes(quote)) {
        const found = nearestLineWith(lines, quote, line);
        if (!found) { reject('quoted text not found in the file (fabricated evidence)'); continue; }
        notes.push(`cited line corrected from ${line} to ${found}`);
        line = found;
        confidence = LOWER_CONFIDENCE[confidence];
      }
      location = { file: f.file, line };
      snippet = lines[line - 1]!.trim().slice(0, 240);
    } else if (f.line !== 0) {
      reject('line number given without a file');
      continue;
    }

    const guidance = f.guidance.filter((g) => ctx.guidanceIds.has(g));
    if (guidance.length !== f.guidance.length) notes.push('unknown guidance references removed');
    if (notes.length) out.downgraded++;
    out.accepted++;
    out.drafts.push({
      ruleId: ruleId === 'advisory' ? 'semantic/advisory' : ruleId,
      verdict: finalVerdict,
      confidence,
      origin: 'ai',
      engine: 'semantic',
      message: sanitize(f.explanation, 600),
      location,
      evidence: [
        ...(location && snippet !== undefined ? [{ kind: 'code' as const, file: location.file, line: location.line, snippet }] : []),
        ...notes.map((text) => ({ kind: 'note' as const, text: `Verification: ${text}.` })),
      ],
      remediation: sanitize(f.remediation, 400) || undefined,
      guidance,
    });
  }
  return out;
}

function nearestLineWith(lines: string[], quote: string, around: number): number | null {
  let best: number | null = null;
  lines.forEach((l, i) => {
    if (norm(l).includes(quote) && (best === null || Math.abs(i + 1 - around) < Math.abs(best - around))) best = i + 1;
  });
  return best;
}
