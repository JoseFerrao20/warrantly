import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'
import { Alert } from 'react-native'
import type { AlertButton } from 'react-native'

import type { Purchase, UploadTicket } from '@/shared/types'
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
const TOKEN = 'b'.repeat(32)
const DIRECT: UploadTicket = {
  direct: true,
  max_bytes: 10 * 1024 * 1024,
  token: TOKEN,
  url: 'https://faturas.s3.eu-central-1.amazonaws.com/',
  fields: { key: `uploads/1/${TOKEN}`, policy: 'p' },
}
const WITH_INVOICE = makePurchase({
  id: 7,
  invoice_filename: 'antiga.pdf',
  invoice_content_type: 'application/pdf',
  invoice_size: 100,
})

beforeEach(() => {
  resetStorage()
  jest.clearAllMocks()
})
afterEach(() => jest.restoreAllMocks())

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
    'GET /purchases/7': purchase,
    ...routes,
  })
  await renderApp('/compras/7')
  await screen.findByText(purchase.store)
  return calls
}

test('junta uma fatura (PDF) a uma compra que não a tinha', async () => {
  answerAlert('Escolher ficheiro')
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/nova.pdf', name: 'nova.pdf', mimeType: 'application/pdf' }],
  } as DocumentPicker.DocumentPickerResult)
  const calls = await openPurchase(makePurchase({ id: 7 }), {
    'POST /purchases/uploads': NO_DIRECT,
    'PUT /purchases/7/invoice': { ...WITH_INVOICE, invoice_filename: 'nova.pdf' },
  })

  await fireEvent.press(screen.getByRole('button', { name: 'Juntar fatura' }))

  expect(await screen.findByText('Fatura guardada.')).toBeOnTheScreen()
  expect(screen.getByText('nova.pdf')).toBeOnTheScreen()
  expect(screen.getByRole('button', { name: 'Ver a fatura' })).toBeOnTheScreen()
  expect(Alert.alert).toHaveBeenCalledWith('Juntar a fatura', expect.any(String), expect.anything())
  // Sem S3, o ficheiro vai pela API, num FormData.
  const put = calls.find((c) => c.method === 'PUT')!
  expect(put.url).toMatch(/\/purchases\/7\/invoice$/)
  const parts = (put.init.body as unknown as { _parts: [string, unknown][] })._parts
  expect(parts).toEqual([
    ['file', { uri: 'file:///cache/nova.pdf', name: 'nova.pdf', type: 'application/pdf' }],
  ])
})

test('troca a fatura por uma fotografia, que vai diretamente para o S3', async () => {
  answerAlert('Fotografar')
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
    granted: true,
  } as ImagePicker.CameraPermissionResponse)
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/foto.jpg', fileName: 'foto.jpg', mimeType: 'image/jpeg' }],
  } as ImagePicker.ImagePickerResult)
  const calls = await openPurchase(WITH_INVOICE, {
    'POST /purchases/uploads': DIRECT,
    [`POST ${DIRECT.url}`]: { status: 204, body: null },
    'PUT /purchases/7/invoice/upload': { ...WITH_INVOICE, invoice_filename: 'foto.jpg' },
  })

  await fireEvent.press(screen.getByRole('button', { name: 'Trocar a fatura' }))

  expect(await screen.findByText('Fatura guardada.')).toBeOnTheScreen()
  expect(screen.getByText('foto.jpg')).toBeOnTheScreen()
  expect(Alert.alert).toHaveBeenCalledWith(
    'Trocar a fatura?',
    'A fatura atual (antiga.pdf) é substituída.',
    expect.anything(),
  )
  expect(calls.some((c) => c.url === DIRECT.url)).toBe(true) // o ficheiro foi para o bucket
  const attach = calls.find((c) => c.url.endsWith('/purchases/7/invoice/upload'))!
  expect(JSON.parse(attach.init.body as string)).toEqual({ token: TOKEN, filename: 'foto.jpg' })
})

test('sem acesso à câmara, explica como autorizar', async () => {
  answerAlert('Fotografar')
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
    granted: false,
  } as ImagePicker.CameraPermissionResponse)
  const calls = await openPurchase(makePurchase({ id: 7 }))

  await fireEvent.press(screen.getByRole('button', { name: 'Juntar fatura' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/Sem acesso à câmara/)
  expect(calls.some((c) => c.method === 'PUT')).toBe(false)
})

test('cancelar a escolha do ficheiro não envia nada', async () => {
  answerAlert('Escolher ficheiro')
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: true,
    assets: null,
  } as DocumentPicker.DocumentPickerResult)
  const calls = await openPurchase(makePurchase({ id: 7 }))

  await fireEvent.press(screen.getByRole('button', { name: 'Juntar fatura' }))

  await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled())
  expect(calls.some((c) => c.url.endsWith('/purchases/uploads'))).toBe(false)
  expect(screen.queryByText('Fatura guardada.')).toBeNull()
})

test('numa compra partilhada comigo, não se troca a fatura nem se apaga', async () => {
  await openPurchase({ ...WITH_INVOICE, user_id: 2, owner_name: 'Maria Silva' })

  expect(screen.getByText(/Partilhada por Maria Silva/)).toBeOnTheScreen()
  expect(screen.getByRole('button', { name: 'Ver a fatura' })).toBeOnTheScreen()
  expect(screen.getByRole('button', { name: 'Reclamar à loja' })).toBeOnTheScreen()
  expect(screen.queryByRole('button', { name: 'Trocar a fatura' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Apagar' })).toBeNull()
})
