import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getToken, setToken } from './api'
import { makePurchase, mockApi, renderApp, USER } from './test/utils'

afterEach(() => vi.unstubAllGlobals())

const authorization = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization

/** Responde 401 ao token antigo e 200 ao novo, como a API depois de o token expirar. */
const onlyFreshToken = (body: unknown) => (init: RequestInit | undefined) =>
  authorization(init) === 'Bearer token-novo'
    ? { body }
    : { status: 401, body: { detail: 'Token inválido ou expirado' } }

describe('sessão', () => {
  it('ao abrir a página, o token de acesso vem do cookie (nunca do localStorage)', async () => {
    localStorage.setItem('warrantly.token', 'token-antigo') // de uma versão anterior
    const fetchMock = mockApi({
      'POST /auth/refresh': { body: { access_token: 'token-novo' } },
      'GET /auth/me': onlyFreshToken(USER),
      'GET /purchases': onlyFreshToken([makePurchase()]),
    })
    renderApp('/', { loggedIn: false }) // como uma página acabada de abrir: nada em memória

    expect(await screen.findByText('Máquina de lavar Bosch')).toBeInTheDocument()
    expect(getToken()).toBe('token-novo')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh')
    expect(localStorage.getItem('warrantly.token')).toBeNull()
  })

  it('ao abrir a página sem sessão, fica no login', async () => {
    mockApi({}) // o /auth/refresh responde 401 por omissão
    renderApp('/', { loggedIn: false })

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })

  it('com o token de acesso expirado, renova-o e repete o pedido', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': onlyFreshToken(USER),
      'GET /purchases': onlyFreshToken([makePurchase()]),
      'POST /auth/refresh': { body: { access_token: 'token-novo', token_type: 'bearer' } },
    })
    renderApp('/')

    expect(await screen.findByText('Máquina de lavar Bosch')).toBeInTheDocument()
    expect(getToken()).toBe('token-novo')
    const refreshes = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh')
    expect(refreshes).toHaveLength(1)
    // O refresh token vai no cookie (que o browser junta sozinho), nunca pelo JavaScript.
    expect(refreshes[0][1]).toEqual({ method: 'POST' })
  })

  it('vários pedidos com 401 ao mesmo tempo fazem uma só renovação', async () => {
    let calls = 0
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases': onlyFreshToken([]),
      'GET /purchases/1': onlyFreshToken(makePurchase()),
      'POST /auth/refresh': () => {
        calls += 1
        return { body: { access_token: 'token-novo' } }
      },
    })
    const { api } = await import('./api')
    setToken('token-velho')

    await Promise.all([api.listPurchases(), api.getPurchase(1), api.listPurchases()])

    expect(calls).toBe(1)
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh')).toHaveLength(1)
  })

  it('a fatura (pedido de ficheiro) também renova o token', async () => {
    mockApi({
      'GET /purchases/1/invoice': (init) =>
        authorization(init) === 'Bearer token-novo'
          ? { body: 'pdf' }
          : { status: 401, body: { detail: 'Token inválido ou expirado' } },
      'POST /auth/refresh': { body: { access_token: 'token-novo' } },
    })
    const { api } = await import('./api')
    setToken('token-velho')

    const blob = await api.getInvoice(1)

    expect(await blob.text()).toBe('"pdf"')
  })

  it('sair termina a sessão na API (apaga o cookie)', async () => {
    const fetchMock = mockApi({ 'GET /auth/me': { body: USER }, 'GET /purchases': { body: [] } })
    renderApp('/')

    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(true),
    )
    expect(getToken()).toBeNull()
  })
})
