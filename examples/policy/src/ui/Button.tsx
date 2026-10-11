import type { ReactNode } from 'react';

export function Button({ variant = 'secondary', children }: { variant?: 'primary' | 'secondary'; children: ReactNode }) {
  return <button className={`ui-button ui-button--${variant}`}>{children}</button>;
}
