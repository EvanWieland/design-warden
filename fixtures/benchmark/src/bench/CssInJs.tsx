// Benchmark: CSS-in-JS templates. Each "@expect <rule>" marker labels a finding expected on its line.
// A value the tool cannot resolve is expected as an "insufficient evidence" finding, which counts as reported.
declare const styled: ((c: unknown) => (s: TemplateStringsArray, ...v: unknown[]) => unknown) & Record<string, (s: TemplateStringsArray, ...v: unknown[]) => unknown>;
declare function css(s: TemplateStringsArray, ...v: unknown[]): unknown;
declare function keyframes(s: TemplateStringsArray, ...v: unknown[]): unknown;
declare function gql(s: TemplateStringsArray, ...v: unknown[]): unknown;
declare const Link: unknown;
type P = { tone: string; theme: { gap: string } };

// Tricky negatives: tokens, a mixin, a selector interpolation, an unchecked property, and a non-style tag.
const focusRing = css`outline: 2px solid var(--color-focus-ring);`;
export const Card = styled.section`
  padding: var(--space-4);
  ${focusRing} // shared focus style
  transition: opacity ${(p: P) => p.tone}ms;
  ${Link}:hover & { color: var(--color-text-link); }
`;
export const QUERY = gql`query { color: red }`;
export const Forced = styled.p`color: var(--color-text-primary) !important;`; /* @expect styles/no-important */

export const Banner = styled.div`
  background: #fde68a; /* @expect color/semantic-tokens */
  padding: 10px var(--space-3); /* @expect spacing/scale */
  color: ${(p: P) => p.tone}; /* @expect color/semantic-tokens */
  margin: ${(p: P) => p.theme.gap}; /* @expect spacing/scale */
`;
export const Danger = styled(Card).attrs({ role: 'alert' })`border-color: rgb(185, 28, 28);`; /* @expect color/semantic-tokens */
const fade = keyframes`from { background: white; }`; /* @expect color/semantic-tokens */
export const Heading = styled.h1`
  font-size: 30px; /* @expect typography/scale */
  &:hover { --heading-accent: var(--palette-blue-600); } /* @expect tokens/semantic-only */
`;
export const Notes = styled.p`
  // a line comment, as stylis allows: templates are parsed with postcss-scss, so this reads fine
  color: #334155; /* @expect color/semantic-tokens */
`;
export const Broken = styled.p` /* @expect color/semantic-tokens @expect spacing/scale @expect typography/scale */
  color: #334155; }
`; // an unmatched brace: the template cannot be parsed, so it is reported as insufficient evidence
export const used = [fade];
