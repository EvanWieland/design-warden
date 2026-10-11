import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import './Button.css';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  /** Shows a spinner and blocks clicks while an action runs. */
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, disabled = false, type = 'button', onClick, children }: ButtonProps) {
  return (
    <button
      type={type}
      className={`ds-button ds-button--${variant} ds-button--${size}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {loading && <Spinner label="Loading" size="sm" />}
      {children}
    </button>
  );
}
