import { test, expect } from '@playwright/test'

const routes = ['/', '/chat', '/image', '/video', '/models', '/settings', '/login']

for (const route of routes) {
  test(`smoke: ${route} renders without unexpected runtime errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('401')) {
        errors.push(msg.text())
      }
    })

    await page.goto(route, { waitUntil: 'networkidle' })
    await expect(page.locator('body')).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
  })
}

async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'test@example.com')
  await page.fill('input[type="password"]', 'TestPass123!')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL('**/chat', { timeout: 15_000 })
}

test('chat composer is available', async ({ page }) => {
  await login(page)
  await expect(page.locator('textarea').first()).toBeVisible()
})

test('image prompt composer is available', async ({ page }) => {
  await login(page)
  await page.goto('/image')
  await expect(page.locator('textarea').first()).toBeVisible()
})
