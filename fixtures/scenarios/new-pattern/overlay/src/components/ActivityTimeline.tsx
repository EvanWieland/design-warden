import { Badge, Card, type BadgeTone } from '../design-system';
import './ActivityTimeline.css';

interface ActivityEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  status: { label: string; tone: BadgeTone };
}

const EVENTS: ActivityEvent[] = [
  { id: 'e1', time: '08:40', title: 'ORD-10432 placed', detail: 'Northwind Traders ordered 3 items.', status: { label: 'Pending', tone: 'warning' } },
  { id: 'e2', time: '09:15', title: 'ORD-10431 paid', detail: 'Payment confirmed by the card issuer.', status: { label: 'Paid', tone: 'info' } },
  { id: 'e3', time: '10:05', title: 'ORD-10430 shipped', detail: 'Handed to the carrier with tracking.', status: { label: 'Shipped', tone: 'success' } },
];

/** Today's order events in time order. No timeline pattern exists in the design system yet. */
export function ActivityTimeline() {
  return (
    <Card title="Today's activity">
      <ol className="activity-timeline">
        {EVENTS.map((event) => (
          <li key={event.id} className="activity-timeline__item">
            <time className="activity-timeline__time" dateTime={`2026-10-06T${event.time}`}>
              {event.time}
            </time>
            <div className="activity-timeline__body">
              <h3 className="activity-timeline__title">
                {event.title} <Badge tone={event.status.tone}>{event.status.label}</Badge>
              </h3>
              <p className="activity-timeline__detail">{event.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
