# ADR 0008: Provider-agnostic semantic review with local verification

Status: Accepted, 2026-10-10

## Context

Some design guidance needs judgment: one primary action per view, whether a new pattern is justified, whether state copy is helpful. The brief requires an optional, pluggable reviewer that cannot fabricate references and fails visibly. Constraints from [ai-review.md](../research/ai-review.md):

- Provider structured-output support varies. Ollama silently ignores `strict`.
- Truncation can arrive as empty content.
- Enum casing is not guaranteed.
- Line numbers are unreliable unless lines are numbered.

## Decision

- **Contract.** `SemanticProvider { name, model, endpoint, supportsImages, review(request, signal) }` transports a prepared request and returns raw text. The orchestrator does all validation identically for every provider.
- **Providers:**
  - `anthropic`: official SDK, `client.beta.messages.stream`, `output_config.format` JSON schema, `effort: high`, server-side `fallbacks: "default"`, one SDK retry.
  - `openai-compatible`: a `node:http`/`node:https` POST to `/chat/completions` with `response_format: json_schema`. Covers OpenAI, Ollama, vLLM and LM Studio. (Amended 2026-10-12: it used `fetch`, whose 300 s headers timeout cut off slow local models whatever the caller's time limit. Redirects are not followed, so the key is never sent to another URL.)
  - `replay`: a recorded response, no network, used by tests and the demo.
- **Configuration.** Off unless `--semantic <provider>` is passed and `semanticReview.enabled` is true in the policy. Provider, model, endpoint and credentials come from CLI flags and environment, never from the policy file, so a pull request cannot redirect code or keys to another endpoint.
- **Input.** Only changed files in scope, capped by `maxFiles` and `maxFileChars`, prioritised by novel provenance and existing findings.
  - Files are redacted for common secret formats and shown with numbered lines.
  - Repository content (source and guidance) is fenced in blocks whose tag carries a random suffix, so the content cannot close its own block.
  - The model also gets the semantic rules, guidance excerpts, deterministic findings and provenance records.
  - `--semantic-dry-run <file>` writes the exact request and sends nothing.
- **Output schema.** The portable subset: everything required, `additionalProperties: false`, enums for rule ids, verdicts, confidence and guidance, no numeric or length constraints, no reasoning field.
- **Verification (fails closed).** Malformed JSON or a truncated response fails the engine. For each finding, rule and file must be ones shown, the line must be in range, and the quote must match the cited line. A quote found on another line moves the citation there with lower confidence. A missing quote downgrades to insufficient evidence. Unknown guidance ids are dropped. Text is sanitised (links and control characters removed) and the number of findings is capped. Rejections are listed in the report.
- **Errors.** Timeouts, 429s, auth failures, refusals and network errors become `failed` with a reason. The outcome follows `failurePolicy.semantic` (default `review`). Deterministic findings are always preserved.

## Consequences

- A model can add findings but never remove or override deterministic ones, and never blocks (ADR 0001).
- Prompt injection can at worst create review noise or be reported as an advisory finding. The model has no tools, no network and no secrets.
- Live-provider behaviour is tested only against local mock servers, using the real SDK request path. Real-model evaluation is opt-in (docs/evaluation.md).
