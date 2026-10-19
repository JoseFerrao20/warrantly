import * as SecureStore from 'expo-secure-store'
import { fireEvent, screen, waitFor } from 'expo-router/testing-library'

import {
  USER,
  logOut,
  makePurchase,
  mockApi,
  renderApp,
  resetStorage,
  signIn,
} from '@/test/utils'

beforeEach(() => resetStorage())

const PURCHASES = [
  makePurchase({
    id: 1,
    product_name: 'Torradeira',
    status: 'expired',
    warranty_end: '2023-01-05',
  }),
  makePurchase({ id: 2, product_name: 'Televisão', status: 'active' }),
  makePurchase({ id: 3, product_name: 'Portátil', status: 'expiring' }),
]

test('sem sessão, mostra o login e depois o painel', async () => {
  const calls = mockApi({
    'POST /auth/login': { access_token: 'abc' },
    'GET /auth/me': USER,
    'GET /purchases': PURCHASES,
  })
  const app = await renderApp()

  expect(await screen.findByText('Entra com a mesma conta do site.')).toBeOnTheScreen()
  expect(app.getPathname()).toBe('/entrar')

  await fireEvent.changeText(screen.getByLabelText('Email'), '  Ana@Example.com ')
  await fireEvent.changeText(screen.getByLabelText('Palavra-passe'), 'segredo-123')
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }))

  expect(await screen.findByText('Televisão')).toBeOnTheScreen()
  expect(app.getPathname()).toBe('/')
  const login = calls.find((c) => c.url.endsWith('/auth/login'))!
  expect(login.init.body).toBe('username=ana%40example.com&password=segredo-123')
  const me = calls.find((c) => c.url.endsWith('/auth/me'))!
  expect((me.init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
})

test('login errado mostra a mensagem da API', async () => {
  mockApi({
    'POST /auth/login': { status: 401, body: { detail: 'Email ou palavra-passe errados' } },
  })
  await renderApp()

  await fireEvent.changeText(await screen.findByLabelText('Email'), 'ana@example.com')
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Email ou palavra-passe errados')
})

test('com sessão guardada, abre no painel com as que expiram primeiro', async () => {
  await signIn()
  mockApi({ 'GET /auth/me': USER, 'GET /purchases': PURCHASES })
  await renderApp()

  await screen.findByText('Televisão')
  const names = screen
    .getAllByText(/^(Portátil|Televisão|Torradeira)$/)
    .map((text) => text.props.children)
  expect(names).toEqual(['Portátil', 'Televisão', 'Torradeira'])
  expect(screen.getByText('1 garantia termina nos próximos 60 dias.')).toBeOnTheScreen()
})

test('as compras partilhadas comigo mostram de quem são', async () => {
  await signIn()
  const shared = makePurchase({
    id: 4,
    product_name: 'Frigorífico',
    user_id: 2,
    owner_name: 'Maria',
  })
  mockApi({ 'GET /auth/me': USER, 'GET /purchases': [PURCHASES[1], shared] })
  await renderApp()

  expect(await screen.findByText('Worten · de Maria')).toBeOnTheScreen()
  expect(screen.getAllByText(/ · de /)).toHaveLength(1) // as minhas não têm a etiqueta
})

test('painel vazio convida a registar a primeira compra', async () => {
  await signIn()
  mockApi({ 'GET /auth/me': USER, 'GET /purchases': [] })
  await renderApp()

  expect(await screen.findByText(/Ainda não tens compras registadas/)).toBeOnTheScreen()
})

test('sem ligação ao servidor, o painel avisa', async () => {
  await signIn()
  mockApi({ 'GET /auth/me': USER })
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/me')) {
      return { ok: true, status: 200, json: async () => USER } as Response
    }
    throw new TypeError('Network request failed')
  }) as typeof fetch
  await renderApp()

  expect(await screen.findByRole('alert')).toHaveTextContent(/Sem ligação ao servidor/)
})

test('sair apaga o token e volta ao login', async () => {
  await signIn()
  mockApi({ 'GET /auth/me': USER, 'GET /purchases': [] })
  const app = await renderApp()

  await logOut()

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
  expect(await SecureStore.getItemAsync('warrantly.token')).toBeNull()
})

test('token expirado: um 401 da API termina a sessão', async () => {
  await signIn()
  mockApi({
    'GET /auth/me': USER,
    'GET /purchases': { status: 401, body: { detail: 'Sessão expirada' } },
  })
  const app = await renderApp()

  await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
})

test('detalhe da compra', async () => {
  await signIn()
  mockApi({
    'GET /auth/me': USER,
    'GET /purchases/7': makePurchase({
      id: 7,
      invoice_number: 'FT 2025/1',
      invoice_filename: 'fatura.pdf',
    }),
  })
  await renderApp('/compras/7')

  expect(await screen.findByText('FT 2025/1')).toBeOnTheScreen()
  expect(screen.getByText('fatura.pdf')).toBeOnTheScreen()
  expect(screen.getByText('3 anos')).toBeOnTheScreen()
  expect(screen.getByText('10/03/2028')).toBeOnTheScreen()
})
