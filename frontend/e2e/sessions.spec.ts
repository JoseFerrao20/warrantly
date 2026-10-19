import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { PASSWORD, uniqueEmail } from './helpers'

async function logIn(page: Page, email: string) {
  await page.goto('/entrar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Palavra-passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Ainda não tens compras registadas')).toBeVisible()
}

test('termina a sessão de outro aparelho a partir da página da conta', async ({ browser }) => {
  const email = uniqueEmail()
  // Dois browsers à parte (cada um com os seus cookies): o portátil e um aparelho perdido.
  const laptop = await (await browser.newContext()).newPage()
  const lost = await (await browser.newContext()).newPage()
  await laptop.request.post('/api/auth/register', { data: { email, password: PASSWORD } })
  await logIn(lost, email)
  await logIn(laptop, email)

  await laptop.getByRole('link', { name: email }).click()
  const section = laptop.getByRole('region', { name: 'Sessões' })
  await expect(section.getByRole('listitem')).toHaveCount(2)
  await expect(section.getByRole('listitem').first()).toContainText('Este aparelho')
  await section.getByRole('button', { name: 'Sair dos outros aparelhos' }).click()
  await expect(section.getByRole('status')).toHaveText('Terminada 1 sessão.')
  await expect(section.getByRole('listitem')).toHaveCount(1)

  // No aparelho perdido, o pedido seguinte já não tem sessão (nem renova pelo cookie).
  await lost.reload()
  await expect(lost.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  // O portátil continua com sessão.
  await laptop.goto('/')
  await expect(laptop.getByText('Ainda não tens compras registadas')).toBeVisible()

  await laptop.context().close()
  await lost.context().close()
})
