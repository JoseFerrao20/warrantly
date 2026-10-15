import { expect, test } from '@playwright/test'

import { PASSWORD, createPurchase, dateFromToday, signUp } from './helpers'

test('apaga a conta e deixa de conseguir entrar', async ({ page }) => {
  const { email, token } = await signUp(page)
  await createPurchase(page, token, {
    product_name: 'TV',
    store: 'Fnac',
    purchase_date: dateFromToday(-1),
    price: '399',
  })

  await page.goto('/')
  await page.getByRole('link', { name: email }).click()
  await expect(page.getByRole('heading', { name: 'A tua conta' })).toBeVisible()

  await page.getByLabel(/Palavra-passe/).fill('errada-123')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Apagar conta' }).click()
  await expect(page.getByRole('alert')).toHaveText('Palavra-passe incorreta')

  await page.getByLabel(/Palavra-passe/).fill(PASSWORD)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Apagar conta' }).click()
  await expect(page.getByRole('status')).toHaveText('A tua conta foi apagada.')

  const login = await page.request.post('/api/auth/login', {
    form: { username: email, password: PASSWORD },
  })
  expect(login.status()).toBe(401)
})
