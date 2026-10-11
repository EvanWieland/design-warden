# AI-assisted review: structured outputs, evidence, injection

Last verified: 2026-10-10

**Tags:** `[Verified](link)` = read in the linked primary source. [Verified-local] = reproduced here (Ollama 0.35.0, ≤5 runs per condition; anecdotal). [Inferred] = my reasoning. [Unresolved] = open.

## Questions

1. Which structured-output request works on OpenAI-compatible providers, images included?
2. Which errors need an explicit failure state?
3. How do LLM reviewers get evidence wrong, and how do we verify them?
4. How far do injection defences go?
5. What should we borrow from existing tools?
6. How reliable is VLM visual critique?

## Findings

### Structured outputs

- **OpenAI.** The request is `response_format:{type:"json_schema",json_schema:{name,schema,strict:true}}`.
  - The schema root must be an object.
  - All fields must be required. An optional field is written as `["T","null"]`.
  - Every object needs `additionalProperties:false`.
  - Limits: 5,000 properties, 10 nesting levels, 1,000 enum values. `allOf`, `not` and `if` are errors.
  - Refusals come back in `message.refusal`. `finish_reason` is one of `stop`, `length`, `content_filter` or `tool_calls`.
  - The docs warn that forcing a schema "can result in hallucinations" when the input doesn't fit it.
  - `max_tokens` is deprecated in favour of `max_completion_tokens`, which also counts reasoning tokens.

  [Verified](https://developers.openai.com/api/docs/guides/structured-outputs) [Verified](https://developers.openai.com/api/reference/resources/chat)
- **Ollama** maps `json_schema.schema` to its native `format`, but silently drops `name` and `strict`. It accepts images only as base64. [Verified](https://github.com/ollama/ollama/blob/main/openai/openai.go)
- **vLLM** accepts the same shape, with images as http or base64. [Verified](https://docs.vllm.ai/en/latest/features/structured_outputs.html) [Verified](https://github.com/vllm-project/vllm/blob/main/docs/features/multimodal_inputs.md)
- **LM Studio** accepts the same shape; its own example sends `"strict":"true"` as a string. It warns that models under 7B often can't do this, and it accepts images. [Verified](https://lmstudio.ai/docs/developer/openai-compat/structured-output) [Verified](https://lmstudio.ai/llms.txt)
- **Local tests on Ollama** [Verified-local]:
  - `pattern` and `maxItems` were enforced. Asked for five fruits, the model returned two made-up codes that fit the pattern.
  - A base64 PNG with a schema worked; a remote image URL got a 400.
  - **`max_completion_tokens` is silently ignored**: I set it to 8 and got 141 tokens back.
  - A thinking model spent its whole budget on reasoning and returned `content:""` with `finish_reason:"length"`.
  - Truncated output is JSON that doesn't parse.
- **Anthropic:** `output_config.format`; no numeric or length constraints; at most 24 optional fields and 16 unions. **Enum casing is not guaranteed.** A field asking for reasoning can trigger a refusal. It can't be combined with Citations, and Opus/Sonnet 5.5 reject forced `tool_choice`. [Verified](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) [Verified](https://platform.claude.com/docs/en/api/errors)
- **Still open:** whether `strict` changes behaviour on vLLM or LM Studio. [Unresolved]

### Errors and limits

- **OpenAI** [Verified](https://developers.openai.com/api/docs/guides/rate-limits):
  - 429 and 503 (overloaded) responses may carry `Retry-After`. Treat it as a minimum and add jitter.
  - A 429 for quota or spend must not be retried.
  - Disable or count the SDK's own retries, or nested loops multiply requests.
- **Anthropic:** a 429 includes `retry-after`, except at the spend cap. Also handle 500, 504 (timeout) and 529 (overloaded). `max_tokens` and `model_context_window_exceeded` mean truncated output; a refusal arrives as HTTP 200. [Verified](https://platform.claude.com/docs/en/api/rate-limits) [Verified](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- **Local latency:** the cold first call took 45 s (model load plus 200 tokens); warm review calls took about 12 s. [Verified-local]

### Evidence grounding

- **SWR-Bench** [Verified](https://arxiv.org/abs/2509.01494), 1,000 PRs, half of them clean:
  - The best tool scored F1 18.73%, with precision of about 30–44%.
  - 48% of false positives came from missing context.
  - Feeding raw static-analysis output to the model gave the most false positives.
  - Combining several reviews raised F1 by up to 43.67%.
- **Industry results:**
  - At Beko, 73.8% of PR-Agent's comments were resolved, but PRs took longer to close (5h52m before, 8h20m after). [Verified](https://arxiv.org/abs/2412.18531)
  - At Uber, 75% of uReview's comments were rated useful. It got there through grading, category suppression and dedup ("precision over volume"). [Verified](https://www.uber.com/blog/ureview/)
- **Hallucinated packages:** 5.2% (commercial models) and 21.7% (open models) of suggested packages don't exist. [Verified](https://arxiv.org/abs/2406.10279)
- **Local review runs** [Verified-local]:
  - Without line numbers in the prompt, 15 of 15 findings cited the wrong line (off by 3 in every run I inspected) even though every quote was exact.
  - With numbered lines, all 15 quotes matched the cited line.
  - Enums stopped invented rule IDs, yet 5 of 15 findings (one per run) were wrong. Those I inspected misapplied a valid rule: a labelled `<button>Close</button>` was flagged as unlabelled.
  - So quote matching proves *location*, not *correctness*. [Inferred]
- **Prior art:**
  - Quote first, retract any claim without support, compare several runs. [Verified](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
  - pr-agent asks a second LLM pass to confirm that quoted snippets come from added lines; this check is non-deterministic. [Verified](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml)
  - reviewdog filters findings to added lines. [Verified](https://github.com/reviewdog/reviewdog#filter-mode)

### Prompt injection

- **OWASP:**
  - LLM01: there may be no "fool-proof methods" of prevention. [Verified](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
  - LLM05: treat model output as untrusted and encode it for HTML and Markdown. [Verified](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)
  - LLM02: give the model least-privilege data access. [Verified](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/)
- **Spotlighting** cut attack success from over 50% to under 2% against non-adaptive attacks. [Verified](https://arxiv.org/abs/2403.14720) Adaptive attacks succeeded more than 95% of the time against it, and more than 90% against most of the 12 defences studied. [Verified](https://arxiv.org/abs/2510.09023)
- **Local Spotlighting run** [Verified-local]:
  - Datamarking garbled the evidence quotes (`padding:13`) and returned empty results in 2 of 5 runs.
  - A naive injection failed 5 of 5 times. That shows nothing about robustness.
- **Vendor guidance:**
  - OpenAI: keep untrusted text out of system and developer messages. Structured outputs and isolation "greatly reduce, but don't fully remove" the risk. [Verified](https://developers.openai.com/api/docs/guides/agent-builder-safety)
  - Microsoft calls injection "inherent" and blocks its impact deterministically. [Verified](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- **Real incidents:**
  - CamoLeak: hidden comments in a PR description made Copilot Chat leak data through image URLs. [Verified](https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code)
  - Comment and Control: a PR title made claude-code-security-review leak its API key. [Verified](https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/)

### Existing tools

- **claude-code-security-review** [Verified](https://github.com/anthropics/claude-code-security-review):
  - It is "not hardened against prompt injection".
  - Findings carry file, line, severity, category, exploit scenario, recommendation and a 0–1 confidence.
  - False positives are filtered by regex exclusions, then a second LLM pass on each finding. **If that pass fails, the finding is kept.**
  - It only comments and never blocks.
- **pr-agent** [Verified](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/configuration.toml):
  - A reflection pass scores each suggestion 0–10.
  - If reflection fails, the suggestion gets 7 and is still published.
  - PR content is labelled "untrusted data".
  - Auto-approve is disabled.
- **Copilot code review** reads its instructions from the **PR head branch**. Its approvals (in preview) can satisfy required reviews. [Verified](https://docs.github.com/en/copilot/concepts/agents/code-review)
- **CodeRabbit** blocks merges only with opt-in `error` checks. "Inconclusive" never blocks, and overrides are audited. [Verified](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks)

### Visual critique

- **UICrit:** LLM critiques "do not yet match human evaluators". [Verified](https://arxiv.org/abs/2407.08850)
- **Grounding:** multimodal LLMs struggle to tie a critique to the right screen region. [Verified](https://arxiv.org/abs/2412.16829)
- **Human alignment:** they match human judgement only on some dimensions. [Verified](https://arxiv.org/abs/2510.08783)
- **Expert gap:** a "significant gap" remains versus experts. [Verified](https://arxiv.org/abs/2510.18560)
- **Basic perception:** 2024 VLMs scored 58% on trivial geometry. [Verified](https://arxiv.org/abs/2407.06581)

## Implications for Design Warden

1. **Two adapters.** One for `anthropic`, one for `openai-compatible` via `baseURL`. Quirks live in config: the token-limit parameter name and the reasoning switch. Images are always sent as base64. [Inferred]
2. **One static schema:** `{findings:[{ruleId,file,line,evidence,message,confidence}]}`. [Inferred]
   - All fields required.
   - Enums only for `ruleId` and `confidence`.
   - No numeric or length constraints, no reasoning field, no file paths.
   - Re-validate locally and normalise enum case.
3. **The deterministic verifier is the only way to "verified".** [Inferred]
   - Checks run in order: the output parses and matches the schema, the rule is enabled, the file is changed, the line is an added line, and the normalised evidence is a substring of the cited line.
   - Then deduplicate and cap.
   - Number lines in the prompt and report what was dropped.
4. **Explicit AI status:** `ok`, `skipped`, `rate_limited`, `overloaded`, `timeout`, `truncated`, `refused` or `invalid_output`. [Inferred]
   - Retry once at most, honouring `retry-after`.
   - Never parse partial JSON.
   - Empty output with a length stop is `truncated`, not "no findings".
5. **Advisory forever.** AI findings never touch the exit code, never approve, and never suppress deterministic findings. Getting no AI findings means nothing. [Inferred]
6. **Assume injection sometimes succeeds.** [Inferred]
   - No tools, network or secrets.
   - Prompts and policy come from the base branch, never the PR head.
   - Untrusted text goes only in user messages, between random delimiters, without datamarking.
   - Output is shown as escaped plain text with no links or images, under a strict CSP.
   - Forks are off by default.
   - Injection fixtures live in the tests.
7. **Minimal data.** Send only changed hunks and rule text, redact secrets deterministically, and offer a local provider for privacy. [Inferred]
8. **Precision first.** Show only high-confidence findings, with a kill switch per rule. [Inferred]
9. **Visual critique is off by default and advisory.** Never use it for measurable properties. Any region it cites must overlap the deterministic diff. [Inferred]

## Open questions

- What do vLLM and LM Studio do with unsupported keywords under `strict`? Needs a fixture run.
- Measuring precision needs a seeded PR eval set before any default-on setting.
- Should results go to PR comments, or stay in the inspector only?
- How do images and structured output combine on Anthropic? [Unresolved]

## Sources

- **OpenAI:** [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) (schema subset), [Chat reference](https://developers.openai.com/api/reference/resources/chat), [rate limits](https://developers.openai.com/api/docs/guides/rate-limits), [error codes](https://developers.openai.com/api/docs/guides/error-codes), [agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety).
- **Anthropic:** [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [errors](https://platform.claude.com/docs/en/api/errors), [rate limits](https://platform.claude.com/docs/en/api/rate-limits), [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), [hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).
- **Runtimes:** [Ollama source](https://github.com/ollama/ollama/blob/main/openai/openai.go), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [vLLM](https://docs.vllm.ai/en/latest/features/structured_outputs.html), [LM Studio](https://lmstudio.ai/docs/developer/openai-compat/structured-output).
- **OWASP:** [LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [LLM02](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/), [LLM05](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/).
- **Injection:** [Spotlighting](https://arxiv.org/abs/2403.14720), [adaptive attacks](https://arxiv.org/abs/2510.09023) (§E), [MSRC](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks), [lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [CamoLeak](https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code), [Comment and Control](https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/).
- **Evaluations:** [SWR-Bench](https://arxiv.org/abs/2509.01494), [Beko](https://arxiv.org/abs/2412.18531), [uReview](https://www.uber.com/blog/ureview/), [package hallucinations](https://arxiv.org/abs/2406.10279).
- **Tools:** claude-code-security-review [README](https://github.com/anthropics/claude-code-security-review) and [filter](https://github.com/anthropics/claude-code-security-review/blob/main/claudecode/findings_filter.py), pr-agent [config](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/configuration.toml) and [reflection](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml), [Copilot](https://docs.github.com/en/copilot/concepts/agents/code-review), [CodeRabbit](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks), [reviewdog](https://github.com/reviewdog/reviewdog#filter-mode).
- **Visual:** [UICrit](https://arxiv.org/abs/2407.08850), [visual prompting](https://arxiv.org/abs/2412.16829), [UI judge](https://arxiv.org/abs/2510.08783), [WebDevJudge](https://arxiv.org/abs/2510.18560), [VLMs are blind](https://arxiv.org/abs/2407.06581).
- **Local experiment:** an uncommitted Node script against Ollama 0.35.0. A 12-line TSX fixture with 3 seeded violations, run clean, unnumbered, injected, and injected plus datamarked; 5 runs each at temperature 0.7.
