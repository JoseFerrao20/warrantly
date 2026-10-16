import * as SecureStore from 'expo-secure-store'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'

import { api } from '@/lib/api'
import { USER, makePurchase, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(() => resetStorage())

const authorization = (init: RequestInit) =>
  (init.headers as Record<string, string> | undefined)?.Authorization

/** 401 com o token antigo e 200 com o novo, como a API depois de o token expirar. */
const onlyFreshToken = (body: unknown) => (init: RequestInit) =>
  authorization(init) === 'Bearer acesso-novo'
    ? body
    : { status: 401, body: { detail: 'Token inválido ou expirado' } }

const NEW_SESSION = { access_token: 'acesso-novo', refresh_token: 'refresh-novo' }

test('o login pede o refresh token no corpo e guarda-o no armazenamento seguro', async () => {
  const calls = mockApi({
    'POST /auth/login': { access_token: 'abc', refresh_token: 'refresh-1', expires_in: 900 },
    'GET /auth/me': USER,
    'GET /purchases': [],
  })
  await renderApp()

  await fireEvent.changeText(await screen.findByLabelText('Email'), 'ana@example.com')
  await fireEvent.changeText(screen.getByLabelText('Palavra-passe'), 'segredo-123')
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }))

  await screen.findByText(/Ainda não tens compras/)
  const login = calls.find((c) => c.url.endsWith('/auth/login'))!
  expect((login.init.headers as Record<string, string>)['X-Client']).toBe('mobile')
  expect(await SecureStore.getItemAsync('warrantly.token')).toBe('abc')
  expect(await SecureStore.getItemAsync('warrantly.refreshToken')).toBe('refresh-1')
})

test('com o token de acesso expirado, renova a sessão e repete o pedido', async () => {
  await signIn()
  await SecureStore.setItemAsync('warrantly.refreshToken', 'refresh-velho')
  const calls = mockApi({
    'GET /auth/me': onlyFreshToken(USER),
    'GET /purchases': onlyFreshToken([makePurchase({ product_name: 'Televisão' })]),
    'POST /auth/refresh': NEW_SESSION,
  })
  await renderApp()

  expect(await screen.findByText('Televisão')).toBeOnTheScreen()
  const refreshes = calls.filter((c) => c.url.endsWith('/auth/refresh'))
  expect(refreshes).toHaveLength(1)
  expect(JSON.parse(refreshes[0].init.body as string)).toEqual({ refresh_token: 'refresh-velho' })
  // A API roda os dois tokens: o telemóvel guarda os novos.
  expect(await SecureStore.getItemAsync('warrantly.token')).toBe('acesso-novo')
  expect(await SecureStore.getItemAsync('warrantly.refreshToken')).toBe('refresh-novo')
})

test('vários pedidos com 401 ao mesmo tempo fazem uma só renovação', async () => {
  await signIn()
  await SecureStore.setItemAsync('warrantly.refreshToken', 'refresh-velho')
  const calls = mockApi({
    'GET /purchases': onlyFreshToken([]),
    'GET /purchases/1': onlyFreshToken(makePurchase()),
    'POST /auth/refresh': NEW_SESSION,
  })

  await Promise.all([api.listPurchases(), api.getPurchase(1), api.listPurchases()])

  expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1)
})

test('sem refresh token, um 401 termina a sessão sem pedir renovação', async () => {
  await signIn()
  const calls = mockApi({
    'GET /auth/me': USER,
    'GET /purchases': { status: 401, body: { detail: 'Token inválido ou expirado' } },
  })
  const app = await renderApp()

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
  expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false)
})

test('"Sair" revoga a sessão na API e apaga os tokens do telemóvel', async () => {
  await signIn()
  await SecureStore.setItemAsync('warrantly.refreshToken', 'refresh-1')
  const calls = mockApi({ 'GET /auth/me': USER, 'GET /purchases': [] })
  const app = await renderApp()

  await fireEvent.press(await screen.findByRole('button', { name: 'Sair' }))

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
  const logout = calls.find((c) => c.url.endsWith('/auth/logout'))!
  expect(JSON.parse(logout.init.body as string)).toEqual({ refresh_token: 'refresh-1' })
  expect(await SecureStore.getItemAsync('warrantly.token')).toBeNull()
  expect(await SecureStore.getItemAsync('warrantly.refreshToken')).toBeNull()
})
