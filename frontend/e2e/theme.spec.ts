import { expect, test } from '@playwright/test'

import { signUp } from './helpers'

const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test.use({ colorScheme: 'dark' })

test('segue o modo escuro do sistema e lembra-se da escolha "Claro"', async ({ page }) => {
  await signUp(page)
  await page.goto('/conta')

  await expect(page.getByLabel('Tema')).toHaveValue('system')
  expect(await background(page)).toBe('rgb(17, 23, 29)') // fundo escuro

  await page.getByLabel('Tema').selectOption('light')
  expect(await background(page)).toBe('rgb(255, 255, 255)')

  // A escolha fica guardada e aplica-se logo ao carregar a página.
  await page.reload()
  await expect(page.getByLabel('Tema')).toHaveValue('light')
  expect(await background(page)).toBe('rgb(255, 255, 255)')
})
