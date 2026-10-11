import type { ReactNode } from 'react';
import { Button } from './Button';
import './FilterBar.css';

export interface FilterBarProps {
  /** TextField and Select filters. */
  children: ReactNode;
  /** Shows a "Reset" button that clears every filter. */
  onReset?: () => void;
}

export function FilterBar({ children, onReset }: FilterBarProps) {
  return (
    <div className="ds-filter-bar" role="search">
      {children}
      {onReset && (
        <Button variant="ghost" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}
