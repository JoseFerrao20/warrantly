import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library'
import { Platform } from 'react-native'

import { pushUnavailableReason, registerForPush } from '@/lib/push'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

const PHONE_TOKEN = 'ExponentPushToken[telemovel]'
const tap = (Notifications as unknown as { __tap: (data: object) => void }).__tap

beforeEach(() => {
  resetStorage()
  jest.clearAllMocks()
})

afterEach(() => jest.restoreAllMocks())

function pushCalls(calls: ReturnType<typeof mockApi>, method: string) {
  return calls
    .filter((c) => c.method === method && c.url.endsWith('/push-tokens'))
    .map((c) => JSON.parse(c.init.body as string))
}

test('ao entrar, regista o token do telemóvel na API', async () => {
  await signIn()
  const calls = mockApi({ 'GET /auth/me': USER, 'GET /purchases': [] })
  await renderApp()

  await waitFor(() =>
    expect(pushCalls(calls, 'POST')).toEqual([{ token: PHONE_TOKEN, platform: 'ios' }]),
  )
  const post = calls.find((c) => c.url.endsWith('/push-tokens'))!
  expect((post.init.headers as Record<string, string>).Authorization).toBe('Bearer token-de-teste')
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'projeto-teste' })
})

test('sem sessão, não pede autorização', async () => {
  mockApi({})
  await renderApp()

  await screen.findByLabelText('Email')
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled()
})

test('sem autorização para notificações, não regista nada', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
    granted: false,
  } as Notifications.NotificationPermissionsStatus)
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
    granted: false,
  } as Notifications.NotificationPermissionsStatus)

  const calls = mockApi({})
  await expect(registerForPush()).resolves.toBeNull()

  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled()
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
  expect(calls).toEqual([])
})

test('no Android, cria o canal dos alertas antes de pedir autorização', async () => {
  jest.replaceProperty(Platform, 'OS', 'android')
  const calls = mockApi({})
  await signIn()

  await registerForPush()

  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('alertas', {
    name: 'Alertas de garantia',
    importance: 4, // AndroidImportance.HIGH
  })
  const order = (fn: unknown) => jest.mocked(fn as jest.Mock).mock.invocationCallOrder[0]
  expect(order(Notifications.setNotificationChannelAsync)).toBeLessThan(
    order(Notifications.getPermissionsAsync),
  )
  expect(pushCalls(calls, 'POST')).toEqual([{ token: PHONE_TOKEN, platform: 'android' }])
})

test('aparelhos sem push: simulador, Expo Go no Android e sem projeto do EAS', () => {
  expect(pushUnavailableReason()).toBeNull()

  jest.replaceProperty(Device, 'isDevice', false)
  expect(pushUnavailableReason()).toMatch(/simuladores/)
  jest.replaceProperty(Device, 'isDevice', true)

  jest.replaceProperty(Platform, 'OS', 'android')
  jest.replaceProperty(Constants, 'executionEnvironment', 'storeClient' as never)
  expect(pushUnavailableReason()).toMatch(/Expo Go no Android/)
  jest.replaceProperty(Platform, 'OS', 'ios')
  expect(pushUnavailableReason()).toBeNull() // no iOS, a Expo Go ainda recebe

  jest.replaceProperty(Constants, 'expoConfig', { ...Constants.expoConfig!, extra: {} })
  expect(pushUnavailableReason()).toMatch(/projeto do EAS/)
})

test('tocar numa notificação abre a compra', async () => {
  await signIn()
  mockApi({
    'GET /auth/me': USER,
    'GET /purchases': [],
    'GET /purchases/7': makePurchase({ id: 7, product_name: 'Frigorífico' }),
  })
  const app = await renderApp()
  await screen.findByText(/Ainda não tens compras/)

  await act(async () => tap({ url: '/compras/7' }))

  await waitFor(() => expect(app.getPathname()).toBe('/compras/7'))
  expect(await screen.findByText('Worten')).toBeOnTheScreen()
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled()
})

test('"Sair" apaga o token na API; a sessão expirada não', async () => {
  await signIn()
  const calls = mockApi({ 'GET /auth/me': USER, 'GET /purchases': [] })
  const app = await renderApp()
  await waitFor(() => expect(pushCalls(calls, 'POST')).toHaveLength(1))

  await fireEvent.press(await screen.findByRole('button', { name: 'Sair' }))

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
  expect(pushCalls(calls, 'DELETE')).toEqual([{ token: PHONE_TOKEN }])
  expect(await SecureStore.getItemAsync('warrantly.pushToken')).toBeNull()
})

test('com a sessão expirada, o telemóvel continua a receber os alertas', async () => {
  await signIn()
  await SecureStore.setItemAsync('warrantly.pushToken', PHONE_TOKEN)
  const calls = mockApi({
    'GET /auth/me': USER,
    'GET /purchases': { status: 401, body: { detail: 'Sessão expirada' } },
  })
  const app = await renderApp()

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
  expect(pushCalls(calls, 'DELETE')).toEqual([])
})
