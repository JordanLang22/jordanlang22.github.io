// Renders the social preview from the real hero, so it can't drift from the site.
// Run `npm run preview` first.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto('http://localhost:4321/');
await page.waitForTimeout(3_200);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
