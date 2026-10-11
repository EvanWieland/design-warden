import { Fragment, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** The inspector's own small component set. Styles: styles/components.css. */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'error' | 'ai';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'link' };

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonProps) {
  return <button type="button" {...rest} className={`btn btn--${variant} ${className}`.trim()} />;
}

/** A file path that wraps after a "/" rather than inside a name (in tables, only after a "/"). */
export function Path({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <code className="path">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </code>
  );
}

export function Card({ title, className = '', children }: { title: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`card ${className}`.trim()} aria-labelledby={id}>
      <h3 id={id} className="card__title">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Alert({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  // Danger and warning interrupt (role=alert); info is announced politely.
  return (
    <div className={`alert alert--${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <p className="empty__body">{children}</p>}
    </div>
  );
}

/** A segmented control built on native radio buttons: arrow keys, labels and form semantics for free. */
export function Segmented<T extends string>(props: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={`segmented ${props.className ?? ''}`.trim()}>
      <legend className="visually-hidden">{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.value} className="segmented__option">
          <input type="radio" name={name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Select(props: { label: string; value: string; options: [value: string, label: string][]; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {props.label}
      </label>
      <select id={id} className="select" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Modal dialog on the native <dialog> element: showModal() makes the page behind it inert,
 * Escape closes it, and the browser returns focus to the control that opened it.
 */
export function Dialog(props: { title: ReactNode; onClose: () => void; variant?: 'center' | 'side'; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`dialog dialog--${props.variant ?? 'center'}`} aria-labelledby={titleId} onClose={props.onClose}>
      <div className="dialog__head">
        <h2 id={titleId} className="dialog__title">
          {props.title}
        </h2>
        <Button onClick={() => ref.current?.close()}>Close</Button>
      </div>
      <div className="dialog__body">{props.children}</div>
    </dialog>
  );
}
