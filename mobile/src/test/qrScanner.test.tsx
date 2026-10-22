import * as Camera from 'expo-camera'
import { Linking } from 'react-native'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'

import type { InvoiceScan } from '@/shared/types'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

const QR =
  'A:503630330*B:999999990*C:PT*D:FR*E:N*F:20231105*G:FR 0123/456790*H:JJ3XY2KD-456790' +
  '*I1:PT*I7:398.37*I8:91.63*N:91.63*O:490.00*Q:Ab1z*R:1234'
const SCAN: InvoiceScan = {
  text_found: true,
  ocr_available: true,
  product_name: null,
  store: null,
  purchase_date: '2023-11-05',
  price: '490.00',
  invoice_number: 'FR 0123/456790',
  store_email: null,
}
const NOT_AN_INVOICE = /Encontrei um código QR, mas não é de uma fatura/

const camera = Camera as unknown as {
  __setPermission: (value: { granted: boolean; canAskAgain: boolean }) => void
}

beforeEach(async () => {
  resetStorage()
  jest.clearAllMocks()
  await signIn()
})

afterEach(() => camera.__setPermission({ granted: true, canAskAgain: true }))

async function openScanner() {
  const app = await renderApp('/compras/nova')
  await fireEvent.press(await screen.findByRole('button', { name: 'Ler o código QR' }))
  return app
}

async function scanCode(data: string) {
  await fireEvent(screen.getByTestId('qr-camera'), 'barcodeScanned', { type: 'qr', data })
}

function qrCalls<T extends { url: string }>(calls: T[]): T[] {
  return calls.filter((c) => c.url.endsWith('/purchases/scan-qr'))
}

test('ler o QR preenche a data, o preço e o n.º, sem mexer no que já foi escrito', async () => {
  const calls = mockApi({
    'GET /auth/me': USER,
    'POST /purchases/scan-qr': SCAN,
    'POST /purchases': makePurchase({ id: 9 }),
    'GET /purchases/9': makePurchase({ id: 9 }),
  })
  const app = await renderApp('/compras/nova')
  await fireEvent.changeText(await screen.findByLabelText('Preço (€)'), '500')
  await fireEvent.press(screen.getByRole('button', { name: 'Ler o código QR' }))

  await scanCode(QR)

  expect(await screen.findByText(/Lemos o código QR/)).toBeOnTheScreen()
  expect(screen.queryByTestId('qr-camera')).toBeNull()
  expect(qrCalls(calls)).toHaveLength(1)
  expect(JSON.parse(qrCalls(calls)[0].init.body as string)).toEqual({ text: QR })
  expect(screen.getByLabelText('Data da compra (AAAA-MM-DD)')).toHaveDisplayValue('2023-11-05')
  expect(screen.getByLabelText('Preço (€)')).toHaveDisplayValue('500') // já escrito
  expect(screen.getByLabelText('N.º da fatura (opcional)')).toHaveDisplayValue('FR 0123/456790')

  await fireEvent.changeText(screen.getByLabelText('Produto'), 'Máquina de lavar')
  await fireEvent.changeText(screen.getByLabelText('Loja', { exact: true }), 'Worten')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/9'))
  const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/purchases'))!
  expect(JSON.parse(created.init.body as string)).toMatchObject({
    product_name: 'Máquina de lavar',
    store: 'Worten',
    purchase_date: '2023-11-05',
    price: '500',
    invoice_number: 'FR 0123/456790',
  })
  expect(calls.some((c) => c.url.includes('/invoice'))).toBe(false) // o QR não é a fatura
})

test('um QR que não é de uma fatura dá um aviso e a câmara continua à procura', async () => {
  const calls = mockApi({
    'GET /auth/me': USER,
    'POST /purchases/scan-qr': {
      status: 422,
      body: { detail: 'Este código QR não é de uma fatura' },
    },
  })
  await openScanner()

  await scanCode('https://www.worten.pt/promocoes')
  expect(await screen.findByText(NOT_AN_INVOICE)).toBeOnTheScreen()
  expect(qrCalls(calls)).toHaveLength(0) // nem chega à API

  await scanCode(QR.replace('D:FR', 'D:NC')) // nota de crédito: a API recusa
  expect(await screen.findByText(NOT_AN_INVOICE)).toBeOnTheScreen()
  await scanCode(QR.replace('D:FR', 'D:NC')) // a câmara vê o mesmo QR várias vezes seguidas
  expect(qrCalls(calls)).toHaveLength(1)
  expect(screen.getByTestId('qr-camera')).toBeOnTheScreen()

  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByTestId('qr-camera')).toBeNull()
  expect(screen.getByLabelText('N.º da fatura (opcional)')).toHaveDisplayValue('')
})

test('sem rede, o mesmo QR pode ser lido outra vez', async () => {
  let online = false
  const calls = mockApi({
    'GET /auth/me': USER,
    'POST /purchases/scan-qr': () => {
      if (!online) throw new TypeError('Network request failed')
      return SCAN
    },
  })
  await openScanner()

  await scanCode(QR)
  await waitFor(() => expect(qrCalls(calls)).toHaveLength(1))
  expect(screen.getByTestId('qr-camera')).toBeOnTheScreen()

  online = true
  await scanCode(QR)
  expect(await screen.findByText(/Lemos o código QR/)).toBeOnTheScreen()
  expect(qrCalls(calls)).toHaveLength(2)
})

test('sem autorização, pede acesso à câmara', async () => {
  mockApi({ 'GET /auth/me': USER })
  camera.__setPermission({ granted: false, canAskAgain: true })
  await openScanner()

  expect(screen.getByText(/precisa de acesso à câmara/)).toBeOnTheScreen()
  expect(screen.queryByTestId('qr-camera')).toBeNull()

  camera.__setPermission({ granted: true, canAskAgain: true })
  await fireEvent.press(screen.getByRole('button', { name: 'Autorizar a câmara' }))
  expect(await screen.findByTestId('qr-camera')).toBeOnTheScreen()
})

test('com a câmara recusada de vez, leva às definições do telemóvel', async () => {
  mockApi({ 'GET /auth/me': USER })
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue()
  camera.__setPermission({ granted: false, canAskAgain: false })
  await openScanner()

  await fireEvent.press(screen.getByRole('button', { name: 'Abrir as definições' }))
  expect(openSettings).toHaveBeenCalled()
})
