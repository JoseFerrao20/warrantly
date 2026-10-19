import { fireEvent, screen, waitFor } from 'expo-router/testing-library'
import { Alert } from 'react-native'
import type { AlertButton } from 'react-native'

import { USER, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(resetStorage)
afterEach(() => jest.restoreAllMocks())

/** Responde ao Alert como se a pessoa carregasse no botão com este texto. */
function answerAlert(text: string) {
  return jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.text === text)?.onPress?.()
    })
}

describe('criar conta', () => {
  test('cria a conta e entra logo no painel', async () => {
    const calls = mockApi({
      'POST /auth/register': { status: 201, body: { ...USER, email_verified: false } },
      'POST /auth/login': { access_token: 'abc', refresh_token: 'r' },
      'GET /auth/me': { ...USER, email_verified: false },
      'GET /purchases': [],
    })
    const app = await renderApp()

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Ainda não tens conta? Cria uma' }),
    )
    await fireEvent.changeText(screen.getByLabelText(/^Nome/), 'Ana Silva')
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Ana@Example.com')
    await fireEvent.changeText(screen.getByLabelText('Palavra-passe'), 'segredo-123')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText(/Ainda não tens compras registadas/)).toBeOnTheScreen()
    expect(app.getPathname()).toBe('/')
    const register = calls.find((c) => c.url.endsWith('/auth/register'))!
    expect(JSON.parse(register.init.body as string)).toEqual({
      email: 'ana@example.com',
      password: 'segredo-123',
      full_name: 'Ana Silva',
    })
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(true)
  })

  test('mostra o erro da API (email já registado)', async () => {
    mockApi({
      'POST /auth/register': {
        status: 409,
        body: { detail: 'Já existe uma conta com este email' },
      },
    })
    await renderApp()

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Ainda não tens conta? Cria uma' }),
    )
    await fireEvent.changeText(screen.getByLabelText('Email'), 'ana@example.com')
    await fireEvent.changeText(screen.getByLabelText('Palavra-passe'), 'segredo-123')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com este email',
    )
  })

  test('a palavra-passe curta não chega à API', async () => {
    const calls = mockApi({})
    await renderApp()

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Ainda não tens conta? Cria uma' }),
    )
    await fireEvent.changeText(screen.getByLabelText('Email'), 'ana@example.com')
    await fireEvent.changeText(screen.getByLabelText('Palavra-passe'), 'curta')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/pelo menos 8 caracteres/)
    expect(calls.some((c) => c.url.endsWith('/auth/register'))).toBe(false)
  })
})

test('esqueci-me da palavra-passe: pede o link por email', async () => {
  const detail = 'Se existir uma conta com este email, enviámos um link.'
  const calls = mockApi({ 'POST /auth/password-reset': { status: 202, body: { detail } } })
  await renderApp()

  await fireEvent.press(await screen.findByRole('button', { name: 'Esqueci-me da palavra-passe' }))
  expect(screen.queryByLabelText('Palavra-passe')).toBeNull()
  await fireEvent.changeText(screen.getByLabelText('Email'), 'Ana@Example.com')
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar link' }))

  expect(await screen.findByText(detail)).toBeOnTheScreen()
  const reset = calls.find((c) => c.url.endsWith('/auth/password-reset'))!
  expect(JSON.parse(reset.init.body as string)).toEqual({ email: 'ana@example.com' })

  await fireEvent.press(screen.getByRole('button', { name: 'Voltar a entrar' }))
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeOnTheScreen()
})

async function openAccount(routes: Record<string, unknown> = {}) {
  await signIn()
  const calls = mockApi({ 'GET /auth/me': USER, 'GET /purchases': [], ...routes })
  const app = await renderApp()
  await fireEvent.press(await screen.findByRole('link', { name: 'Conta' }))
  await waitFor(() => expect(app.getPathname()).toBe('/conta'))
  return { app, calls }
}

test('muda o nome na conta', async () => {
  const { calls } = await openAccount({
    'PATCH /auth/me': (init: RequestInit) => ({ ...USER, ...JSON.parse(init.body as string) }),
  })

  const name = await screen.findByLabelText(/^Nome/)
  expect(name).toHaveDisplayValue('Ana')
  await fireEvent.changeText(name, 'Ana Silva')
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar nome' }))

  expect(await screen.findByText('Guardado.')).toBeOnTheScreen()
  const patch = calls.find((c) => c.method === 'PATCH')!
  expect(JSON.parse(patch.init.body as string)).toEqual({ full_name: 'Ana Silva' })
})

describe('apagar a conta', () => {
  test('com a palavra-passe certa, apaga e volta ao ecrã de entrada', async () => {
    answerAlert('Apagar conta')
    const { app, calls } = await openAccount({ 'DELETE /auth/me': { status: 204, body: null } })

    await fireEvent.changeText(
      await screen.findByLabelText('Palavra-passe (para confirmar)'),
      'segredo-123',
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(await screen.findByText('A tua conta foi apagada.')).toBeOnTheScreen()
    await waitFor(() => expect(app.getPathname()).toBe('/entrar'))
    const del = calls.find((c) => c.method === 'DELETE' && c.url.endsWith('/auth/me'))!
    expect(JSON.parse(del.init.body as string)).toEqual({ password: 'segredo-123' })
    expect(Alert.alert).toHaveBeenCalledWith(
      'Apagar a conta?',
      expect.stringContaining('Não dá para desfazer'),
      expect.anything(),
    )
  })

  test('com a palavra-passe errada, mostra o erro e fica', async () => {
    answerAlert('Apagar conta')
    const { app } = await openAccount({
      'DELETE /auth/me': { status: 403, body: { detail: 'Palavra-passe incorreta' } },
    })

    await fireEvent.changeText(
      await screen.findByLabelText('Palavra-passe (para confirmar)'),
      'errada',
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Palavra-passe incorreta')
    expect(app.getPathname()).toBe('/conta')
  })

  test('cancelar não apaga nada', async () => {
    answerAlert('Cancelar')
    const { calls } = await openAccount()

    await fireEvent.changeText(
      await screen.findByLabelText('Palavra-passe (para confirmar)'),
      'segredo-123',
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})
