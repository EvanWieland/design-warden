import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Checkbox, PageHeader, Select, Stack, TextField } from '../design-system';
import { navigate } from '../router';
import './NewOrderPage.css';

interface OrderDraft {
  customer: string;
  product: string;
  quantity: string;
  notes: string;
  express: boolean;
}

type FieldErrors = Partial<Record<'customer' | 'product' | 'quantity', string>>;

const EMPTY_DRAFT: OrderDraft = { customer: '', product: '', quantity: '', notes: '', express: false };

const products = [
  { value: '', label: 'Choose a product' },
  { value: 'desk-oak', label: 'Standing desk, oak' },
  { value: 'chair-task', label: 'Task chair' },
  { value: 'monitor-27', label: '27-inch monitor' },
  { value: 'dock-usbc', label: 'USB-C docking station' },
];

function validate(draft: OrderDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.customer.trim()) errors.customer = 'Enter a customer name';
  if (!draft.product) errors.product = 'Choose a product';
  const quantity = Number(draft.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) errors.quantity = 'Enter a quantity of at least 1';
  return errors;
}

export function NewOrderPage() {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState(false);
  const errorCount = Object.keys(errors).length;

  function update<K extends keyof OrderDraft>(key: K) {
    return (value: OrderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(draft);
    const valid = Object.keys(nextErrors).length === 0;
    setErrors(nextErrors);
    setCreated(valid);
    if (valid) setDraft(EMPTY_DRAFT);
  }

  return (
    <Stack gap={6}>
      <PageHeader title="New order" description="Create an order on behalf of a customer. It goes to the warehouse queue straight away." />
      <Card>
        <form className="new-order-page__form" noValidate onSubmit={handleSubmit}>
          <Stack gap={5}>
            {errorCount > 0 && (
              <Alert tone="danger" title={`Fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} to continue`}>
                Each highlighted field says what is missing.
              </Alert>
            )}
            {created && (
              <Alert tone="success" title="Order created">
                The warehouse team can see it in their queue now.
              </Alert>
            )}
            <TextField label="Customer" name="customer" required value={draft.customer} onChange={update('customer')} error={errors.customer} />
            <Select label="Product" required value={draft.product} onChange={update('product')} options={products} error={errors.product} />
            <TextField
              label="Quantity"
              name="quantity"
              type="number"
              required
              value={draft.quantity}
              onChange={update('quantity')}
              error={errors.quantity}
            />
            <TextField label="Notes" name="notes" multiline hint="Visible to the warehouse team" value={draft.notes} onChange={update('notes')} />
            <Checkbox label="Express shipping" checked={draft.express} onChange={update('express')} />
            <Stack direction="row" gap={3}>
              <Button variant="primary" type="submit">
                Create order
              </Button>
              <Button variant="ghost" onClick={() => navigate('/orders')}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
