import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wasm = path.join(root, 'public/vendor/mediapipe');
await fs.mkdir(wasm, { recursive: true });
const source = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
for (const name of await fs.readdir(source)) if (name.endsWith('.js') || name.endsWith('.wasm')) {
  await fs.copyFile(path.join(source, name), path.join(wasm, name));
}
const model = path.join(root, 'public/models/hand_landmarker.task');
try { await fs.access(model); }
catch {
  await fs.mkdir(path.dirname(model), { recursive: true });
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task');
  if (!response.ok) throw new Error(`Hand model download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(model, data);
  console.log(`Saved official Hand Landmarker model (${data.length} bytes)`);
}
const digest = createHash('sha256').update(await fs.readFile(model)).digest('hex');
if (digest !== 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1') throw new Error('Hand Landmarker model checksum mismatch');
