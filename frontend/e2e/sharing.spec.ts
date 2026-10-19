import { expect, test } from '@playwright/test'

import { createPurchase, dateFromToday, lastEmailTo, signUp } from './helpers'

test('partilha o arquivo: o convite chega por email e quem aceita vê as compras', async ({
  browser,
}) => {
  // Duas pessoas, cada uma no seu browser: a Ana partilha, o Rui aceita.
  const ana = await (await browser.newContext()).newPage()
  const rui = await (await browser.newContext()).newPage()
  const owner = await signUp(ana, 'Ana Silva')
  const member = await signUp(rui, 'Rui Silva')
  await createPurchase(ana, owner.token, {
    product_name: 'Frigorífico',
    store: 'Worten',
    purchase_date: dateFromToday(-2),
    price: '899',
  })

  await ana.goto('/conta')
  const sharing = ana.getByRole('region', { name: 'Partilha' })
  await sharing.getByLabel('Email de quem convidas').fill(member.email)
  await sharing.getByRole('button', { name: 'Convidar' }).click()
  await expect(sharing.getByRole('status')).toHaveText(`Convite enviado para ${member.email}.`)
  expect(await lastEmailTo(member.email)).toContain('Ana Silva quer partilhar contigo')

  await rui.goto('/conta')
  await rui.getByRole('button', { name: 'Aceitar o convite de Ana Silva' }).click()
  await expect(rui.getByText('As compras de Ana Silva já aparecem')).toBeVisible()

  await rui.goto('/')
  const row = rui.getByRole('row', { name: /Frigorífico/ })
  await expect(row).toContainText('de Ana Silva')
  await row.getByRole('link', { name: 'Frigorífico' }).click()
  await expect(rui.getByText(/Partilhada por Ana Silva/)).toBeVisible()
  await expect(rui.getByRole('button', { name: 'Apagar compra' })).toHaveCount(0)

  // A Ana deixa de partilhar: o Rui deixa de ver a compra.
  ana.once('dialog', (dialog) => dialog.accept())
  await sharing.getByRole('button', { name: `Remover a partilha com ${member.email}` }).click()
  await expect(sharing.getByRole('status')).toHaveText(`Deixaste de partilhar com ${member.email}.`)
  await rui.goto('/')
  await expect(rui.getByText('Ainda não tens compras registadas')).toBeVisible()
})
