import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'

import type { InvoiceScan, UploadTicket } from '@/shared/types'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

const NO_DIRECT: UploadTicket = {
  direct: false,
  max_bytes: 10 * 1024 * 1024,
  token: null,
  url: null,
  fields: null,
}
const TOKEN = 'a'.repeat(32)
const DIRECT: UploadTicket = {
  direct: true,
  max_bytes: 10 * 1024 * 1024,
  token: TOKEN,
  url: 'https://faturas.s3.eu-west-1.amazonaws.com/',
  fields: { key: `uploads/1/${TOKEN}`, policy: 'p' },
}
const SCAN: InvoiceScan = {
  text_found: true,
  ocr_available: true,
  product_name: 'Frigorífico Combinado',
  store: 'Worten',
  purchase_date: '2025-02-14',
  price: '1234.50',
  invoice_number: 'FT A2025/77',
  store_email: null,
}

const PDF = { uri: 'file:///cache/fatura.pdf', name: 'fatura.pdf', mimeType: 'application/pdf' }

beforeEach(async () => {
  resetStorage()
  jest.clearAllMocks()
  await signIn()
})

function pickDocument(asset: object = { ...PDF, size: 2048 }) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [asset],
  } as DocumentPicker.DocumentPickerResult)
}

/** Campos de um FormData do React Native, pela ordem em que foram juntos. */
function formFields(body: unknown): Record<string, unknown> {
  return Object.fromEntries((body as unknown as { _parts: [string, unknown][] })._parts)
}

async function openForm() {
  const app = await renderApp('/compras/nova')
  await screen.findByRole('button', { name: 'Guardar compra' })
  return app
}

test('escolher um PDF lê a fatura e só preenche os campos vazios', async () => {
  pickDocument()
  const calls = mockApi({
    'GET /auth/me': USER,
    'POST /purchases/uploads': NO_DIRECT,
    'POST /purchases/scan-invoice': SCAN,
    'POST /purchases': makePurchase({ id: 9, product_name: 'Frigorífico' }),
    'PUT /purchases/9/invoice': makePurchase({ id: 9, invoice_filename: 'fatura.pdf' }),
    'GET /purchases/9': makePurchase({ id: 9, product_name: 'Frigorífico' }),
  })
  const app = await openForm()

  await fireEvent.changeText(screen.getByLabelText('Produto'), 'Frigorífico')
  await fireEvent.press(screen.getByRole('button', { name: 'Escolher ficheiro' }))

  expect(await screen.findByText(/Preenchemos alguns campos/)).toBeOnTheScreen()
  expect(screen.getByText('Fatura escolhida: fatura.pdf')).toBeOnTheScreen()
  expect(screen.getByLabelText('Produto')).toHaveDisplayValue('Frigorífico') // já escrito
  expect(screen.getByLabelText('Loja')).toHaveDisplayValue('Worten')
  expect(screen.getByLabelText('Data da compra (AAAA-MM-DD)')).toHaveDisplayValue('2025-02-14')
  expect(screen.getByLabelText('Preço (€)')).toHaveDisplayValue('1234,50')
  expect(screen.getByLabelText('N.º da fatura (opcional)')).toHaveDisplayValue('FT A2025/77')

  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/9'))
  const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/purchases'))!
  expect(JSON.parse(created.init.body as string)).toEqual({
    product_name: 'Frigorífico',
    store: 'Worten',
    category: null,
    purchase_date: '2025-02-14',
    price: '1234.50',
    warranty_months: 36,
    invoice_number: 'FT A2025/77',
    store_email: null,
  })
  const upload = calls.find((c) => c.url.endsWith('/purchases/9/invoice'))!
  expect(formFields(upload.init.body)).toEqual({
    file: { uri: PDF.uri, name: 'fatura.pdf', type: 'application/pdf', size: 2048 },
  })
})

test('com S3, a fotografia vai diretamente para o bucket e a API só recebe o token', async () => {
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
    granted: true,
  } as ImagePicker.CameraPermissionResponse)
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///camera/1.jpg', fileName: null, mimeType: 'image/jpeg', fileSize: 900 },
    ],
  } as unknown as ImagePicker.ImagePickerResult)
  const calls = mockApi({
    'GET /auth/me': USER,
    'POST /purchases/uploads': DIRECT,
    [`POST ${DIRECT.url}`]: null,
    [`POST /purchases/uploads/${TOKEN}/scan`]: { ...SCAN, product_name: null },
    'POST /purchases': makePurchase({ id: 4 }),
    'PUT /purchases/4/invoice/upload': makePurchase({ id: 4 }),
    'GET /purchases/4': makePurchase({ id: 4 }),
  })
  const app = await openForm()

  await fireEvent.press(screen.getByRole('button', { name: 'Fotografar' }))
  await screen.findByText(/Preenchemos alguns campos/)
  await fireEvent.changeText(screen.getByLabelText('Produto'), 'Frigorífico')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/4'))
  const s3 = calls.find((c) => c.url === DIRECT.url)!
  const fields = formFields(s3.init.body)
  expect(Object.keys(fields)).toEqual(['key', 'policy', 'file']) // o S3 exige o ficheiro no fim
  expect(fields.key).toBe(`uploads/1/${TOKEN}`)
  expect(fields.file).toEqual({
    uri: 'file:///camera/1.jpg',
    name: 'fatura.jpg',
    type: 'image/jpeg',
    size: 900,
  })
  expect(s3.init.headers).toBeUndefined() // o token da API nunca vai para o S3
  const attach = calls.find((c) => c.url.endsWith('/invoice/upload'))!
  expect(JSON.parse(attach.init.body as string)).toEqual({ token: TOKEN, filename: 'fatura.jpg' })
  expect(calls.some((c) => c.url.endsWith('/scan-invoice'))).toBe(false)
})

test('sem autorização para a câmara, explica como a dar', async () => {
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
    granted: false,
  } as ImagePicker.CameraPermissionResponse)
  mockApi({ 'GET /auth/me': USER })
  await openForm()

  await fireEvent.press(screen.getByRole('button', { name: 'Fotografar' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/Sem acesso à câmara/)
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled()
})

test('fatura grande demais é recusada antes de ser enviada', async () => {
  pickDocument({ ...PDF, size: 11 * 1024 * 1024 })
  const calls = mockApi({ 'GET /auth/me': USER, 'POST /purchases/uploads': DIRECT })
  await openForm()

  await fireEvent.press(screen.getByRole('button', { name: 'Escolher ficheiro' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('A fatura não pode ter mais de 10 MB')
  expect(calls.some((c) => c.url === DIRECT.url)).toBe(false)
})

test('valida o formulário antes de enviar', async () => {
  const calls = mockApi({ 'GET /auth/me': USER })
  await openForm()

  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Indica o produto e a loja.')

  await fireEvent.changeText(screen.getByLabelText('Produto'), 'TV')
  await fireEvent.changeText(screen.getByLabelText('Loja'), 'Fnac')
  await fireEvent.changeText(screen.getByLabelText('Preço (€)'), 'doze')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))
  expect(screen.getByRole('alert')).toHaveTextContent('O preço não é válido (ex.: 749,99).')

  await fireEvent.changeText(screen.getByLabelText('Preço (€)'), '12')
  await fireEvent.changeText(screen.getByLabelText('Data da compra (AAAA-MM-DD)'), '14/02/2025')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/formato AAAA-MM-DD/)

  expect(calls.some((c) => c.url.includes('/purchases'))).toBe(false)
})

test('se a fatura falhar depois de criar a compra, avisa e mostra a compra', async () => {
  pickDocument()
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  mockApi({
    'GET /auth/me': USER,
    'POST /purchases/uploads': NO_DIRECT,
    'POST /purchases/scan-invoice': { status: 500, body: null },
    'POST /purchases': makePurchase({ id: 5 }),
    'PUT /purchases/5/invoice': {
      status: 415,
      body: { detail: 'Tipo de ficheiro não suportado' },
    },
    'GET /purchases/5': makePurchase({ id: 5 }),
  })
  const app = await openForm()

  await fireEvent.press(screen.getByRole('button', { name: 'Escolher ficheiro' }))
  expect(await screen.findByText(/Não conseguimos ler os dados/)).toBeOnTheScreen()
  await fireEvent.changeText(screen.getByLabelText('Produto'), 'TV')
  await fireEvent.changeText(screen.getByLabelText('Loja'), 'Fnac')
  await fireEvent.changeText(screen.getByLabelText('Preço (€)'), '99,90')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar compra' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/5'))
  expect(alert).toHaveBeenCalledWith(
    'Compra guardada sem fatura',
    'Tipo de ficheiro não suportado. Podes juntá-la depois no site.',
  )
})
