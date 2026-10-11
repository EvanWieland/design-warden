import { useLocation } from '../router';
import { orders, type Order, type OrderStatus } from './orders';

export interface OrderFilters {
  search: string;
  status: OrderStatus | 'all';
}

export interface OrdersResult {
  status: 'loading' | 'error' | 'ready';
  rows: readonly Order[];
}

/**
 * Synchronous stand-in for the orders API: no network, no timers.
 * `?state=loading|error|empty` forces that state so every screen can be captured deterministically.
 */
export function useOrders({ search, status }: OrderFilters): OrdersResult {
  const { query } = useLocation();

  switch (query.get('state')) {
    case 'loading':
      return { status: 'loading', rows: [] }; // never resolves
    case 'error':
      return { status: 'error', rows: [] };
    case 'empty':
      return { status: 'ready', rows: [] };
  }

  const text = search.trim().toLowerCase();
  return {
    status: 'ready',
    rows: orders.filter(
      (order) =>
        (status === 'all' || order.status === status) &&
        (order.id.toLowerCase().includes(text) || order.customer.toLowerCase().includes(text)),
    ),
  };
}
