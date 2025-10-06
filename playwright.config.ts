import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    ignoreHTTPSErrors: true
  }
})
