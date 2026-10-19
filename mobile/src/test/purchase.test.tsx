import { File } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'
import { Alert } from 'react-native'
import type { AlertButton } from 'react-native'

import type { Purchase } from '@/shared/types'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(resetStorage)
afterEach(() => jest.restoreAllMocks())

const WITH_INVOICE = makePurchase({
  id: 7,
  invoice_filename: 'Fatura Worten.pdf',
  invoice_content_type: 'application/pdf',
  invoice_size: 1234,
})

/** Responde ao Alert como se a pessoa carregasse no botão com este texto. */
function answerAlert(text: string) {
  return jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.text === text)?.onPress?.()
    })
}

async function openPurchase(purchase: Purchase, routes: Record<string, unknown> = {}) {
  await signIn()
  const calls = mockApi({
    'GET /auth/me': USER,
    'GET /purchases': [purchase],
    [`GET /purchases/${purchase.id}`]: purchase,
    ...routes,
  })
  const app = await renderApp(`/compras/${purchase.id}`)
  await screen.findByText(purchase.store)
  return { app, calls }
}

// --- Ver a fatura ---------------------------------------------------------------------------

test('descarrega a fatura com o token e abre-a no telemóvel', async () => {
  const { calls } = await openPurchase(WITH_INVOICE)

  await fireEvent.press(screen.getByRole('button', { name: 'Ver a fatura' }))

  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled())
  const download = File.downloadFileAsync as jest.Mock
  const [url, destination, options] = download.mock.calls[0]
  expect(url).toMatch(/\/purchases\/7\/invoice$/)
  expect(destination.uri).toBe('file:///cache/fatura-7.pdf') // nunca o nome original
  expect(options).toEqual({ headers: { Authorization: 'Bearer token-de-teste' }, idempotent: true })
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/fatura-7.pdf', {
    mimeType: 'application/pdf',
    dialogTitle: 'Abrir a fatura',
  })
  // Antes do download, um pedido à API renova o token se já tiver expirado.
  expect(calls.filter((c) => c.url.endsWith('/auth/me')).length).toBeGreaterThanOrEqual(2)
})

test('sem fatura, não há botão para a ver', async () => {
  await openPurchase(makePurchase({ id: 7 }))

  expect(screen.queryByRole('button', { name: 'Ver a fatura' })).toBeNull()
  expect(screen.getByText('Sem fatura')).toBeOnTheScreen()
})

test('se o download falhar, mostra o erro', async () => {
  ;(File.downloadFileAsync as jest.Mock).mockRejectedValueOnce(new Error('rede'))
  await openPurchase(WITH_INVOICE)

  await fireEvent.press(screen.getByRole('button', { name: 'Ver a fatura' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Não foi possível descarregar a fatura. Tenta outra vez.',
  )
})

// --- Editar -----------------------------------------------------------------------------------

test('edita a compra e o detalhe mostra os dados novos', async () => {
  let current = makePurchase({ id: 7, category: 'Eletrodomésticos' })
  const { app, calls } = await openPurchase(current, {
    'GET /purchases/7': () => current,
    'PATCH /purchases/7': (init: RequestInit) => {
      current = { ...current, ...JSON.parse(init.body as string) }
      return current
    },
  })

  await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
  await waitFor(() => expect(app.getPathname()).toBe('/compras/editar/7'))
  const price = await screen.findByLabelText('Preço (€)')
  expect(price).toHaveDisplayValue('429,00')
  await fireEvent.changeText(price, '399,90')
  await fireEvent.changeText(screen.getByLabelText(/^Email da loja/), 'apoio@worten.pt')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar alterações' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/7'))
  expect(await screen.findByText('399,90 €')).toBeOnTheScreen()
  expect(screen.getByText('apoio@worten.pt')).toBeOnTheScreen()
  const patch = calls.find((c) => c.method === 'PATCH')!
  expect(JSON.parse(patch.init.body as string)).toMatchObject({
    price: '399.90',
    store_email: 'apoio@worten.pt',
    category: 'Eletrodomésticos', // a app não a mostra, mas não a apaga
  })
})

test('não guarda uma edição inválida', async () => {
  const { calls } = await openPurchase(makePurchase({ id: 7 }))

  await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
  await fireEvent.changeText(await screen.findByLabelText(/^Email da loja/), 'isto não é email')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar alterações' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('O email da loja não é válido.')
  expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
})

// --- Apagar -----------------------------------------------------------------------------------

test('apaga a compra depois de confirmar e volta ao painel', async () => {
  answerAlert('Apagar')
  const { app, calls } = await openPurchase(makePurchase({ id: 7 }), {
    'DELETE /purchases/7': { status: 204, body: null },
  })

  await fireEvent.press(screen.getByRole('button', { name: 'Apagar' }))

  await waitFor(() => expect(app.getPathname()).toBe('/'))
  expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/purchases/7'))).toBe(true)
})

test('cancelar não apaga nada', async () => {
  answerAlert('Cancelar')
  const { app, calls } = await openPurchase(makePurchase({ id: 7 }))

  await fireEvent.press(screen.getByRole('button', { name: 'Apagar' }))

  expect(Alert.alert).toHaveBeenCalled()
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  expect(app.getPathname()).toBe('/compras/7')
})
