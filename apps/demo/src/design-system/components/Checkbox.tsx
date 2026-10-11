import { useId } from 'react';
import './Checkbox.css';

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export function Checkbox({ label, checked, onChange, hint, disabled }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={disabled ? 'ds-checkbox ds-checkbox--disabled' : 'ds-checkbox'}>
      <input
        id={id}
        type="checkbox"
        className="ds-checkbox__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <div className="ds-checkbox__text">
        <label htmlFor={id} className="ds-checkbox__label">
          {label}
        </label>
        {hint && <p id={hintId} className="ds-checkbox__hint">{hint}</p>}
      </div>
    </div>
  );
}
