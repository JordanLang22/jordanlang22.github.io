import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import activity from '../src/data/activity.json' with { type: 'json' };

const count = async (locator: import('@playwright/test').Locator) =>
  Number((await locator.textContent())?.replaceAll(',', ''));

test('the hub keeps delivering through a failure and loses nothing', async ({ page }) => {
  await page.goto('/');
  const translate = page.locator('[data-node="translate"]');
  await expect(page.locator('#hero-title')).toHaveAccessibleName('Software that keeps its word');
  await expect.poll(() => count(page.locator('#stat-delivered'))).toBeGreaterThan(0);

  await translate.click();
  await expect(translate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sim-status')).toContainText('Translate is down');
  await expect(page.locator('#stat-lost')).toHaveText('0');

  await translate.click();
  await expect(translate).toHaveAttribute('aria-pressed', 'false');
  const before = await count(page.locator('#stat-delivered'));
  await expect.poll(() => count(page.locator('#stat-delivered'))).toBeGreaterThan(before);
  await expect(page.locator('#stat-lost')).toHaveText('0');
});

test('products answer, and the answers come back', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => count(page.locator('#stat-returned'))).toBeGreaterThan(0);
});

test('a product can be switched off without anything failing', async ({ page }) => {
  await page.goto('/');
  const route = page.getByRole('switch', { name: 'Route messages to Product B' });
  await expect(route).toBeChecked();
  await route.click();
  await expect(route).not.toBeChecked();
  await expect(page.locator('#sim-status')).toContainText('Nothing failed');
  await expect(page.locator('#stat-lost')).toHaveText('0');
});

for (const [subject, key] of [
  ['Dendrition', 'dendrition'],
  ['KestrelTrader', 'kestrel'],
  ['ShieldHome', 'shieldhome'],
] as const) {
  test(`${subject} shows its measured commit count`, async ({ page }) => {
    await page.goto('/');
    const file = page.locator('[data-file]').filter({ hasText: subject });
    const commits = activity.projects[key].commits.toLocaleString('en-US');
    await expect(file.locator('dd').filter({ hasText: new RegExp(`^${commits}$`) })).toHaveCount(1);
    await expect(file).not.toContainText(`$${key}`);
  });
}

test('sealed bars contain no content', async ({ page }) => {
  await page.goto('/');
  const sealed = page.locator('.bar.sealed');
  expect(await sealed.count()).toBeGreaterThan(5);
  expect((await sealed.allInnerTexts()).join('')).toBe('');
});

test('case files are not covered by their stacking shade', async ({ page }) => {
  await page.goto('/');
  const shades = await page
    .locator('[data-file]')
    .evaluateAll((files) => files.map((file) => getComputedStyle(file, '::after').opacity));
  expect(new Set(shades)).toEqual(new Set(['0']));
});

for (const width of [375, 1440]) {
  test(`the page cannot scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(300, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the system waits to be started, and the headline is simply there', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/motion/);
    await expect(page.locator('#sim-toggle')).toHaveText('Run');
    await expect(page.locator('#hero-title .char').first()).toBeVisible();
    const held = await page.locator('#stat-delivered').textContent();
    await page.waitForTimeout(500);
    await expect(page.locator('#stat-delivered')).toHaveText(held ?? '');
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await page.goto('/');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    );
    expect(serious.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('all of the writing is still readable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero-title .char').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dendrition' })).toBeVisible();
    await expect(page.locator('.bar.open').first()).toHaveCSS('background-size', /^0(px)? /);
  });
});
