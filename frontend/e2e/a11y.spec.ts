import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { createPurchase, dateFromToday, signUp } from './helpers'

// WCAG 2.2 nível AA e as boas práticas do axe.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n` + v.nodes.map((n) => `    ${n.target}`).join('\n'),
  )
  expect.soft(summary, `${label}\n${summary.join('\n')}`).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`acessibilidade (${colorScheme === 'light' ? 'claro' : 'escuro'})`, () => {
    test.use({ colorScheme })

    test('login e registo', async ({ page }) => {
      await page.goto('/entrar')
      await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
      await expectNoViolations(page, 'entrar')

      await page.getByRole('button', { name: 'Ainda não tens conta? Cria uma' }).click()
      await expectNoViolations(page, 'criar conta')

      await page.goto('/recuperar-palavra-passe')
      await expect(page.getByRole('heading', { name: 'Recuperar a palavra-passe' })).toBeVisible()
      await expectNoViolations(page, 'recuperar a palavra-passe')

      await page.goto('/repor-palavra-passe#token=exemplo')
      await expect(page.getByLabel('Nova palavra-passe')).toBeVisible()
      await expectNoViolations(page, 'nova palavra-passe')
    })

    test('painel, formulário, detalhe e conta', async ({ page }) => {
      const { token } = await signUp(page, 'Ana Silva')
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoViolations(page, 'painel vazio')

      const purchase = await createPurchase(page, token, {
        product_name: 'Máquina de lavar',
        store: 'Worten',
        purchase_date: dateFromToday(-35),
        price: '429',
      })
      await createPurchase(page, token, {
        product_name: 'Torradeira',
        store: 'Continente',
        purchase_date: dateFromToday(-48),
        price: '19.99',
      })
      await createPurchase(page, token, {
        product_name: 'Portátil',
        store: 'Fnac',
        purchase_date: dateFromToday(-2),
        price: '899',
      })
      await page.goto('/')
      await expect(page.getByText('Torradeira')).toBeVisible()
      await expectNoViolations(page, 'painel com compras')

      await page.goto('/compras/nova')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoViolations(page, 'nova compra')

      await page.goto(`/compras/${purchase.id}`)
      await expect(page.getByRole('heading', { name: 'Máquina de lavar' })).toBeVisible()
      await expectNoViolations(page, 'detalhe')

      await page.getByLabel('Descreve o problema').fill('Não centrifuga.')
      await page.getByRole('button', { name: 'Gerar reclamação' }).click()
      await expect(page.getByLabel('Texto da reclamação')).toBeVisible()
      await expectNoViolations(page, 'reclamação gerada')

      await page.goto(`/compras/${purchase.id}/editar`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoViolations(page, 'editar compra')

      await page.goto('/conta')
      await expect(page.getByRole('heading', { name: 'A tua conta' })).toBeVisible()
      await expectNoViolations(page, 'conta')
    })
  })
}

test('funciona só com o teclado', async ({ page }) => {
  await signUp(page)
  await page.goto('/')
  await expect(page).toHaveTitle('As tuas garantias · Warrantly')

  // O primeiro Tab mostra o link para saltar a barra de topo.
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Saltar para o conteúdo' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()

  // "+ Nova" abre o formulário e o foco passa para o conteúdo da página nova.
  await page.getByRole('link', { name: '+ Nova' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveTitle('Nova compra · Warrantly')
  await expect(page.locator('main')).toBeFocused()

  // A zona da fatura abre o seletor de ficheiros com o teclado.
  const dropzone = page.getByRole('button', { name: /Arrasta a fatura/ })
  await dropzone.focus()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter'),
  ])
  await chooser.setFiles({
    name: 'fatura.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
  })
  await expect(page.getByRole('button', { name: 'fatura.pdf' })).toBeVisible()
})

test.describe('telemóvel (320 px)', () => {
  test.use({ viewport: { width: 320, height: 640 } })

  test('sem deslocação horizontal e com acesso à conta', async ({ page }) => {
    const { token } = await signUp(page)
    await createPurchase(page, token, {
      product_name: 'Máquina de lavar roupa com um nome comprido',
      store: 'Worten',
      purchase_date: dateFromToday(-35),
      price: '429',
    })
    for (const path of ['/', '/compras/nova', '/conta']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeAttached()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect.soft(overflow, `${path} desloca na horizontal`).toBeLessThanOrEqual(0)
      await expectNoViolations(page, `${path} a 320 px`)
    }

    await page.goto('/')
    await page.getByRole('link', { name: 'Conta', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'A tua conta' })).toBeVisible()
  })
})
