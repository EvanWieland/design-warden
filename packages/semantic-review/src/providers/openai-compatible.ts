import { ProviderError, type ProviderResult, type ReviewRequest, type SemanticProvider } from '../provider.ts';

export interface OpenAiCompatibleOptions {
  /** e.g. http://127.0.0.1:11434/v1 for Ollama, https://api.openai.com/v1 for OpenAI. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** OpenAI reasoning models need max_completion_tokens; Ollama ignores it (docs/research/ai-review.md). */
  tokenLimitParam?: 'max_tokens' | 'max_completion_tokens';
}

/**
 * Chat Completions with `response_format: json_schema`. Works with OpenAI, Ollama, vLLM and
 * LM Studio, but not all of them enforce `strict`, so local validation stays mandatory.
 */
export function openAiCompatibleProvider(opts: OpenAiCompatibleOptions): SemanticProvider {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    name: 'openai-compatible',
    model: opts.model,
    endpoint: url,
    supportsImages: true,
    async review(req: ReviewRequest, signal: AbortSignal): Promise<ProviderResult> {
      const body = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          {
            role: 'user',
            content: [
              { type: 'text', text: req.user },
              ...req.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })),
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
        [opts.tokenLimitParam ?? 'max_tokens']: Math.min(req.maxOutputTokens, 16_000),
      };
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        const e = err as Error;
        throw new ProviderError(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'network', `${e.name}: ${e.message}`);
      }
      if (!res.ok) {
        const kind = res.status === 429 ? 'rate-limited' : res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'unavailable' : 'bad-request';
        const retry = res.headers.get('retry-after');
        throw new ProviderError(kind, `HTTP ${res.status}${retry ? ` (retry after ${retry}s)` : ''}`);
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      if (choice?.message?.refusal) throw new ProviderError('refused', `the model refused: ${choice.message.refusal.slice(0, 200)}`);
      return {
        text: choice?.message?.content ?? '',
        model: json.model ?? opts.model,
        // A reasoning model can spend its whole budget thinking and return nothing: that is truncation, not "no findings".
        truncated: choice?.finish_reason === 'length',
        usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
      };
    },
  };
}
