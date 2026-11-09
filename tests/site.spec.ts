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

test('every attack at once still loses nothing and breaks no promise', async ({ page }) => {
  await page.goto('/?seed=2016');
  await expect(page.locator('#sim-seed')).toHaveText('Seed 2016');
  for (const name of ['Drop packets', 'Duplicate packets', 'Shuffle order']) {
    const button = page.getByRole('button', { name });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Crash the store' }).click();
  await expect(page.locator('#sim-status')).toContainText('crashed and restarted');

  // The attacks have to be real: retries and duplicates must actually happen.
  await expect
    .poll(() => count(page.locator('#stat-retried')), { timeout: 20_000 })
    .toBeGreaterThan(3);
  await expect
    .poll(() => count(page.locator('#stat-deduplicated')), { timeout: 20_000 })
    .toBeGreaterThan(3);
  const before = await count(page.locator('#stat-delivered'));
  await expect
    .poll(() => count(page.locator('#stat-delivered')), { timeout: 20_000 })
    .toBeGreaterThan(before);
  for (const id of ['#stat-lost', '#stat-twice', '#stat-order', '#stat-misrouted']) {
    await expect(page.locator(id)).toHaveText('0');
    await expect(page.locator(id)).not.toHaveAttribute('data-broken');
  }
});

test('killing everything holds every message, then recovers by itself', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => count(page.locator('#stat-delivered'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Kill everything' }).click();
  await expect(page.locator('[data-node][aria-pressed="true"]')).toHaveCount(9);
  await expect(page.locator('#stat-lost')).toHaveText('0');
  await expect(page.locator('[data-node][aria-pressed="true"]')).toHaveCount(0, {
    timeout: 10_000,
  });
  const before = await count(page.locator('#stat-delivered'));
  await expect
    .poll(() => count(page.locator('#stat-delivered')), { timeout: 20_000 })
    .toBeGreaterThan(before);
  await expect(page.locator('#stat-lost')).toHaveText('0');
});

test('nothing on the page names the systems behind the day job', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('#top');
  await expect(hero.getByRole('button', { name: 'Source A down' })).toBeVisible();
  await expect(hero).not.toContainText(/CAD|Phones|Radio|agenc/i);
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

test('the bar takes the colour of the section under it and marks where you are', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.locator('[data-nav]');
  await expect(nav).toHaveAttribute('data-tone', 'ink');
  await page.locator('#record [data-file]').first().scrollIntoViewIfNeeded();
  await expect(nav).toHaveAttribute('data-tone', 'paper');
  await expect(nav.getByRole('link', { name: 'Record' })).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(nav).toHaveAttribute('data-tone', 'flare');
  await expect(nav.getByRole('link', { name: 'Contact' })).toHaveAttribute('aria-current', 'true');
  await expect(nav.getByRole('link', { name: 'Record' })).not.toHaveAttribute('aria-current');
});

test('a printout made without scrolling still has everything on it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  for (const selector of [
    '[data-order]',
    '[data-log-row]',
    '[data-stamp]',
    '[data-heatmap] rect',
  ]) {
    const opacities = await page
      .locator(selector)
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(new Set(opacities), selector).toEqual(new Set(['1']));
  }
  const commits = activity.totals.commits.toLocaleString('en-US');
  await expect(page.locator('[data-count]').first()).toHaveText(commits);
  const statement = page.locator('[data-reveal-words]');
  const colours = await statement
    .locator('span')
    .evaluateAll((words) => words.map((word) => getComputedStyle(word).color));
  expect(new Set(colours)).toEqual(
    new Set([await statement.evaluate((node) => getComputedStyle(node).color)]),
  );
});

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

test('has no serious accessibility violations on a phone, with motion on', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/intro/, { timeout: 8_000 });
  // Read the page the way a person does, so the scan sees it revealed and not mid-animation.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1_500);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(serious.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
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
