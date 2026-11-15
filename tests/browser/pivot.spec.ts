import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';

const snapshot = (page: Page) => page.evaluate(() => (window as any).__pivot?.snapshot());
const setRange = async (page: Page, id: string, value: number) => {
  await page.locator('#' + id).evaluate((el, n) => { (el as HTMLInputElement).value = String(n); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
};
async function ready(page: Page, path = '/?dev=1') {
  await page.goto(path); await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await snapshot(page))?.ball).toBeTruthy();
}

test('same renderer: fixed root, separate DIP, static hold, local contact, restoration and back side', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error' && e.text().includes('THREE')) errors.push(e.text()); });
  await ready(page); await page.locator('#use-simulation').check();
  await expect.poll(async () => (await snapshot(page))?.visible).toBe(true);
  const free = await snapshot(page); expect(free.contact).toBeNull(); expect(free.depth).toBe(0);
  // Real size: a desktop previews at iPad density (132 CSS px per inch) and the 25 mm middle phalanx is 25 mm long.
  expect(free.pxPerMm).toBeCloseTo(132 / 25.4, 3);
  expect(Math.hypot(free.dip.x - free.pip.x, free.dip.y - free.pip.y, free.dip.z - free.pip.z) / free.pxPerMm).toBeCloseTo(25, 5);
  await page.screenshot({ path: 'artifacts/pivot-front-free.png' });
  await setRange(page, 'dip', 62);
  await expect.poll(async () => (await snapshot(page))?.depth).toBeGreaterThan(5);
  const pressed = await snapshot(page); expect(pressed.pip).toEqual(free.pip); expect(pressed.dip).toEqual(free.dip); expect(pressed.ball).toEqual(free.ball);
  await expect(page.locator('[data-gain="0.8"]')).toBeDisabled();
  await page.waitForTimeout(350); expect((await snapshot(page)).pad).toEqual(pressed.pad); expect((await snapshot(page)).depth).toBe(pressed.depth);
  await page.screenshot({ path: 'artifacts/pivot-front-press.png' });
  await setRange(page, 'dip', 0); await expect.poll(async () => (await snapshot(page))?.depth).toBeLessThan(0.05);
  await page.locator('[data-gain="1.2"]').click(); await setRange(page, 'dip', 62);
  await expect.poll(async () => (await snapshot(page))?.depth).toBeGreaterThan(pressed.depth);
  const gained = await snapshot(page); expect(gained.pip).toEqual(pressed.pip); expect(gained.dip).toEqual(pressed.dip); expect(gained.lengths).toEqual(pressed.lengths);
  await setRange(page, 'dip', 0); await page.locator('[data-gain="1"]').click();
  await page.locator('[data-scene="release"]').click(); await setRange(page, 'dip', 62); await expect.poll(async () => (await snapshot(page)).contact).toBeTruthy();
  await setRange(page, 'dip', 39); await expect.poll(async () => (await snapshot(page)).contact).toBeTruthy();
  await setRange(page, 'dip', 35); await expect.poll(async () => (await snapshot(page)).thread).toBeTruthy();
  await page.screenshot({ path: 'artifacts/pivot-release.png' });
  await setRange(page, 'dip', 0); await expect.poll(async () => (await snapshot(page)).thread).toBeNull();
  await page.locator('[data-scene="stroke"]').click(); await setRange(page, 'dip', 62); await expect.poll(async () => (await snapshot(page)).contact).toBeTruthy();
  await setRange(page, 'hand-x', -4); await expect.poll(async () => Math.abs((await snapshot(page)).strokeShift.x)).toBeGreaterThan(0.0001);
  expect((await snapshot(page)).ball).toEqual(free.ball);
  await setRange(page, 'dip', 0); await setRange(page, 'hand-x', 0); await page.selectOption('#side', 'back'); await page.locator('[data-scene="press"]').click();
  await setRange(page, 'dip', 62); await expect.poll(async () => (await snapshot(page))?.depth).toBeGreaterThan(5);
  const back = await snapshot(page); expect(back.pip.z).toBeLessThan(0); expect(back.pad.z).toBeGreaterThan(0); expect(back.ball.center.z).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/pivot-back-press.png' }); expect(errors).toEqual([]);
});

test('touch registers PIP once; sliding never drives angles, and tracking loss requires a new contact', async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  const room = 'touch-' + Date.now(); await ready(page, '/?room=' + room);
  const ws = new WebSocket('ws://localhost:5173/input?role=tracker&room=' + room);
  await new Promise<void>(resolve => ws.on('open', () => resolve()));
  let seq = 0, dip = 0;
  const send = () => ws.send(JSON.stringify({ type: 'pose', version: 2, seq: seq++, source: 'simulation', pose: { tiltX: 0, tiltY: 0, dip }, valid: true, calibrated: true, contact: true, axes: 'plane-y', rotation: 0, confidence: 1, sentAt: Date.now() }));
  let timer = setInterval(send, 40);
  try {
    await expect.poll(async () => (await snapshot(page)).tracking).toBe('ready');
    const guide = (await snapshot(page)).guide;
    await page.mouse.move(guide.x, guide.y); await page.mouse.down();
    await expect.poll(async () => (await snapshot(page)).visible).toBe(true);
    const rest = await snapshot(page); await page.mouse.move(guide.x + 32, guide.y - 44);
    expect((await snapshot(page)).pip).toEqual(rest.pip); expect((await snapshot(page)).tip).toEqual(rest.tip);
    dip = 1.08; await expect.poll(async () => (await snapshot(page)).depth).toBeGreaterThan(5);
    await page.screenshot({ path: 'artifacts/pivot-mobile.png' });
    clearInterval(timer); const held = await snapshot(page);
    await page.waitForTimeout(260); expect((await snapshot(page)).tip).toEqual(held.tip); expect((await snapshot(page)).depth).toBe(held.depth);
    await expect.poll(async () => (await snapshot(page)).tracking).toBe('lost');
    await expect.poll(async () => (await snapshot(page)).depth).toBeLessThan(0.1);
    timer = setInterval(send, 40); await expect.poll(async () => (await snapshot(page)).tracking).toBe('ready'); expect((await snapshot(page)).active).toBe(false);
    await page.mouse.up(); dip = 0; send(); await page.mouse.move(guide.x, guide.y); await page.mouse.down();
    await expect.poll(async () => (await snapshot(page)).active).toBe(true); await page.mouse.up();
  } finally { clearInterval(timer); ws.close(); }
  await expect(page.locator('#use-simulation')).toHaveCount(0); await expect(page.getByText('CSV')).toHaveCount(0);
});

test('real MediaPipe runtime starts on camera frames and does not invent a hand in the fake-camera image', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/tracker?room=model-' + Date.now()); await page.locator('#start-camera').click();
  await expect.poll(() => page.evaluate(() => (window as any).__pivotTracker?.snapshot().modelState), { timeout: 60000 }).toBe('ready');
  await expect(page.locator('#stop-camera')).toBeEnabled();
  const state = await page.evaluate(() => (window as any).__pivotTracker.snapshot());
  expect(state.running).toBe(true); expect(state.calibrated).toBe(false); expect(state.frame.valid).toBe(false);
  await page.locator('#stop-camera').click(); await expect(page.locator('#start-camera')).toBeEnabled();
});

test('four colored points travel through video, calibration and WebSocket to the articulated renderer', async ({ page, context }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    (window as any).__markerStage = 'neutral';
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const ctx = canvas.getContext('2d')!;
    const draw = () => {
      const stage = (window as any).__markerStage;
      const pts = [stage === 'down' ? [127, 281] : [120, 240], [240, 240], [330, 200], stage === 'bent' ? [345, 265] : [395, 210]];
      ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, 640, 480);
      pts.forEach((p, i) => { ctx.fillStyle = ['#ff4055', '#4cd36a', '#bc51d9', '#ffffff'][i]; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill(); });
    };
    draw(); setInterval(draw, 30);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(24);
  });
  const room = 'markers-' + Date.now();
  const viewer = await context.newPage(); await ready(viewer, '/?dev=1&room=' + room); await viewer.locator('#dev-advanced summary').click(); await viewer.selectOption('#contact-mode', 'camera');
  // Colour pipeline only (the fake video has no hand; the hand model has its own test above).
  await page.goto('/tracker?handmodel=0&room=' + room); await page.locator('[data-source="markers"]').click(); await page.locator('#start-camera').click();
  await expect.poll(() => page.evaluate(() => (window as any).__pivotTracker.snapshot().points)).toBeTruthy();
  const recordStable = async (kind: string) => expect(async () => { await page.locator(`[data-record="${kind}"]`).click(); await expect(page.locator(`[data-record="${kind}"]`)).toHaveAttribute('aria-pressed', 'true', { timeout: 200 }); }).toPass({ timeout: 15000, intervals: [250, 400] });
  await recordStable('neutral');
  await page.evaluate(() => (window as any).__markerStage = 'down'); await recordStable('down');
  await page.evaluate(() => (window as any).__markerStage = 'bent'); await recordStable('bent');
  await expect.poll(() => page.evaluate(() => (window as any).__pivotTracker.snapshot().calibrated)).toBe(true);
  await expect.poll(async () => (await snapshot(viewer)).tracking).toBe('ready');
  await page.locator('#open-settings').click(); await page.locator('#contact-armed').check();
  await expect.poll(async () => (await snapshot(viewer)).depth).toBeGreaterThan(5);
  expect((await snapshot(viewer)).axes).toBe('plane-y'); expect((await snapshot(viewer)).simulation).toBe(false);
  const pressed = await snapshot(viewer);
  await page.evaluate(() => (window as any).__markerStage = 'neutral');
  await expect.poll(async () => (await snapshot(viewer)).depth).toBeLessThan(0.1);
  expect((await snapshot(viewer)).dip).toEqual(pressed.dip);
  await page.locator('[data-goto="1"]').click(); await page.locator('#stop-camera').click(); await viewer.close();
});
