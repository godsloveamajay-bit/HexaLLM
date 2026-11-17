import { test, expect } from '@playwright/test'
test('downloads', async ({ page }) => {
  await page.goto('/downloads')
  await page.waitForTimeout(3000)
  const text = await page.textContent('body')
  console.log('BODY_HAS_DOWNLOADS:', text?.includes('Downloads'))
  console.log('BODY_SNIPPET:', (text || '').slice(0, 300).replace(/\s+/g, ' '))
})
