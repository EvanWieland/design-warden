/**
 * The contract a model provider implements. Providers only transport a prepared
 * request and return raw text; validation and verification happen in this package,
 * identically for every provider.
 */
export interface ReviewRequest {
  system: string;
  user: string;
  images: { name: string; mediaType: 'image/png'; base64: string }[];
  /** JSON Schema for the response, restricted to what all supported providers accept. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface ProviderResult {
  text: string;
  /** Model that actually served the request (may differ from the requested one, e.g. after a fallback). */
  model?: string;
  truncated: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface SemanticProvider {
  readonly name: string;
  readonly model?: string;
  /** Where request data is sent. Undefined means nothing leaves the machine. */
  readonly endpoint?: string;
  readonly supportsImages: boolean;
  review(req: ReviewRequest, signal: AbortSignal): Promise<ProviderResult>;
}

export type ProviderErrorKind = 'timeout' | 'rate-limited' | 'auth' | 'refused' | 'unavailable' | 'bad-request' | 'network' | 'unknown';

export class ProviderError extends Error {
  override name = 'ProviderError';
  readonly kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
