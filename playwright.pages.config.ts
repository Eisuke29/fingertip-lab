import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.config';

export default defineConfig({
  ...browserConfig,
  testDir: './tests/pages',
  use: { ...browserConfig.use, baseURL: process.env.PAGES_TEST_URL || 'http://127.0.0.1:4173/fingertip-lab/' },
  webServer: process.env.PAGES_TEST_URL ? undefined : {
    command: 'npm run preview:pages', url: 'http://127.0.0.1:4173/fingertip-lab/', reuseExistingServer: true,
  },
});
