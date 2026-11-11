import { test, expect } from '@playwright/test'

async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'test@example.com')
  await page.fill('input[type="password"]', 'TestPass123!')
  await page.click('button:has-text("sign in")')
  await page.waitForURL('**/system', { timeout: 15_000 })
}

const routes = ['/playground', '/workspaces', '/workflows', '/builder', '/plugins', '/api', '/models', '/status', '/system', '/analytics', '/logs']

for (const route of routes) {
  test(`dev smoke: ${route} renders without unexpected runtime errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('401') && !msg.text().includes('Failed to load resource')) errors.push(msg.text())
    })

    await login(page)
    await page.goto(route, { waitUntil: 'networkidle' })
    await expect(page.locator('body')).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
  })
}
