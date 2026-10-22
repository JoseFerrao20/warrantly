import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

import { confirmEmail, createPurchase, dateFromToday, PASSWORD } from './helpers'

// Capturas de ecrã do README (docs/images/). Não correm no CI: `npm run screenshots`.
test.skip(!process.env.SCREENSHOTS, 'só com SCREENSHOTS=1 (npm run screenshots)')

const OUT = new URL('../../docs/images/', import.meta.url).pathname
// Uma fatura com o código QR da AT: a leitura preenche também a data, o n.º e o NIF da loja.
const INVOICE = new URL('./fixtures/fatura-qr.pdf', import.meta.url).pathname

// Uma conta de exemplo (nome fictício), apagada no fim; não aparece o email de teste e2e-….
const EMAIL = 'ana.silva@exemplo.pt'
// A família da Ana, para a partilha: o Rui partilha o arquivo com ela, e ela com o Rui e a Maria.
const FAMILY_EMAIL = 'rui.silva@exemplo.pt'
const PENDING_EMAIL = 'maria.silva@exemplo.pt'

// O browser das capturas passa por um Chrome no Windows (na lista de sessões da conta).
test.use({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/141.0.0.0 Safari/537.36',
})

async function signIn(page: Page): Promise<string> {
  await page.request.post('/api/auth/register', {
    data: { email: EMAIL, password: PASSWORD, full_name: 'Ana Silva' },
  })
  const login = await page.request.post('/api/auth/login', {
    form: { username: EMAIL, password: PASSWORD },
  })
  const { access_token: token } = (await login.json()) as { access_token: string }
  // Numa corrida anterior, a conta já pode existir e estar confirmada (409); senão, confirma.
  const resend = await page.request.post('/api/auth/verify-email/resend', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (resend.status() !== 409) await confirmEmail(page, EMAIL)
  // Começa sempre do zero (uma corrida anterior pode ter deixado compras).
  const old = (await (
    await page.request.get('/api/purchases', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { id: number }[]
  for (const { id } of old) {
    await page.request.delete(`/api/purchases/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }
  const sharing = (await (
    await page.request.get('/api/sharing', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { members: { id: number }[] }
  for (const { id } of sharing.members) {
    await page.request.delete(`/api/sharing/${id}`, {
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

/**
 * O Rui, com uma compra, partilha o arquivo com a Ana, que aceita; a Ana partilha o dela com o
 * Rui (aceite) e com a Maria (ainda por aceitar). O Rui entra pelo `request`, que tem os seus
 * próprios cookies: o browser continua com a sessão da Ana.
 */
async function seedFamily(page: Page, request: APIRequestContext, anaToken: string) {
  const login = () =>
    request.post('/api/auth/login', { form: { username: FAMILY_EMAIL, password: PASSWORD } })
  let response = await login()
  if (response.ok()) {
    // Ficou de uma corrida anterior: começa do zero.
    const { access_token: old } = (await response.json()) as { access_token: string }
    await request.delete('/api/auth/me', {
      data: { password: PASSWORD },
      headers: { Authorization: `Bearer ${old}` },
    })
  }
  await request.post('/api/auth/register', {
    data: { email: FAMILY_EMAIL, password: PASSWORD, full_name: 'Rui Silva' },
  })
  await confirmEmail(page, FAMILY_EMAIL)
  response = await login()
  const { access_token: rui } = (await response.json()) as { access_token: string }
  await createPurchase(page, rui, {
    product_name: 'Televisão LG OLED 55',
    store: 'Worten',
    category: 'Televisões',
    purchase_date: dateFromToday(-31, -20),
    price: '1199.00',
  })
  const ana = { Authorization: `Bearer ${anaToken}` }
  const invite = async (from: string, email: string) =>
    (await (
      await page.request.post('/api/sharing', {
        data: { email },
        headers: { Authorization: `Bearer ${from}` },
      })
    ).json()) as { id: number }
  const fromRui = await invite(rui, EMAIL)
  await page.request.post(`/api/sharing/${fromRui.id}/accept`, { headers: ana })
  const toRui = await invite(anaToken, FAMILY_EMAIL)
  await page.request.post(`/api/sharing/${toRui.id}/accept`, {
    headers: { Authorization: `Bearer ${rui}` },
  })
  await invite(anaToken, PENDING_EMAIL)
  return rui
}

test('capturas do README', async ({ page, request }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 680 })
  const { ids, token } = await seed(page)
  const ruiToken = await seedFamily(page, request, token)

  await page.goto('/')
  await expect(page.getByText('Torradeira Philips')).toBeVisible()
  await expect(page.getByText('de Rui Silva')).toBeVisible() // a compra do arquivo do Rui
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

  // Conta: outros aparelhos com sessão aberta. Entram pelo `request`, que não partilha os
  // cookies com o browser (este continua a ser "Este aparelho").
  await request.post('/api/auth/login', {
    form: { username: EMAIL, password: PASSWORD },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    },
  })
  await request.post('/api/auth/login', {
    form: { username: EMAIL, password: PASSWORD },
    headers: { 'X-Client': 'mobile', 'X-Device-Name': 'Pixel 8 (Android)' },
  })
  await page.goto('/conta')
  const sessions = page.getByRole('region', { name: 'Sessões' })
  await expect(sessions.getByRole('listitem')).toHaveCount(3)
  await sessions.screenshot({ path: `${OUT}conta.png` })

  // Partilha: o arquivo do Rui partilhado com a Ana, e o dela com o Rui e a Maria.
  const sharing = page.getByRole('region', { name: 'Partilha' })
  await expect(sharing.getByText('Ainda não aceitou')).toBeVisible()
  await sharing.screenshot({ path: `${OUT}partilha.png` })

  // Telemóvel.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('Torradeira Philips')).toBeVisible()
  await page.screenshot({ path: `${OUT}telemovel.png` })

  for (const owner of [token, ruiToken]) {
    await page.request.delete('/api/auth/me', {
      data: { password: PASSWORD },
      headers: { Authorization: `Bearer ${owner}` },
    })
  }
})
