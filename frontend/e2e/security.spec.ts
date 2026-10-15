import { expect, test } from '@playwright/test'

import { createPurchase, dateFromToday, signUp } from './helpers'

// Contra o servidor de produção (E2E_BASE_URL, como no docker.yml), a CSP está ativa: este
// teste usa as partes principais da app e falha se o browser bloquear alguma coisa.
// Contra o Vite (sem CSP), passa sempre.
test('a app funciona com a Content Security Policy de produção', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP: ${event.violatedDirective} bloqueou ${event.blockedURI}`)
    })
  })

  const { token } = await signUp(page, 'Ana Silva')
  const purchase = await createPurchase(page, token, {
    product_name: 'Máquina de lavar',
    store: 'Worten',
    purchase_date: dateFromToday(-35),
    price: '429',
  })
  await page.request.put(`/api/purchases/${purchase.id}/invoice`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'fatura.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
      },
    },
  })

  // Painel (barras da garantia com estilos inline) e tema guardado (theme-init.js).
  await page.goto('/conta')
  await page.getByLabel('Tema').selectOption('dark')
  await page.goto('/')
  await expect(page.getByRole('progressbar')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')

  // Detalhe, reclamação e PDF.
  await page.getByRole('link', { name: 'Máquina de lavar' }).click()
  await page.getByLabel('Descreve o problema').fill('Não centrifuga.')
  await page.getByRole('button', { name: 'Gerar reclamação' }).click()
  await expect(page.getByLabel('Texto da reclamação')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descarregar PDF' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`reclamacao-${purchase.id}.pdf`)

  expect(errors).toEqual([])
})
