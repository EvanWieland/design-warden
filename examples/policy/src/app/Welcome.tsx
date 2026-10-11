import { Button } from '../ui/Button';
import './welcome.css';

export function Welcome() {
  return (
    <section className="welcome">
      <h1>Welcome</h1>
      <Button variant="primary">Get started</Button>
    </section>
  );
}
