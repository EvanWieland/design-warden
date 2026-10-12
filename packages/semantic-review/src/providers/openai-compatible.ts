import http from 'node:http';
import https from 'node:https';
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
  // node:http would send user:password in the URL as Basic auth, and the endpoint is printed in reports: neither may happen.
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  const credentials = !!parsed && (parsed.username !== '' || parsed.password !== '');
  if (parsed) parsed.username = parsed.password = '';
  return {
    name: 'openai-compatible',
    model: opts.model,
    endpoint: parsed?.toString() ?? url,
    supportsImages: true,
    async review(req: ReviewRequest, signal: AbortSignal): Promise<ProviderResult> {
      if (credentials) throw new ProviderError('auth', 'the base URL contains credentials, which are never sent; set DESIGN_WARDEN_OPENAI_API_KEY instead');
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
      let res: { status: number; retryAfter?: string; text: string };
      try {
        res = await post(url, { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) }, JSON.stringify(body), signal);
      } catch (err) {
        const e = err as Error;
        throw new ProviderError(signal.aborted ? 'timeout' : 'network', `${e.name}: ${e.message}`);
      }
      if (res.status < 200 || res.status > 299) {
        const kind = res.status === 429 ? 'rate-limited' : res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'unavailable' : 'bad-request';
        throw new ProviderError(kind, `HTTP ${res.status}${res.retryAfter ? ` (retry after ${res.retryAfter}s)` : ''}`);
      }
      let json: {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new ProviderError('unknown', `the response is not JSON: ${res.text.slice(0, 100)}`);
      }
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

/** Far above any review answer (a few hundred KB): a broken or hostile endpoint cannot exhaust memory. */
const MAX_RESPONSE = 8 * 1024 * 1024;

/**
 * POST and read the whole answer. Not fetch: its 300 s headers timeout cannot be raised, and a local model
 * can take longer to answer without streaming. The caller's signal is the only time limit.
 */
function post(url: string, headers: Record<string, string>, body: string, signal: AbortSignal): Promise<{ status: number; retryAfter?: string; text: string }> {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).request(url, { method: 'POST', headers, signal }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
        if (text.length > MAX_RESPONSE) req.destroy(new Error('the response is larger than 8 MB'));
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, retryAfter: res.headers['retry-after'], text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
