import { test, expect, type Page } from '@playwright/test';

async function lift(page: Page) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const guide = (await page.locator('#start-guide').boundingBox())!;
  const stage = (await page.locator('#stage').boundingBox())!;
  const x = guide.x + guide.width / 2, y = guide.y + guide.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y - Math.min(100, stage.height * 0.2) * i / 12);
    await page.waitForTimeout(20);
  }
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'lifted');
  await page.mouse.up();
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'idle');
}

test('published subpath: lifting, blinded comparison, persistence, and CSV', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('[data-mode="rear"]')).toBeDisabled();
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('#dev-settings')).toBeHidden();
  for (let trial = 0; trial < 2; trial++) {
    await lift(page);
    await page.locator('input[name="ownership"][value="4"]').check();
    await page.locator('#trial-next').click();
  }
  await page.locator('[data-choice="same"]').click();
  await expect(page.locator('#record-count')).toHaveText('1 組');
  await expect(page.locator('[data-mode="rear"]')).toBeDisabled();
  const download = page.waitForEvent('download'); await page.locator('#export-csv').click();
  expect((await download).suggestedFilename()).toMatch(/^fingertip-.*\.csv$/);
  await page.reload(); await expect(page.locator('#record-count')).toHaveText('1 組');
});

test('static demo links stay under the repo path and do not contact a nonexistent backend', async ({ page }) => {
  const errors: string[] = [], sockets: string[] = [], apiRequests: string[] = [], broken: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  page.on('response', response => { if (response.status() >= 400) broken.push(response.url()); });
  await page.goto('./'); await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('link', { name: 'PC 追跡画面 ↗' }).click();
  await expect(page.getByRole('heading', { name: '背面の操作は、PCで。' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/fingertip-lab/');
  await expect(page.getByRole('button', { name: 'カメラを起動' })).toHaveCount(0);
  await page.getByRole('link', { name: '表面タッチのデモへ戻る →' }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'idle');
  expect(errors).toEqual([]); expect(sockets).toEqual([]); expect(apiRequests).toEqual([]); expect(broken).toEqual([]);
});
