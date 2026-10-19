import * as MailComposer from 'expo-mail-composer'
import * as Sharing from 'expo-sharing'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'

import type { Claim, Purchase } from '@/shared/types'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(resetStorage)
afterEach(() => jest.clearAllMocks())

const PURCHASE = makePurchase({
  id: 7,
  store_email: 'apoio@worten.pt',
  invoice_filename: 'fatura.pdf',
  invoice_content_type: 'application/pdf',
})
const CLAIM: Claim = {
  subject: 'Reclamação ao abrigo da garantia: Máquina de lavar Bosch',
  body: 'Exmos. Senhores,\n\nA máquina não centrifuga.\n\nAna',
  within_warranty: true,
}

async function openClaim(
  routes: Record<string, unknown> = {},
  { purchase = PURCHASE, user = USER }: { purchase?: Purchase; user?: typeof USER } = {},
) {
  await signIn()
  const calls = mockApi({
    'GET /auth/me': user,
    'GET /purchases': [purchase],
    'GET /purchases/7': purchase,
    'POST /purchases/7/claim': CLAIM,
    'POST /purchases/7/claim.pdf': '%PDF-1.7',
    ...routes,
  })
  const app = await renderApp('/compras/7')
  await fireEvent.press(await screen.findByRole('button', { name: 'Reclamar à loja' }))
  await waitFor(() => expect(app.getPathname()).toBe('/compras/reclamacao/7'))
  return { app, calls }
}

async function generate(text = 'Não centrifuga.') {
  await fireEvent.changeText(await screen.findByLabelText('Descreve o problema'), text)
  await fireEvent.press(screen.getByRole('button', { name: 'Gerar reclamação' }))
  await screen.findByLabelText('Texto da reclamação')
}

test('gera a carta e envia-a pelo email do telemóvel, com o PDF em anexo', async () => {
  const { calls } = await openClaim()

  await generate()
  expect(screen.getByText(/Reclamação ao abrigo da garantia/)).toBeOnTheScreen()
  expect(screen.getByLabelText('Texto da reclamação')).toHaveTextContent(/não centrifuga/)
  expect(screen.getByLabelText(/^Email da loja/)).toHaveDisplayValue('apoio@worten.pt')
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar por email' }))

  expect(await screen.findByText('Reclamação enviada.')).toBeOnTheScreen()
  expect(MailComposer.composeAsync).toHaveBeenCalledWith({
    recipients: ['apoio@worten.pt'],
    subject: CLAIM.subject,
    body: CLAIM.body,
    attachments: ['file:///cache/reclamacao-7.pdf'],
  })
  // A carta e o PDF usam a mesma descrição.
  const bodies = calls
    .filter((c) => c.method === 'POST' && /\/claim(\.pdf)?$/.test(c.url))
    .map((c) => JSON.parse(c.init.body as string))
  expect(bodies).toEqual([{ description: 'Não centrifuga.' }, { description: 'Não centrifuga.' }])
  // O email da loja não mudou: não há nada para guardar.
  expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
})

test('guarda o email da loja escrito na reclamação', async () => {
  const { calls } = await openClaim({
    'PATCH /purchases/7': (init: RequestInit) => ({
      ...PURCHASE,
      ...JSON.parse(init.body as string),
    }),
  })
  await generate()

  await fireEvent.changeText(screen.getByLabelText(/^Email da loja/), 'garantias@worten.pt')
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar por email' }))

  await screen.findByText('Reclamação enviada.')
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/purchases/7'))!
  expect(JSON.parse(patch.init.body as string)).toEqual({ store_email: 'garantias@worten.pt' })
})

test('sem nome na conta, pede-o para assinar a carta', async () => {
  const unnamed = { ...USER, full_name: null }
  const { calls } = await openClaim(
    { 'PATCH /auth/me': { ...USER, full_name: 'Ana Silva' } },
    { user: unnamed },
  )

  await fireEvent.changeText(await screen.findByLabelText('Descreve o problema'), 'Avariou.')
  await fireEvent.press(screen.getByRole('button', { name: 'Gerar reclamação' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Escreve o teu nome/)

  await fireEvent.changeText(screen.getByLabelText(/^O teu nome/), 'Ana Silva')
  await fireEvent.press(screen.getByRole('button', { name: 'Gerar reclamação' }))

  await screen.findByLabelText('Texto da reclamação')
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/auth/me'))!
  expect(JSON.parse(patch.init.body as string)).toEqual({ full_name: 'Ana Silva' })
  expect(screen.queryByLabelText(/^O teu nome/)).toBeNull() // já não é preciso
})

test('avisa quando a garantia já terminou', async () => {
  await openClaim({ 'POST /purchases/7/claim': { ...CLAIM, within_warranty: false } })

  await generate()

  expect(screen.getByText(/A garantia desta compra já terminou/)).toBeOnTheScreen()
})

test('sem conta de email no telemóvel, partilha o PDF', async () => {
  ;(MailComposer.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false)
  await openClaim()
  await generate()

  await fireEvent.press(screen.getByRole('button', { name: 'Enviar por email' }))

  expect(await screen.findByText(/Não encontrámos uma conta de email/)).toBeOnTheScreen()
  expect(MailComposer.composeAsync).not.toHaveBeenCalled()
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/reclamacao-7.pdf', {
    mimeType: 'application/pdf',
    dialogTitle: 'Enviar a reclamação',
  })
})

test('não envia com um email da loja inválido', async () => {
  const { calls } = await openClaim()
  await generate()

  await fireEvent.changeText(screen.getByLabelText(/^Email da loja/), 'loja@')
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar por email' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('O email da loja não é válido.')
  expect(calls.some((c) => c.url.endsWith('/claim.pdf'))).toBe(false)
})

test('sem descrição não gera nada', async () => {
  const { calls } = await openClaim()

  await fireEvent.press(await screen.findByRole('button', { name: 'Gerar reclamação' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Descreve o problema.')
  expect(calls.some((c) => c.url.endsWith('/claim'))).toBe(false)
})
