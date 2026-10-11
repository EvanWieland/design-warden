// Benchmark: Tailwind arbitrary values and default-palette color classes in class names. Each "@expect <rule>" marker labels a finding expected on its line.
declare function cn(...classes: unknown[]): string;
declare function classNames(...classes: unknown[]): string;
declare function cva(...args: unknown[]): unknown;

const tones: Record<string, string> = { danger: 'bg-red-100 text-red-700' }; // @expect tokens/semantic-only x2 (a class map read where it is written)
const button = cva('px-[13px]', { variants: { tone: { danger: 'bg-red-600' } }, defaultVariants: { tone: 'danger' } }); // @expect spacing/scale @expect tokens/semantic-only
export const used = [button];

const label = 'p-[13px] text-[#e11d48]'; // a class-like string outside a class name: not read
const late = 'text-[#b91c1c]'; // @expect color/semantic-tokens (a constant used as a class name below, reported where it is written)

export function TailwindCases({ active, size }: { active: boolean; size: string }) {
  return (
    <section className="flex flex-col gap-[var(--space-4)] p-(--space-5)">
      {/* Tricky negatives: tokens, the v4 shorthand, type hints, a spacing theme class, unchecked utilities, url(). */}
      <h2 className="text-[length:var(--font-size-lg)] text-[color:var(--color-text-primary)] font-semibold">{label}</h2>
      <div className="w-[var(--size-sidebar)] min-h-[240px] grid-cols-[1fr_2fr] rounded-[var(--radius-md)] p-4 text-slate-700" /> {/* @expect tokens/semantic-only: a default-palette class is a token reference, and the demo has no --color-slate-700 */}
      <div className="bg-[url('/hero.png')] bg-[length:200px_100px]" />
      <div className={`text-${size} px-[var(--space-3)]`} />

      <div className="p-[13px] text-[#e11d48]" /> {/* @expect spacing/scale @expect color/semantic-tokens */}
      <div className="md:hover:mx-[18px]" /> {/* @expect spacing/scale */}
      <div className="-mt-[8px] text-[15px]" /> {/* @expect spacing/scale @expect typography/scale */}
      <div className="data-[state=open]:bg-[#2563eb]/50" /> {/* @expect color/semantic-tokens */}
      <div className="shadow-[0_1px_2px_#0f172a]" /> {/* @expect color/semantic-tokens */}
      <div className="[padding:13px] [--card-gap:6px]" /> {/* @expect spacing/scale */}
      <div className="p-(--space-9) bg-[var(--palette-blue-600)]" /> {/* @expect tokens/semantic-only x2 */}
      <div className={cn('gap-y-[10px]', active && 'border-[rgb(220,38,38)]', { 'text-[#fff]': !active })} /> {/* @expect spacing/scale @expect color/semantic-tokens x2 */}
      <div className={active ? 'pt-[2px]' : 'pt-[var(--space-1)]'} /> {/* @expect spacing/scale */}
      <span className={classNames(late, 'px-[13px]')} /> {/* @expect spacing/scale */}
      <p className="text-gray-500 hover:bg-blue-600/90 border-2 text-sm bg-transparent shadow-lg" /> {/* @expect tokens/semantic-only x2 */}
      <p className={cn('text-white', active && 'ring-offset-indigo-500')} /> {/* @expect tokens/semantic-only x2 */}
      <p className={cn('px-2', tones[size])} />
      <hr className="border-white" />{/* tricky negative: utilities.css defines .border-white */}
    </section>
  );
}
