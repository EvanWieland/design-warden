import { useId } from 'react';
import './TextField.css';
import './Select.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value?: T;
  onChange?: (value: T) => void;
  options: readonly SelectOption<T>[];
  hint?: string;
  /** Marks the field invalid and shows this message under it. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function Select<T extends string>({ label, value, onChange, options, hint, error, required, disabled }: SelectProps<T>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="ds-field">
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        className="ds-field__control ds-select"
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
        // Options are typed as T, so the selected value is one of them.
        onChange={(event) => onChange?.(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p id={hintId} className="ds-field__hint">{hint}</p>}
      {error && <p id={errorId} className="ds-field__error">{error}</p>}
    </div>
  );
}
