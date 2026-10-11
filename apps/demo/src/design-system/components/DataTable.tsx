import { useId, type ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { Spinner } from './Spinner';
import './DataTable.css';

export interface DataTableColumn<Row> {
  key: keyof Row & string;
  header: string;
  align?: 'left' | 'right';
  /** Cell content; defaults to the row's value for `key`. */
  render?: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Names the table for screen readers; visually hidden. */
  caption: string;
  status: 'loading' | 'error' | 'ready';
  /** Rendered when status is "ready" and there are no rows. */
  emptyState: ReactNode;
  errorMessage?: string;
  onRetry?: () => void;
}

export function DataTable<Row>({ columns, rows, rowKey, caption, status, emptyState, errorMessage, onRetry }: DataTableProps<Row>) {
  const captionId = useId();

  if (status === 'loading') {
    return (
      <div className="ds-data-table__loading" role="status">
        <Spinner label={`Loading ${caption.toLowerCase()}`} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Alert
        tone="danger"
        title={`${caption} could not be loaded`}
        action={onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
      >
        {errorMessage ?? 'Something went wrong on our side. Try again in a moment.'}
      </Alert>
    );
  }

  if (rows.length === 0) return emptyState;

  const alignClass = (column: DataTableColumn<Row>) => (column.align === 'right' ? 'ds-data-table__cell--right' : undefined);

  return (
    // Focusable so keyboard users can scroll wide tables on small screens.
    <div className="ds-data-table" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="ds-data-table__table">
        <caption id={captionId} className="ds-visually-hidden">
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={alignClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={alignClass(column)}>
                  {column.render ? column.render(row) : String(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
