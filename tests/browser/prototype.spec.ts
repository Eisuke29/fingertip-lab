import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

const snapshot = (page: Page) => page.evaluate(() => (window as any).__fingertip?.snapshot());
async function open(page: Page, room = 'browser') {
  await page.goto('/?room=' + room);
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'idle');
}
async function lift(page: Page, release = true) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = (await page.locator('#stage canvas').boundingBox())!;
  const state = await snapshot(page);
  const x = box.x + state.guide.x, y = box.y + state.guide.y;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(x, y - state.travel * 0.82 * i / 14); await page.waitForTimeout(20); }
  await expect.poll(async () => (await snapshot(page)).held).toBe(true);
  if (release) { await page.mouse.up(); await expect.poll(async () => (await snapshot(page)).held).toBe(false); }
  return { x, y: y - state.travel * 0.82, box };
}
function sender(room: string) {
  const socket = new WebSocket(`ws://localhost:5173/input?role=tracker&room=${room}`);
  let seq = 0, value = 0, valid = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  const send = () => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'control', version: 1, seq: seq++,
    value, valid, calibrated: true, confidence: 1, source: 'simulation', sentAt: Date.now() })); };
  return { socket, open: () => new Promise<void>(resolve => socket.addEventListener('open', () => { timer = setInterval(send, 30); resolve(); }, { once: true })),
    set: (v: number, ok = true) => { value = v; valid = ok; }, stop: () => clearInterval(timer),
    resume: () => { clearInterval(timer); timer = setInterval(send, 30); }, close: () => { clearInterval(timer); socket.close(); } };
}

test('surface: lift, contact alignment, gain continuity, equal point display, and release', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const target = await lift(page, false);
  let state = await snapshot(page);
  expect(state.product).toEqual(state.tip); expect(state.tip.z).toBeLessThan(0);
  expect(state.rootScreen.x + target.box.x).toBeCloseTo(target.x, 0);
  expect(state.rootScreen.y + target.box.y).toBeCloseTo(target.y, 0);
  const tip = state.tip;
  await page.evaluate(() => {
    const input = document.getElementById('gain') as HTMLInputElement; input.value = '1.25'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(80); expect((await snapshot(page)).tip).toEqual(tip);
  await page.evaluate(() => (document.querySelector('[data-display="point"]') as HTMLButtonElement).click());
  await page.waitForTimeout(80); state = await snapshot(page);
  expect(state.tip).toEqual(tip); expect(state.product).toEqual(tip); expect(state.display).toBe('point');
  await page.mouse.up(); await expect.poll(async () => (await snapshot(page)).phase).toBe('idle');
  expect(errors).toEqual([]);
});

test('mobile DPR 3: real touch, second-pointer rejection, cancellation, and resize', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await open(page, 'mobile');
  const cdp = await context.newCDPSession(page);
  const box = (await page.locator('#stage canvas').boundingBox())!, state = await snapshot(page);
  const x = box.x + state.guide.x, y = box.y + state.guide.y;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - state.travel * 0.8 * i / 12, id: 1 }] });
    await page.waitForTimeout(20);
  }
  await expect.poll(async () => (await snapshot(page)).held).toBe(true);
  const before = await snapshot(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y - state.travel * 0.8, id: 1 }, { x: x + 45, y, id: 2 }] });
  await page.waitForTimeout(70);
  expect((await snapshot(page)).root).toEqual(before.root);
  expect(before.rootScreen.y + box.y).toBeCloseTo(y - state.travel * 0.8, 0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(async () => (await snapshot(page)).held).toBe(false);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await snapshot(page)).phase).toBe('idle');
  await context.close();
});

test('surface does not hook the loop after sliding sideways away from it', async ({ page }) => {
  await open(page, 'lateral-contact');
  const box = (await page.locator('#stage canvas').boundingBox())!, state = await snapshot(page);
  const x = box.x + state.guide.x, y = box.y + state.guide.y;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 110, y, { steps: 5 });
  await page.mouse.move(x + 110, y - state.travel * 0.8, { steps: 10 });
  await page.waitForTimeout(120);
  expect((await snapshot(page)).held).toBe(false);
  await page.mouse.up();
});

test('rear: server input, loss timeout, and neutral recovery without any touch', async ({ page }) => {
  await open(page, 'rear-test'); await page.locator('[data-mode="rear"]').click();
  const input = sender('rear-test'); await input.open();
  try {
    input.set(0.8); await page.waitForTimeout(300); expect((await snapshot(page)).held).toBe(false);
    input.set(0); await expect.poll(async () => (await snapshot(page)).rearStatus).toBe('ready');
    input.set(0.65); await expect.poll(async () => (await snapshot(page)).held).toBe(true);
    let state = await snapshot(page); expect(state.product).toEqual(state.tip); expect(state.tip.z).toBeGreaterThan(0);
    await expect(page.locator('#sim-banner')).toBeVisible();
    input.stop(); await expect.poll(async () => (await snapshot(page)).rearStatus).toBe('lost');
    expect((await snapshot(page)).held).toBe(false);
    input.resume(); await page.waitForTimeout(300); expect((await snapshot(page)).held).toBe(false);
    input.set(0); await expect.poll(async () => (await snapshot(page)).rearStatus).toBe('ready');
    input.set(0.7); await expect.poll(async () => (await snapshot(page)).held).toBe(true);
    input.set(0); await expect.poll(async () => (await snapshot(page)).held).toBe(false);
  } finally { input.close(); }
});

test('two blinded presentations, per-trial ratings, choice, CSV, and reload persistence', async ({ page }) => {
  await open(page, 'comparison'); await page.locator('[data-action="start"]').click();
  await expect(page.locator('#dev-settings')).toBeHidden();
  for (let i = 0; i < 2; i++) {
    await lift(page);
    await page.locator('input[name="ownership"][value="5"]').check();
    await page.locator('#trial-next').click();
  }
  await page.locator('[data-choice="first"]').click();
  await expect(page.locator('#record-count')).toHaveText('1 組');
  const download = page.waitForEvent('download'); await page.locator('#export-csv').click();
  const file = await download; const filename = await file.path(); const csv = await fs.readFile(filename!, 'utf8');
  expect(csv).toContain('ownership_rating_1_7'); expect(csv).toContain('contact'); expect(csv).toContain('release'); expect(csv).toContain('first');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fingertip-lab.session.v1')!));
  expect(saved.trials.filter((trial: any) => trial.completed)).toHaveLength(2);
  expect(saved.trials.every((trial: any) => trial.rating === 5 && trial.contacts.length && trial.releases.length)).toBe(true);
  await page.reload(); await expect(page.locator('#record-count')).toHaveText('1 組');
});

test('a replacement rear sender interrupts a comparison even before the loss timeout', async ({ page }) => {
  await open(page, 'replace-tracker'); await page.locator('[data-mode="rear"]').click();
  await page.locator('[data-action="start"]').click();
  const first = sender('replace-tracker'); await first.open();
  let replacement: ReturnType<typeof sender> | undefined;
  try {
    await expect.poll(async () => (await snapshot(page)).rearStatus).toBe('ready');
    first.set(0.8); await expect.poll(async () => (await snapshot(page)).held).toBe(true);
    const closed = new Promise<void>(resolve => first.socket.addEventListener('close', () => resolve(), { once: true }));
    first.close(); await closed;
    replacement = sender('replace-tracker'); replacement.set(0.8); await replacement.open();
    await expect(page.locator('#comparison-body')).toContainText('入力が中断されました');
    await expect.poll(async () => (await snapshot(page)).held).toBe(false);
    await expect(page.locator('[data-action="retry"]')).toBeVisible();
  } finally { first.close(); replacement?.close(); }
});

test('tracker: simulated input travels through the server; getUserMedia works with a fake test camera', async ({ page }) => {
  const viewer = new WebSocket('ws://localhost:5173/input?role=viewer&room=tracker-test');
  await new Promise<void>(resolve => viewer.addEventListener('open', () => resolve(), { once: true }));
  const packets: any[] = []; viewer.addEventListener('message', event => packets.push(JSON.parse(String(event.data))));
  await page.goto('/tracker?room=tracker-test');
  await page.locator('[data-source="simulation"]').click();
  await page.locator('#simulation-value').fill('0.6');
  await expect.poll(() => packets.some(p => p.source === 'simulation' && p.valid && p.value === 0.6)).toBe(true);
  expect(packets.every(p => !('pixels' in p) && p.streamId)).toBe(true);
  await page.locator('[data-source="camera"]').click(); await page.locator('#start-camera').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tracker?.receivedVideoFrames || 0)).toBeGreaterThan(3);
  await expect(page.locator('#stop-camera')).toBeEnabled();
  await page.locator('#stop-camera').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tracker?.cameraActive)).toBe(false);
  viewer.close();
});

test('synthetic camera frames: three markers, both calibrations, and valid camera data reach the product', async ({ browser }) => {
  // Two rendering contexts plus video processing can be slow with software WebGL.
  test.setTimeout(60000);
  const productContext = await browser.newContext();
  const product = await productContext.newPage();
  await open(product, 'synthetic-camera');
  await product.locator('[data-mode="rear"]').click();
  const trackerContext = await browser.newContext();
  await trackerContext.addInitScript(() => {
    // A controllable MediaStream fixture exercises video -> pixels -> tracking -> server.
    // The separate fake-device test above covers the browser's getUserMedia API itself.
    let angle = 0;
    (window as any).__setSyntheticBend = (value: number) => { angle = value; };
    const getStream = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.fillStyle = '#303b35'; context.fillRect(0, 0, 640, 480);
        const points = [{ x: 140, y: 260 }, { x: 280, y: 260 },
          { x: 280 + Math.cos(angle) * 140, y: 260 - Math.sin(angle) * 140 }];
        ['#e965ad', '#29c4d8', '#f2c94c'].forEach((color, i) => {
          context.fillStyle = color; context.beginPath(); context.arc(points[i].x, points[i].y, 10, 0, Math.PI * 2); context.fill();
        });
      };
      draw(); setInterval(draw, 30);
      return canvas.captureStream(30);
    };
    navigator.mediaDevices.getUserMedia = getStream;
  });
  const tracker = await trackerContext.newPage();
  try {
    await tracker.goto('/tracker?room=synthetic-camera'); await tracker.locator('#start-camera').click();
    await expect(tracker.locator('#record-neutral')).toBeEnabled();
    await tracker.locator('#record-neutral').click();
    await expect(tracker.locator('#record-bent')).toBeEnabled();
    for (let i = 1; i <= 12; i++) {
      await tracker.evaluate(v => (window as any).__setSyntheticBend(v), i / 12);
      await tracker.waitForTimeout(40);
    }
    await tracker.locator('#record-bent').click();
    await expect.poll(() => tracker.evaluate(() => (window as any).__tracker?.calibrated)).toBe(true);
    for (let i = 11; i >= 0; i--) {
      await tracker.evaluate(v => (window as any).__setSyntheticBend(v), i / 12);
      await tracker.waitForTimeout(40);
    }
    await expect.poll(async () => (await snapshot(product)).rearStatus).toBe('ready');
    for (let i = 1; i <= 12; i++) {
      await tracker.evaluate(v => (window as any).__setSyntheticBend(v), i / 12);
      await tracker.waitForTimeout(40);
    }
    await expect.poll(async () => (await snapshot(product)).held).toBe(true);
    const state = await snapshot(product);
    expect(state.source).toBe('camera'); expect(state.product).toEqual(state.tip); expect(state.lift).toBeGreaterThan(18);
    await expect(product.locator('#sim-banner')).toBeHidden();
    for (let i = 11; i >= 0; i--) {
      await tracker.evaluate(v => (window as any).__setSyntheticBend(v), i / 12);
      await tracker.waitForTimeout(40);
    }
    await expect.poll(async () => (await snapshot(product)).held).toBe(false);
  } finally { await trackerContext.close(); await productContext.close(); }
});

test('WebSocket relay isolates rooms, rejects old sequence data and duplicate senders', async () => {
  const connect = (role: string, room: string) => new Promise<WebSocket>(resolve => {
    const ws = new WebSocket(`ws://localhost:5173/input?role=${role}&room=${room}`);
    ws.addEventListener('open', () => resolve(ws), { once: true });
  });
  const viewer = await connect('viewer', 'protocol-test'), other = await connect('viewer', 'other-room');
  const tracker = await connect('tracker', 'protocol-test');
  const frames: any[] = [], otherFrames: any[] = [];
  viewer.addEventListener('message', event => frames.push(JSON.parse(String(event.data))));
  other.addEventListener('message', event => otherFrames.push(JSON.parse(String(event.data))));
  try {
    const base = { type: 'control', version: 1, seq: 10, source: 'simulation', value: 0.5, valid: true, calibrated: true, confidence: 1, sentAt: Date.now() };
    tracker.send(JSON.stringify({ ...base, pixels: 'must not be relayed' }));
    tracker.send(JSON.stringify({ ...base, seq: 9, value: 0.9 }));
    tracker.send(JSON.stringify({ ...base, seq: 11, value: 2 }));
    tracker.send(JSON.stringify({ ...base, seq: 12, value: 0.6 }));
    await expect.poll(() => frames.length).toBe(2);
    expect(frames.map(frame => frame.seq)).toEqual([10, 12]); expect(frames.every(frame => !('pixels' in frame))).toBe(true);
    expect(otherFrames).toHaveLength(0);
    const duplicate = new WebSocket('ws://localhost:5173/input?role=tracker&room=protocol-test');
    const code = await new Promise<number>(resolve => duplicate.addEventListener('close', event => resolve(event.code), { once: true }));
    expect(code).toBe(4003);
  } finally { viewer.close(); other.close(); tracker.close(); }
});

test('ordinary LAN HTTP: product, session IDs, comparison IDs, and host-derived socket work', async ({ page, request }) => {
  const network = await (await request.get('/api/network')).json();
  test.skip(!network.urls.length, 'No LAN interface is available');
  await page.goto(network.urls[0] + '/?room=lan-http');
  await expect.poll(async () => (await snapshot(page))?.phase).toBe('idle');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await expect(page.locator('#connection')).toHaveClass(/connected/);
  await page.locator('[data-action="start"]').click();
  await lift(page);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('fingertip-lab.session.v1')!));
  expect(data.id).toMatch(/^[0-9a-f-]{36}$/); expect(data.pairs[0].id).toBeTruthy(); expect(data.trials[0].contacts.length).toBeGreaterThan(0);
});

test('representative desktop, phone, and tracker layouts', async ({ page, browser }) => {
  await fs.mkdir('artifacts', { recursive: true });
  await open(page, 'screenshots'); await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  await lift(page, false);
  await page.screenshot({ path: 'artifacts/surface-lift.png', fullPage: true });
  await page.mouse.up(); await page.locator('[data-mode="rear"]').click();
  const input = sender('screenshots'); await input.open();
  try {
    await expect.poll(async () => (await snapshot(page)).rearStatus).toBe('ready');
    input.set(0.8); await expect.poll(async () => (await snapshot(page)).held).toBe(true);
    await page.screenshot({ path: 'artifacts/rear-lift.png', fullPage: true });
  } finally { input.close(); }
  await page.goto('/tracker?room=screenshot-tracker'); await page.locator('#start-camera').waitFor();
  await page.screenshot({ path: 'artifacts/tracker.png', fullPage: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await context.newPage(); await open(mobile, 'screen-mobile');
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.screenshot({ path: 'artifacts/mobile.png', fullPage: true }); await context.close();
});
