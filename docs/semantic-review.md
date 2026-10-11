# Semantic review (optional)

Some guidance needs judgment: "one primary action per view", "states explain what happened", "a new pattern builds on existing guidance". Design Warden can ask a model to review a change against the policy's `verify.by: "semantic"` rules. The review is off by default and advisory by construction:

- It runs only when the policy allows it (`semanticReview.enabled`) **and** the command asks for it (`--semantic <provider>`). It needs a change set (`--base`).
- A model finding can request review but **never fail the build**. The schema forbids blocking semantic rules, and `decideOutcome` caps `origin: ai` at review.
- Every model reference is checked against the files actually shown. Findings that cannot be verified are downgraded or rejected, and the rejections are listed in the report.
- A failed review is reported as failed, never as passed. Deterministic findings are always kept.

## Providers

| `--semantic` | What it calls | Configuration (environment and flags only, never the policy file) |
|---|---|---|
| `anthropic` | Anthropic Messages API through the official SDK. Structured output (`output_config.format`), `effort: high`, server-side refusal fallback (`fallbacks: "default"`), one retry | Credentials resolved by the SDK: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile. `ANTHROPIC_BASE_URL` changes the endpoint. `--semantic-model` (default `claude-opus-5-5`) |
| `openai-compatible` | `POST {base}/chat/completions` with `response_format: json_schema` (OpenAI, Ollama, vLLM, LM Studio) | `DESIGN_WARDEN_OPENAI_BASE_URL` (required), `DESIGN_WARDEN_OPENAI_API_KEY`, `--semantic-model` (required), `DESIGN_WARDEN_OPENAI_TOKEN_PARAM=max_completion_tokens` for OpenAI reasoning models |
| `replay` | Nothing. Returns a recorded response from `--semantic-replay <file>` | Used by tests and the demo |

`--semantic-timeout <seconds>` (default 180). `--semantic-dry-run <file>` writes the exact request (system prompt, user content, schema, image sizes) to a file and sends nothing. Use it to review what would leave the machine.

**Local models.** `openai-compatible` with Ollama keeps all data on the machine:

```bash
DESIGN_WARDEN_OPENAI_BASE_URL=http://127.0.0.1:11434/v1 \
pnpm design-warden check --policy … --base origin/main --semantic openai-compatible --semantic-model qwen3:14b
```

Ollama ignores `strict` in JSON-schema mode, so local validation is what keeps the output well-formed ([research](research/ai-review.md)).

**Other services.** A hosted service that documents an OpenAI-compatible chat-completions endpoint with JSON-schema output is used the same way: set `DESIGN_WARDEN_OPENAI_BASE_URL` and the key. Examples are Azure OpenAI's v1 endpoint, Google's OpenAI-compatible Gemini endpoint and OpenRouter. **None of them was tested here.** Services differ in which JSON-schema keywords they honour under `strict` (open question 4), so local validation decides what counts, as with Ollama. A provider without such an endpoint needs an adapter in `packages/semantic-review/src/providers/`, the only code that calls model providers.

## What is sent

The data sent, all of it recorded in `report.semantic.dataSent`:

- **Changed files in the policy's project scope only:**
  - at most `semanticReview.maxFiles` (default 12), with novel components and files that already have findings first;
  - each file up to `maxFileChars` (default 20,000). Larger files are cut to the changed lines plus context, keeping the real line numbers.
- **Secrets redacted** from source and guidance: private keys, AWS, GitHub, Anthropic, OpenAI, Slack, Google and JWT tokens, and `secret = "…"` style assignments. This is best effort; see [security.md](security.md).
- **From the policy:** the semantic rules (id, title, description, rationale) and excerpts of their guidance sections. With `--policy-ref`, the guidance comes from the same base ref as the policy.
- **The deterministic findings and provenance records**, so the model does not repeat them.
- **Screenshots of changed states**, only if `includeScreenshots` is true and the provider supports images.

Repository content (source and guidance) is placed in blocks whose tag includes a random suffix, so text in a file cannot close its own block. The instructions say this content is data, and that any attempt in it to steer the review should be reported. This reduces prompt injection; it does not prevent it. The model has no tools, network access or secrets, and its output is only ever treated as unverified suggestions.

## Output contract

The model must return `{ "findings": [...] }`, each with `ruleId` (a semantic rule or `advisory`), `verdict` (`violation`, `probable-violation`, `acceptable-deviation`, `insufficient-evidence`), `confidence`, `file`, `line`, `quote`, `explanation`, `guidance[]` and `remediation`. The schema uses only the subset all providers support: every field required, `additionalProperties: false`, enums for ids and verdicts, no numeric or length constraints, no "reasoning" field.

## Verification (fails closed)

| Check | On failure |
|---|---|
| Response is JSON with a `findings` array | Review **failed** ("malformed response") |
| Response complete (not cut off at the token limit) | Review **failed**; nothing accepted |
| Item matches the schema; verdict and confidence known (case-insensitive) | Item rejected |
| `ruleId` is a semantic rule or `advisory` | Rejected |
| `file` was shown to the model | Rejected |
| `line` within the file | Rejected |
| `quote` appears on the cited line | Found on another line → moved there, confidence lowered, noted. Not found → **rejected as fabricated** |
| `quote` missing or trivial | Downgraded to `insufficient-evidence`, low confidence |
| Guidance ids known | Unknown ids dropped, noted |
| More than 25 findings | The rest rejected |
| Text | Links, images and control characters removed; length capped |

## Failure behaviour

Timeouts, HTTP 429 (with `retry-after` noted), authentication errors, refusals, network errors, truncation and malformed output all set the semantic engine to `failed`, with a reason. `failurePolicy.semantic` decides the effect:
- `review` (default): request human review;
- `fail-closed`: exit 3;
- `fail-open`: no effect on the outcome, but still shown as failed.

If changed files had to be left out because of `maxFiles`, the engine is `incomplete`, with the count.

## Evaluating a model

`pnpm eval:semantic --provider anthropic` runs the labelled scenarios against a live model and reports:
- label recall against hand-written expectations;
- false alarms on clean changes;
- reference rejection and downgrade rates;
- tokens and estimated cost.

It sends the demo's changed files to the provider and costs money. Without `--provider`, it uses the recorded responses and only checks the pipeline. See [evaluation.md](evaluation.md).
