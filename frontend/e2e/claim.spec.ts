import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { createPurchase, dateFromToday, signUp } from './helpers'

const INVOICE = new URL('./fixtures/fatura.pdf', import.meta.url).pathname

test('gera a reclamação, guarda o nome e descarrega o PDF com a fatura', async ({ page }) => {
  const { email, token } = await signUp(page)
  const purchase = await createPurchase(page, token, {
    product_name: 'Máquina de lavar Bosch',
    store: 'Worten',
    purchase_date: dateFromToday(-30),
    price: '429',
  })

  await page.goto(`/compras/${purchase.id}`)
  await page.getByLabel('Fatura', { exact: true }).setInputFiles(INVOICE)
  await page.getByRole('button', { name: 'Guardar fatura' }).click()
  await expect(page.getByText('fatura.pdf')).toBeVisible()

  // Sem nome no perfil: a app pede-o antes de gerar.
  await page.getByLabel(/O teu nome/).fill('José Ferrão')
  await page.getByLabel('Descreve o problema').fill('Não centrifuga e dá o erro E18.')
  await page.getByRole('button', { name: 'Gerar reclamação' }).click()

  const letter = page.getByLabel('Texto da reclamação')
  await expect(letter).toContainText('Exmos. Senhores Worten,')
  await expect(letter).toContainText('Decreto-Lei n.º 84/2021')
  await expect(letter).toContainText('Não centrifuga e dá o erro E18.')
  await expect(letter).toContainText('Junto cópia da fatura de compra.')
  await expect(letter).toContainText(`José Ferrão\n${email}`)
  await expect(page.getByLabel(/O teu nome/)).toHaveCount(0)

  // Enviar pelo email do utilizador: o link já leva o email da loja, o assunto e a carta.
  await page.getByLabel(/Email da loja/).fill('apoio@worten.pt')
  const mailto = await page.getByRole('link', { name: 'Abrir no email' }).getAttribute('href')
  expect(mailto).toMatch(/^mailto:apoio@worten\.pt\?subject=Reclama/)
  expect(decodeURIComponent(mailto!)).toContain('Exmos. Senhores Worten,')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descarregar PDF' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`reclamacao-${purchase.id}.pdf`)
  const pdf = await readFile(await download.path())
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  // Carta + fatura: o PDF final tem de ser maior do que a fatura sozinha.
  expect(pdf.length).toBeGreaterThan((await readFile(INVOICE)).length)
  await expect(page.getByRole('button', { name: 'Descarregado ✓' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('reclamacao.png'), fullPage: true })

  // O nome ficou no perfil: noutra visita já não é pedido.
  await page.reload()
  await expect(page.getByLabel('Descreve o problema')).toBeVisible()
  await expect(page.getByLabel(/O teu nome/)).toHaveCount(0)
})

test('avisa quando a garantia já terminou', async ({ page }) => {
  const { token } = await signUp(page, 'Ana Silva')
  const purchase = await createPurchase(page, token, {
    product_name: 'Torradeira Philips',
    store: 'Continente',
    purchase_date: dateFromToday(-40),
    price: '24.99',
  })

  await page.goto(`/compras/${purchase.id}`)
  await page.getByLabel('Descreve o problema').fill('Não aquece.')
  await page.getByRole('button', { name: 'Gerar reclamação' }).click()

  await expect(page.getByRole('status')).toContainText('A garantia desta compra já terminou')
})
