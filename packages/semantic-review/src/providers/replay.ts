import fs from 'node:fs';
import type { ProviderResult, SemanticProvider } from '../provider.ts';

/**
 * Returns a recorded model response from a JSON file instead of calling a model.
 * Used by the test suite and the demo; nothing leaves the machine. The response still
 * goes through the same validation and verification as a live one.
 */
export function replayProvider(file: string): SemanticProvider {
  return {
    name: 'replay',
    model: 'recorded-response',
    endpoint: undefined,
    supportsImages: false,
    async review(): Promise<ProviderResult> {
      return { text: fs.readFileSync(file, 'utf8'), model: 'recorded-response', truncated: false };
    },
  };
}
