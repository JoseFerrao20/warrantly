import { readFile } from 'node:fs/promises'

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

test('exporta as compras e as faturas num ZIP', async ({ page }) => {
  const { email, token } = await signUp(page)
  const purchase = await createPurchase(page, token, {
    product_name: 'Televisão',
    store: 'Fnac',
    purchase_date: dateFromToday(-1),
    price: '399',
  })
  const upload = await page.request.put(`/api/purchases/${purchase.id}/invoice`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'fatura.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
      },
    },
  })
  expect(upload.status()).toBe(200)

  await page.goto('/')
  await page.getByRole('link', { name: email }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descarregar ZIP' }).click(),
  ])

  expect(download.suggestedFilename()).toMatch(/^warrantly-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByRole('status')).toHaveText('Descarregado.')
  const zip = await readFile(await download.path())
  expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
  // Os nomes dos ficheiros ficam por comprimir no índice do ZIP.
  const names = zip.toString('latin1')
  expect(names).toContain('compras.csv')
  expect(names).toContain('compras.json')
  expect(names).toContain(`faturas/${purchase.id}-televisao.pdf`)
})
