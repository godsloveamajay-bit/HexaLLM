import { defineConfig } from '@playwright/test'
import fs from 'node:fs'

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
    launchOptions: {
      executablePath,
      args: ['--no-sandbox', '--disable-gpu'],
    },
  },
  reporter: 'list',
})
