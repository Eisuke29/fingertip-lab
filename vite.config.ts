import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/fingertip-lab/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 650 },
  // Pre-bundle the lazily imported hand model so Vite never reloads the page mid-session
  // when the tracker first imports it (that reload would stop the camera).
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
}));
