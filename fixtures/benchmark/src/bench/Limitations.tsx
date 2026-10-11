// Benchmark: known limitations. Each "@expect <rule>" marker labels a finding a complete tool should report.
// These were known false negatives until CSS-in-JS templates (B6) and Tailwind arbitrary values (B5)
// were read. They stay as regression cases.
import { Stack } from '../design-system';

declare const styled: { h2: (s: TemplateStringsArray) => unknown };

export const Heading = styled.h2`color: #e11d48;`; /* @expect color/semantic-tokens */

const DANGER = '#b91c1c';

export function LimitationCases() {
  return (
    <Stack gap={2}>
      <div className="p-[13px] text-[#e11d48]">Tailwind arbitrary values</div> {/* @expect spacing/scale @expect color/semantic-tokens */}
      <p style={{ color: DANGER }}>constant defined above: reported as insufficient evidence, not resolved</p> {/* @expect color/semantic-tokens */}
    </Stack>
  );
}
