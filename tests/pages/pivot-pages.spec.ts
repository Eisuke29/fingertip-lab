import { test, expect } from '@playwright/test';

test('published path runs the same pivot renderer and exposes simulation only in development', async ({ page }) => {
  test.setTimeout(45000);
  const sockets: string[] = []; page.on('websocket', s => sockets.push(s.url()));
  await page.goto('./'); await expect(page.locator('#stage canvas')).toBeVisible();
  await expect(page.locator('#input-note')).toContainText('実指入力なし');
  await expect(page.locator('#use-simulation')).toHaveCount(0);
  await page.locator('.adjust-link').click(); await expect(page).toHaveURL(/\/fingertip-lab\/\?dev=1/);
  await page.locator('#use-simulation').check();
  await page.locator('#dip').evaluate(el => { (el as HTMLInputElement).value = '62'; el.dispatchEvent(new Event('input')); });
  await expect.poll(() => page.evaluate(() => (window as any).__pivot?.snapshot().depth)).toBeGreaterThan(5);
  await expect(page.locator('#simulation-badge')).toBeVisible();
  await page.screenshot({ path: 'artifacts/pivot-pages.png' });
  await page.locator('#tracker-link').click(); await expect(page).toHaveURL(/view=tracker/);
  await expect(page.locator('.static-info')).toContainText('PC'); await expect(page.locator('video')).toHaveCount(0);
  expect(sockets.filter(url => url.includes('/input'))).toEqual([]);
});
