import './Spinner.css';

export interface SpinnerProps {
  /** Read by screen readers, e.g. "Loading orders". */
  label: string;
  size?: 'sm' | 'md';
}

export function Spinner({ label, size = 'md' }: SpinnerProps) {
  return (
    <span className={`ds-spinner ds-spinner--${size}`}>
      <span className="ds-spinner__ring" aria-hidden="true" />
      <span className="ds-visually-hidden">{label}</span>
    </span>
  );
}
