import type { ReactNode } from 'react';
import './Stack.css';

export interface StackProps {
  /** Step on the spacing scale: gap={4} is var(--space-4). */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  direction?: 'row' | 'column';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  children: ReactNode;
}

export function Stack({ gap = 4, direction = 'column', align, justify, wrap = false, children }: StackProps) {
  const className = [
    'ds-stack',
    `ds-stack--${direction}`,
    `ds-stack--gap-${gap}`,
    align && `ds-stack--align-${align}`,
    justify && `ds-stack--justify-${justify}`,
    wrap && 'ds-stack--wrap',
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={className}>{children}</div>;
}
