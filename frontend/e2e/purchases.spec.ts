import { statSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { createPurchase, dateFromToday, signUp } from './helpers'

const INVOICE = new URL('./fixtures/fatura.pdf', import.meta.url).pathname

test('regista uma compra com fatura e vê-a no painel', async ({ page }) => {
  await signUp(page)
  await page.goto('/')
  await page.getByRole('link', { name: '+ Nova' }).click()

  await page.getByLabel('Produto').fill('Portátil Lenovo IdeaPad 5')
  await page.getByLabel('Loja').fill('Fnac')
  await page.getByLabel('Preço (€)').fill('749,99')
  await page.getByLabel('Data de compra').fill('2026-02-14')
  await expect(page.getByText('14 de fevereiro de 2029')).toBeVisible()
  await page.getByLabel(/N\.º da fatura/).fill('FT 2026/77')
  await page.getByLabel('Fatura', { exact: true }).setInputFiles(INVOICE)
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByRole('heading', { name: 'Portátil Lenovo IdeaPad 5' })).toBeVisible()
  await expect(page.getByText('Fim: 14/02/2029')).toBeVisible()
  await expect(page.getByText('fatura.pdf')).toBeVisible()
  await expect(page.getByText('FT 2026/77')).toBeVisible()

  // "Ver fatura" vai buscar o ficheiro (com o token) e abre-o noutro separador. Não esperamos
  // pela página do PDF: o Chromium headless do CI não tem visualizador e trata-o como download.
  const [tab, invoice] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((r) => r.url().endsWith('/invoice') && r.request().method() === 'GET'),
    page.getByRole('button', { name: 'Ver fatura' }).click(),
  ])
  expect(invoice.status()).toBe(200)
  expect(invoice.headers()['content-type']).toBe('application/pdf')
  expect(Number(invoice.headers()['content-length'])).toBe(statSync(INVOICE).size)
  await tab.close()

  await page.getByRole('link', { name: '← Garantias' }).click()
  const row = page.getByRole('row', { name: /Portátil Lenovo IdeaPad 5/ })
  await expect(row).toContainText('Fnac')
  await expect(page.getByRole('button', { name: /Ativas\s*1/ })).toBeVisible()
})

test('edita e apaga uma compra', async ({ page }) => {
  const { token } = await signUp(page)
  const purchase = await createPurchase(page, token, {
    product_name: 'Auscultadores Sony',
    store: 'Amazon',
    purchase_date: dateFromToday(-2),
    price: '199.90',
  })

  await page.goto(`/compras/${purchase.id}`)
  await page.getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByLabel('Preço (€)')).toHaveValue('199,90')
  await page.getByLabel('Loja').fill('Worten')
  await page.getByLabel('Garantia').selectOption('24')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText(/^Worten · comprada a/)).toBeVisible()
  await expect(page.getByText('2 anos desde a compra')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Apagar compra' }).click()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()
})

test('o painel filtra por estado e pesquisa', async ({ page }) => {
  const { token } = await signUp(page)
  const base = { price: '10', warranty_months: 36 }
  await createPurchase(page, token, {
    ...base,
    product_name: 'Máquina de lavar Bosch',
    store: 'Worten',
    purchase_date: dateFromToday(-36, 20),
  })
  await createPurchase(page, token, {
    ...base,
    product_name: 'Portátil Lenovo',
    store: 'Fnac',
    purchase_date: dateFromToday(-8),
  })
  await createPurchase(page, token, {
    ...base,
    product_name: 'Torradeira Philips',
    store: 'Continente',
    purchase_date: dateFromToday(-40),
  })

  await page.goto('/')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  // As expiradas ficam no fim.
  await expect(rows.last()).toContainText('Torradeira Philips')
  await expect(rows.last()).toContainText('expirada')
  await expect(rows.first()).toContainText(/expira em 2\d d/)

  await page.getByRole('button', { name: /A expirar/ }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Máquina de lavar Bosch')
  await expect(page).toHaveURL(/estado=expiring/)

  await page.getByRole('button', { name: /A expirar/ }).click()
  await page.getByRole('searchbox', { name: 'Pesquisar compras' }).fill('maquina')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Máquina de lavar Bosch')
})

test('recusa uma fatura que não é PDF nem imagem', async ({ page }) => {
  const { token } = await signUp(page)
  const purchase = await createPurchase(page, token, {
    product_name: 'TV',
    store: 'Fnac',
    purchase_date: dateFromToday(-1),
    price: '399',
  })
  await page.goto(`/compras/${purchase.id}`)
  // Um ".pdf" que é afinal HTML: a API reconhece o tipo pelo conteúdo e recusa-o.
  await page.getByLabel('Fatura', { exact: true }).setInputFiles({
    name: 'nao-e-pdf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html>nada</html>'),
  })
  await page.getByRole('button', { name: 'Guardar fatura' }).click()

  await expect(page.getByRole('alert')).toContainText('A fatura tem de ser um PDF ou uma imagem')
})

test('aceita uma fotografia HEIC (iPhone) e guarda-a como JPEG', async ({ page }) => {
  const { token } = await signUp(page)
  const purchase = await createPurchase(page, token, {
    product_name: 'Frigorífico',
    store: 'Worten',
    purchase_date: dateFromToday(-1),
    price: '899',
  })

  await page.goto(`/compras/${purchase.id}`)
  await page
    .getByLabel('Fatura', { exact: true })
    .setInputFiles(new URL('./fixtures/foto-fatura.heic', import.meta.url).pathname)
  await page.getByRole('button', { name: 'Guardar fatura' }).click()

  await expect(page.getByText('foto-fatura.jpg')).toBeVisible()
  const [, invoice] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((r) => r.url().endsWith('/invoice') && r.request().method() === 'GET'),
    page.getByRole('button', { name: 'Ver fatura' }).click(),
  ])
  expect(invoice.headers()['content-type']).toBe('image/jpeg')
})
