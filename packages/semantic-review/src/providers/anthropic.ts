import type Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type ProviderResult, type ReviewRequest, type SemanticProvider } from '../provider.ts';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Anthropic Messages API via the official SDK. Credentials come from the SDK's normal
 * resolution (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile),
 * never from the policy file. Structured output is constrained with output_config.format.
 * The SDK is imported only when a review runs, so source-only runs never load it.
 */
export function anthropicProvider(opts: { model?: string } = {}): SemanticProvider {
  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
  return {
    name: 'anthropic',
    model,
    endpoint: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    supportsImages: true,
    async review(req: ReviewRequest, signal: AbortSignal): Promise<ProviderResult> {
      const { default: SDK } = await import('@anthropic-ai/sdk');
      let client: Anthropic;
      try {
        // One retry for 429/5xx (honouring retry-after); the caller's signal bounds the total time.
        client = new SDK({ maxRetries: 1 });
      } catch (err) {
        throw new ProviderError('auth', `Anthropic client could not be configured: ${(err as Error).message}`);
      }
      try {
        const message = await client.beta.messages
          .stream(
            {
              model,
              max_tokens: req.maxOutputTokens,
              // Server-side fallback if the model declines; the serving model is reported back.
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              system: req.system,
              messages: [
                {
                  role: 'user',
                  content: [
                    ...req.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })),
                    { type: 'text' as const, text: req.user },
                  ],
                },
              ],
              output_config: { effort: 'high', format: { type: 'json_schema', schema: req.schema } },
            },
            { signal },
          )
          .finalMessage();
        if (message.stop_reason === 'refusal') {
          throw new ProviderError('refused', `the model declined the request (${message.stop_details?.category ?? 'no category'})`);
        }
        const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        return {
          text,
          model: message.model,
          truncated: message.stop_reason === 'max_tokens',
          usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
        };
      } catch (err) {
        throw toProviderError(err, SDK);
      }
    },
  };
}

function toProviderError(err: unknown, SDK: typeof Anthropic): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof SDK.APIUserAbortError) return new ProviderError('timeout', 'request aborted (time limit reached)');
  if (err instanceof SDK.APIConnectionTimeoutError) return new ProviderError('timeout', 'request timed out');
  if (err instanceof SDK.APIConnectionError) return new ProviderError('network', `connection failed: ${err.message}`);
  if (err instanceof SDK.RateLimitError) return new ProviderError('rate-limited', 'rate limited by the provider (HTTP 429)');
  if (err instanceof SDK.AuthenticationError || err instanceof SDK.PermissionDeniedError) {
    return new ProviderError('auth', `not authorised (HTTP ${err.status}); check ANTHROPIC_API_KEY`);
  }
  if (err instanceof SDK.BadRequestError) return new ProviderError('bad-request', `request rejected: ${err.message}`);
  if (err instanceof SDK.APIError) return new ProviderError('unavailable', `provider error (HTTP ${err.status ?? '?'}${err.type ? `, ${err.type}` : ''})`);
  return new ProviderError('unknown', (err as Error).message ?? String(err));
}
