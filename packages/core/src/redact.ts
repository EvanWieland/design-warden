/**
 * Best-effort secret redaction for text that leaves the process (model prompts, logs).
 * Line structure is preserved so line numbers stay valid. This reduces accidental
 * exposure; it is not a guarantee, and docs/security.md says so.
 */
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, // OpenAI-style
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];
// key = "value" style assignments; only the value is replaced.
const ASSIGNMENT = /((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'`])([^"'`\n]{8,})(["'`])/gi;

export function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      redactions++;
      return m.replace(/[^\n]+/g, '[REDACTED]');
    });
  }
  out = out.replace(ASSIGNMENT, (_m, pre: string, _v: string, post: string) => {
    redactions++;
    return `${pre}[REDACTED]${post}`;
  });
  return { text: out, redactions };
}
