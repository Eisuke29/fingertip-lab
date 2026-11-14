import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/fingertip-lab/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 650 },
}));
