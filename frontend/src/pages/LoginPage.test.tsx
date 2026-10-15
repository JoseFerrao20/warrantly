import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

describe('LoginPage', () => {
  it('sem sessão, qualquer página leva ao login', async () => {
    mockApi({})
    renderApp('/', { loggedIn: false })

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('faz login e abre o painel', async () => {
    const fetchMock = mockApi({
      'POST /auth/login': { body: { access_token: 'abc', token_type: 'bearer' } },
      'GET /auth/me': { body: USER },
      'GET /purchases': { body: [] },
    })
    renderApp('/entrar', { loggedIn: false })

    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Palavra-passe'), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Ainda não tens compras registadas')).toBeInTheDocument()
    expect(localStorage.getItem('warrantly.token')).toBe('abc')
    const loginBody = fetchMock.mock.calls[0][1]?.body as URLSearchParams
    expect(loginBody.get('username')).toBe('ana@example.com')
  })

  it('mostra o erro da API quando a palavra-passe está errada', async () => {
    mockApi({
      'POST /auth/login': { status: 401, body: { detail: 'Email ou palavra-passe incorretos' } },
    })
    renderApp('/entrar', { loggedIn: false })

    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Palavra-passe'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email ou palavra-passe incorretos')
  })

  it('cria conta e entra logo', async () => {
    const fetchMock = mockApi({
      'POST /auth/register': { status: 201, body: USER },
      'POST /auth/login': { body: { access_token: 'abc', token_type: 'bearer' } },
      'GET /auth/me': { body: USER },
      'GET /purchases': { body: [] },
    })
    renderApp('/entrar', { loggedIn: false })

    await userEvent.click(screen.getByRole('button', { name: /Cria uma/ }))
    await userEvent.type(screen.getByLabelText(/^Nome/), 'Ana Silva')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Palavra-passe'), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Ainda não tens compras registadas')).toBeInTheDocument()
    const registerCall = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/register')
    expect(JSON.parse(registerCall![1]!.body as string)).toEqual({
      email: 'ana@example.com',
      password: 'segredo123',
      full_name: 'Ana Silva',
    })
  })

  it('um token expirado volta ao login', async () => {
    mockApi({ 'GET /auth/me': { status: 401, body: { detail: 'Token inválido ou expirado' } } })
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(localStorage.getItem('warrantly.token')).toBeNull()
  })
})
