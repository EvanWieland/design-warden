// Benchmark: raw controls where the design system has a component. Each "@expect <rule>" marker labels a finding expected on its line.
import { Button, Checkbox, Link, TextField } from '../design-system';

export function ControlCases() {
  return (
    <form>
      <Button variant="primary">ok: design-system button</Button>
      <TextField label="ok: design-system field" />
      <Checkbox label="ok: design-system checkbox" />
      <Link to="/orders">ok: design-system link</Link>
      <label htmlFor="x">ok: label is not a control</label>
      <button type="button">raw button</button> {/* @expect components/design-system-controls */}
      <input type="text" /> {/* @expect components/design-system-controls */}
      <a href="/settings">raw link</a> {/* @expect components/design-system-controls */}
      <select /> {/* @expect components/design-system-controls */}
      <table /> {/* @expect components/design-system-controls */}
    </form>
  );
}
