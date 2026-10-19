import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { createPurchase, dateFromToday, PASSWORD } from './helpers'

// Capturas de ecrã do README (docs/images/). Não correm no CI: `npm run screenshots`.
test.skip(!process.env.SCREENSHOTS, 'só com SCREENSHOTS=1 (npm run screenshots)')

const OUT = new URL('../../docs/images/', import.meta.url).pathname
const INVOICE = new URL('./fixtures/fatura.pdf', import.meta.url).pathname

// Uma conta de exemplo (nome fictício), apagada no fim; não aparece o email de teste e2e-….
const EMAIL = 'ana.silva@exemplo.pt'

async function signIn(page: Page): Promise<string> {
  await page.request.post('/api/auth/register', {
    data: { email: EMAIL, password: PASSWORD, full_name: 'Ana Silva' },
  })
  const login = await page.request.post('/api/auth/login', {
    form: { username: EMAIL, password: PASSWORD },
  })
  const { access_token: token } = (await login.json()) as { access_token: string }
  // Começa sempre do zero (uma corrida anterior pode ter deixado compras).
  const old = (await (
    await page.request.get('/api/purchases', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { id: number }[]
  for (const { id } of old) {
    await page.request.delete(`/api/purchases/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }
  return token // o cookie do login fica no browser, que pede com ele o token de acesso
}

async function seed(page: Page) {
  const token = await signIn(page)
  const purchases = [
    ['Aspirador Dyson V15', 'El Corte Inglés', 'Casa', dateFromToday(-35, -12), '649.00'],
    ['Portátil Lenovo IdeaPad 5', 'Fnac', 'Informática', dateFromToday(-34, -25), '799.99'],
    ['Máquina de lavar Bosch Série 6', 'Worten', 'Eletrodomésticos', dateFromToday(-26), '549.99'],
    ['Frigorífico Samsung RB38', 'Radio Popular', 'Eletrodomésticos', dateFromToday(-14), '899.00'],
    ['iPhone 15', 'Apple', 'Telemóveis', dateFromToday(-5), '979.00'],
    ['Torradeira Philips', 'Continente', 'Cozinha', dateFromToday(-40), '34.99'],
  ] as const
  const ids: number[] = []
  for (const [product_name, store, category, purchase_date, price] of purchases) {
    const { id } = await createPurchase(page, token, {
      product_name,
      store,
      category,
      purchase_date,
      price,
    })
    ids.push(id)
  }
  return { ids, token }
}

test('capturas do README', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 680 })
  const { ids, token } = await seed(page)

  await page.goto('/')
  await expect(page.getByText('Torradeira Philips')).toBeVisible()
  await page.screenshot({ path: `${OUT}painel.png` })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByText('Torradeira Philips')).toBeVisible()
  await page.screenshot({ path: `${OUT}painel-escuro.png` })
  await page.emulateMedia({ colorScheme: 'light' })

  // Nova compra: a fatura é lida e os campos ficam preenchidos.
  await page.goto('/compras/nova')
  await page.getByLabel('Fatura', { exact: true }).setInputFiles(INVOICE)
  await expect(page.getByRole('status').first()).toContainText('Lemos a fatura')
  await page
    .locator('.card', { has: page.getByRole('heading', { name: 'Nova compra' }) })
    .screenshot({ path: `${OUT}nova-compra.png` })

  // Reclamação gerada para a máquina de lavar.
  await page.goto(`/compras/${ids[2]}`)
  await page.getByLabel('Descreve o problema').fill('Não centrifuga e mostra o erro E18 no visor.')
  await page.getByRole('button', { name: 'Gerar reclamação' }).click()
  await expect(page.getByLabel('Texto da reclamação')).toBeVisible()
  await page.locator('section.claim').screenshot({ path: `${OUT}reclamacao.png` })

  // Telemóvel.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('Torradeira Philips')).toBeVisible()
  await page.screenshot({ path: `${OUT}telemovel.png` })

  await page.request.delete('/api/auth/me', {
    data: { password: PASSWORD },
    headers: { Authorization: `Bearer ${token}` },
  })
})
