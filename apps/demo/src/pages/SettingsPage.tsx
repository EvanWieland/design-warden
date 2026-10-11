import { useState, type FormEvent } from 'react';
import { Button, Card, Checkbox, PageHeader, Stack, TextField } from '../design-system';
import './SettingsPage.css';

const SAVED_SETTINGS = { displayName: 'Acme Retail', weeklySummary: true };

export function SettingsPage() {
  const [saved, setSaved] = useState(SAVED_SETTINGS);
  const [displayName, setDisplayName] = useState(saved.displayName);
  const [weeklySummary, setWeeklySummary] = useState(saved.weeklySummary);
  const unsaved = displayName !== saved.displayName || weeklySummary !== saved.weeklySummary;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved({ displayName, weeklySummary });
  }

  return (
    <Stack gap={6}>
      <PageHeader title="Settings" description="Manage how your organization appears and which summaries it receives." />
      <Card title="Organization">
        <form className="settings-page__form" noValidate onSubmit={handleSubmit}>
          <Stack gap={5}>
            <TextField label="Organization ID" value="acme-retail-eu" hint="Contact support to change this" disabled />
            <TextField label="Display name" name="displayName" value={displayName} onChange={setDisplayName} />
            <Checkbox
              label="Send weekly summary"
              hint="Every Monday, to organization admins"
              checked={weeklySummary}
              onChange={setWeeklySummary}
            />
            <Checkbox label="Allow API access" hint="Requires the Enterprise plan" checked={false} disabled />
            <Stack direction="row" gap={4} align="center" wrap>
              <Button variant="primary" type="submit" disabled={!unsaved}>
                Save changes
              </Button>
              <p className="settings-page__save-status">{unsaved ? 'You have unsaved changes' : 'No unsaved changes'}</p>
            </Stack>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
