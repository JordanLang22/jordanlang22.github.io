import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const count = async (locator: import('@playwright/test').Locator) =>
  Number((await locator.textContent())?.replaceAll(',', ''));

test('the live system keeps delivering through a failure and loses nothing', async ({ page }) => {
  await page.goto('/');
  const relay = page.locator('[data-node="relay-a"]');
  await expect(page.locator('#hero-title')).toHaveAccessibleName('Software that keeps its word');
  await expect.poll(() => count(page.locator('#stat-applied'))).toBeGreaterThan(0);

  await relay.click();
  await expect(relay).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sim-status')).toContainText('Relay A is down');

  const before = await count(page.locator('#stat-applied'));
  await expect.poll(() => count(page.locator('#stat-applied'))).toBeGreaterThan(before);
  await expect(page.locator('#stat-lost')).toHaveText('0');

  await relay.click();
  await expect(relay).toHaveAttribute('aria-pressed', 'false');
});

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
    const held = await page.locator('#stat-applied').textContent();
    await page.waitForTimeout(500);
    await expect(page.locator('#stat-applied')).toHaveText(held ?? '');
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
