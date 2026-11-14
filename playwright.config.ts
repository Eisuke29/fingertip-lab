import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  expect: { timeout: 5000 }, reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173', viewport: { width: 1365, height: 1050 },
    permissions: ['camera'], screenshot: 'only-on-failure',
    launchOptions: { ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173/api/health', reuseExistingServer: true },
});
