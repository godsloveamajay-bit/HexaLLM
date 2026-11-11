import { test } from '@playwright/test'

async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'test@example.com')
  await page.fill('input[type="password"]', 'TestPass123!')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL('**/chat', { timeout: 15_000 })
}

test('production model picker', async ({ page }) => {
  await login(page)
  await page.waitForTimeout(2000)
  const select = page.locator('select:has(optgroup[label="Model Hub"])')
  console.log('count', await select.count())
  if (await select.count()) {
    const val = await select.locator('option').first().getAttribute('value')
    console.log('first', val)
    await select.selectOption(val!)
    await page.waitForTimeout(500)
    console.log('after', await select.inputValue())
  }
})
