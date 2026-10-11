import { expect, test } from '@playwright/test';

// The demo app is the fixture Design Warden is evaluated against; these tests keep it working
// (navigation, data states, validation) so its screenshots and scenarios stay meaningful.
test.use({ baseURL: 'http://127.0.0.1:4174' });

test('overview shows the dashboard summary pattern', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Open orders')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Recent orders' })).toBeVisible();
});

test('navigation is client-side and keeps landmarks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('orders can be filtered and the filters cleared', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('table', { name: 'Orders' }).getByRole('row');
  await expect(rows).toHaveCount(13); // header + 12 orders
  await page.getByLabel('Search').fill('Northwind');
  await expect(rows).toHaveCount(2);
  await page.getByLabel('Search').fill('no such customer');
  await expect(page.getByText('No orders match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(13);
});

test('loading, empty and error states are reachable and announced', async ({ page }) => {
  await page.goto('/orders?state=loading');
  await expect(page.getByRole('status').first()).toBeVisible();
  await page.goto('/orders?state=empty');
  await expect(page.getByText('No orders match these filters')).toBeVisible();
  await page.goto('/orders?state=error');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /try again|retry/i })).toBeVisible();
});

test('the order form validates on submit', async ({ page }) => {
  await page.goto('/orders/new');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('[aria-invalid=true]')).toHaveCount(3);
  await expect(page.getByRole('alert')).toContainText('Fix 3 fields');
});

test('settings shows disabled controls and enables save after an edit', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByLabel('Organization ID')).toBeDisabled();
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Display name').fill('Acme Retail EU');
  await expect(save).toBeEnabled();
});
