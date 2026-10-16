import { expect, test } from '@playwright/test'

import { lastEmailTo, PASSWORD, uniqueEmail } from './helpers'

test('cria conta, sai e volta a entrar', async ({ page }) => {
  const email = uniqueEmail()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()

  await page.getByRole('button', { name: /Cria uma/ }).click()
  await page.getByLabel(/^Nome/).fill('Ana Silva')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Palavra-passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()

  await page.getByLabel('Email').fill(email.toUpperCase())
  await page.getByLabel('Palavra-passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()
})

test('mostra erro com a palavra-passe errada', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Palavra-passe').fill('nao-e-esta')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByRole('alert')).toHaveText('Email ou palavra-passe incorretos')
})

test('uma página protegida sem sessão leva ao login e volta depois de entrar', async ({ page }) => {
  const email = uniqueEmail()
  await page.request.post('/api/auth/register', { data: { email, password: PASSWORD } })

  await page.goto('/compras/nova')
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Palavra-passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByRole('heading', { name: 'Nova compra' })).toBeVisible()
})

test('com o token de acesso expirado, a sessão renova-se pelo cookie', async ({ page, context }) => {
  const email = uniqueEmail()
  await page.request.post('/api/auth/register', { data: { email, password: PASSWORD } })
  await page.goto('/entrar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Palavra-passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()

  // O refresh token está num cookie que o JavaScript não lê, só enviado para /api/auth.
  const [cookie] = (await context.cookies()).filter((c) => c.name === 'warrantly_refresh')
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' })
  expect(await page.evaluate(() => document.cookie)).not.toContain('warrantly_refresh')

  // Passados 15 minutos, o token de acesso já não serve: aqui, estragamo-lo.
  await page.evaluate(() => localStorage.setItem('warrantly.token', 'expirado'))
  await page.reload()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('warrantly.token'))).not.toBe('expirado')

  // Depois de sair, o cookie já não renova nada.
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await expect.poll(async () => (await page.request.post('/api/auth/refresh')).status()).toBe(401)
})

test('recupera a palavra-passe com o link do email', async ({ page }) => {
  const email = uniqueEmail()
  await page.request.post('/api/auth/register', { data: { email, password: PASSWORD } })

  await page.goto('/entrar')
  await page.getByRole('link', { name: 'Esqueci-me da palavra-passe' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await expect(page.getByRole('status')).toContainText('Se existir uma conta com este email')

  // O link aponta para o APP_URL do servidor (o Vite em desenvolvimento, o contentor no CI).
  const link = (await lastEmailTo(email)).match(/https?:\/\/\S+(\/repor-palavra-passe#token=[\w.-]+)/)
  expect(link).not.toBeNull()

  await page.goto(link![1])
  await expect(page).toHaveURL(/\/repor-palavra-passe$/) // o token sai da barra de endereço
  await page.getByLabel('Nova palavra-passe').fill('uma-palavra-passe-nova')
  await page.getByLabel('Repetir a palavra-passe').fill('uma-palavra-passe-nova')
  await page.getByRole('button', { name: 'Guardar palavra-passe' }).click()
  await expect(page.getByRole('status')).toHaveText('A palavra-passe foi alterada. Entra com a nova.')

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Palavra-passe').fill('uma-palavra-passe-nova')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()

  // O mesmo link já não serve.
  await page.goto(link![1])
  await page.getByLabel('Nova palavra-passe').fill('mais-uma-palavra-passe')
  await page.getByLabel('Repetir a palavra-passe').fill('mais-uma-palavra-passe')
  await page.getByRole('button', { name: 'Guardar palavra-passe' }).click()
  await expect(page.getByRole('alert')).toContainText('O link é inválido ou já expirou.')
})
