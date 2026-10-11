import { useId, type ChangeEvent } from 'react';
import './TextField.css';

export interface TextFieldProps {
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: 'text' | 'number' | 'email' | 'search';
  placeholder?: string;
  /** Help text shown under the field. */
  hint?: string;
  /** Marks the field invalid and shows this message under it. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Renders a textarea for longer text. */
  multiline?: boolean;
}

export function TextField({ label, name, value, onChange, type = 'text', placeholder, hint, error, required, disabled, multiline }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const control = {
    id,
    name,
    value,
    placeholder,
    required,
    disabled,
    className: 'ds-field__control',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.(event.target.value),
  };

  return (
    <div className="ds-field">
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      {multiline ? <textarea rows={4} {...control} /> : <input type={type} {...control} />}
      {hint && <p id={hintId} className="ds-field__hint">{hint}</p>}
      {error && <p id={errorId} className="ds-field__error">{error}</p>}
    </div>
  );
}
