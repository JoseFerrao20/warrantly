import { expect, test } from '@playwright/test'

import { PASSWORD, uniqueEmail } from './helpers'

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
