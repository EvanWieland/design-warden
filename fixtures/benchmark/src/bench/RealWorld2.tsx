// Benchmark: cases from the detection audit of the real-world fixes (2026-10-12). Each "@expect <rule>" marker labels a finding expected on its line.
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { DialogTrigger } from '../design-system/components/Dialog';

export function AuditFollowUps() {
  return (
    <section>
      <DialogTrigger asChild><button type="button">Open</button></DialogTrigger> {/* @expect components/design-system-controls: a trigger adds behaviour, not styles */}
      <Check color="green" /> {/* @expect color/semantic-tokens: an icon from a package takes a CSS color */}
      <motion.path stroke="red" /> {/* @expect color/semantic-tokens */}
      <table><tbody><tr><td bgcolor="#f0f0f0" /></tr></tbody></table> {/* @expect color/semantic-tokens @expect components/design-system-controls */}
      <i style={{ ['--overlay-color' as string]: 'black' }} /> {/* @expect color/semantic-tokens */}
      <p className="p-[calc(var(--space-1-5)*2)]" /> {/* @expect tokens/semantic-only */}
    </section>
  );
}
