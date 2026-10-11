import { Button } from '../design-system';
import { navigate } from '../router';
import './PartnerPromo.css';

/**
 * Northstar Freight co-marketing strip. Its CSS uses the partner's contractual brand colors under
 * the policy exception "legacy-partner-promo"; remove this file when the campaign ends.
 */
export function PartnerPromo() {
  return (
    <aside className="partner-promo" aria-label="Partner offer">
      <div className="partner-promo__text">
        <p className="partner-promo__title">Northstar Freight express shipping</p>
        <p>Save 20% on express shipping for orders placed before 31 March 2027.</p>
      </div>
      <Button size="sm" onClick={() => navigate('/orders/new')}>
        Create an express order
      </Button>
    </aside>
  );
}
