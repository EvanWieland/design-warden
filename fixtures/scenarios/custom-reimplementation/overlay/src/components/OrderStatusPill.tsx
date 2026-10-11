import type { OrderStatus } from '../data/orders';
import './OrderStatusPill.css';

const LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  shipped: 'Shipped',
  refunded: 'Refunded',
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return <span className={`order-status-pill order-status-pill--${status}`}>{LABELS[status]}</span>;
}
