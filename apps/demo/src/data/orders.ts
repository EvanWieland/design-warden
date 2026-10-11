import type { BadgeTone } from '../design-system';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'refunded';

export interface Order {
  id: string;
  customer: string;
  status: OrderStatus;
  items: number;
  /** US dollars. */
  total: number;
  /** Fixed YYYY-MM-DD date, so screenshots never change. */
  placed: string;
}

/** Fixed fixture data, newest first. */
export const orders: readonly Order[] = [
  { id: 'ORD-10432', customer: 'Northwind Traders', status: 'pending', items: 3, total: 1248.0, placed: '2026-10-09' },
  { id: 'ORD-10431', customer: 'Blue Harbor Outfitters', status: 'paid', items: 12, total: 4310.5, placed: '2026-10-09' },
  { id: 'ORD-10430', customer: 'Fernwood Home', status: 'shipped', items: 1, total: 89.99, placed: '2026-10-08' },
  { id: 'ORD-10429', customer: 'Kestrel Cycles', status: 'paid', items: 6, total: 2875.0, placed: '2026-10-08' },
  { id: 'ORD-10428', customer: 'Lumen & Co.', status: 'refunded', items: 2, total: 158.4, placed: '2026-10-07' },
  { id: 'ORD-10427', customer: 'Oakline Supply', status: 'shipped', items: 24, total: 6120.0, placed: '2026-10-07' },
  { id: 'ORD-10426', customer: 'Pinecrest Pharmacy', status: 'pending', items: 4, total: 512.75, placed: '2026-10-06' },
  { id: 'ORD-10425', customer: 'Harbor Street Books', status: 'shipped', items: 9, total: 734.2, placed: '2026-10-05' },
  { id: 'ORD-10424', customer: 'Meridian Labs', status: 'paid', items: 2, total: 1999.0, placed: '2026-10-05' },
  { id: 'ORD-10423', customer: 'Copperleaf Café', status: 'shipped', items: 15, total: 642.3, placed: '2026-10-03' },
  { id: 'ORD-10422', customer: 'Tidewater Marine', status: 'refunded', items: 1, total: 349.0, placed: '2026-10-02' },
  { id: 'ORD-10421', customer: 'Greenway Grocers', status: 'shipped', items: 30, total: 2210.6, placed: '2026-10-01' },
];

/** How each status is shown in a Badge. */
export const orderStatuses: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
// UTC, so the date never shifts with the machine's time zone.
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export const formatCurrency = (amount: number) => currency.format(amount);
export const formatDate = (isoDate: string) => day.format(new Date(isoDate));
