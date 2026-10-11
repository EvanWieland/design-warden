// Benchmark: CSS-in-JS object styles (Emotion, styled objects, MUI sx). Each "@expect <rule>" marker labels a finding expected on its line.
// A value the tool cannot resolve is expected as an "insufficient evidence" finding, which counts as reported.
declare const styled: any;
declare function css(o: object): unknown;
declare function keyframes(o: object): unknown;
declare function track(event: object): void;
declare const Box: (p: { sx?: unknown }) => null;
type P = { tone: string };

// Tricky negatives: tokens, an unchecked property, attrs props, a non-style call, and theme paths and units in sx.
const surface = css({ background: 'var(--color-bg-surface)', padding: 'var(--space-4)', transition: 'opacity 120ms' });
export const Tile = styled.button.attrs({ color: 'red' })({ color: 'var(--color-text-primary)' });
track({ color: 'red', padding: '13px' }); // an analytics payload, not styles
export const Stack = () => <Box sx={{ p: 2, gap: 1, color: 'text.secondary', bgcolor: 'background.paper', borderColor: 'divider' }} />; /* @expect components/reuse-existing: a hand-made copy of the design system's Stack */

export const Banner = styled.div({
  background: '#fde68a', /* @expect color/semantic-tokens */
  padding: '10px', /* @expect spacing/scale */
  '&:hover': {
    color: 'rgb(30, 64, 175)', /* @expect color/semantic-tokens */
  },
});
export const Toned = styled('p')((p: P) => ({
  color: p.tone, /* @expect color/semantic-tokens */
  margin: 'var(--space-2)',
}));
const pulse = keyframes({ from: { background: 'white' } }); /* @expect color/semantic-tokens */
export const Title = () => <h2 css={{ fontSize: 30 }} />; /* @expect typography/scale */
export const Promo = () => (
  <Box
    sx={{
      bgcolor: '#7c3aed', /* @expect color/semantic-tokens */
      px: [2, '18px'], /* @expect spacing/scale */
      '&:focus-visible': { outlineColor: 'hotpink' }, /* @expect color/semantic-tokens */
    }}
  />
);
declare const c: { head: string };
declare const k: string;
export const Responsive = () => <Box sx={{ px: { xs: 1, md: '18px' }, color: { md: 'red' } }} />; /* @expect spacing/scale @expect color/semantic-tokens */
export const Table = styled.table({ [`&.${c.head}`]: { color: '#fff' } }); /* @expect color/semantic-tokens */
export const Runtime = styled.div({ [k]: '13px' }); /* @expect color/semantic-tokens @expect spacing/scale @expect typography/scale */
const variants = { danger: { background: '#dc2626' } }; /* @expect color/semantic-tokens */
export const Variant = styled.button((p: { v: 'danger' }) => variants[p.v]);
export const Small = () => <Box sx={{ fontSize: 15 }} />; /* @expect typography/scale */
export const used = [surface, pulse];
