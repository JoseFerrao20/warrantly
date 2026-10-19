import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

const UNVERIFIED = { ...USER, email_verified: false }

describe('confirmar o email', () => {
  it('confirma com o token do link, mesmo sem sessão', async () => {
    const fetchMock = mockApi({ 'POST /auth/verify-email': { status: 204 } })
    renderApp('/confirmar-email#token=abc.def.ghi', { loggedIn: false })

    expect(await screen.findByRole('status')).toHaveTextContent('O teu email está confirmado.')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/verify-email')!
    expect(JSON.parse(call[1]!.body as string)).toEqual({ token: 'abc.def.ghi' })
  })

  it('com o link inválido, explica como pedir outro', async () => {
    mockApi({
      'POST /auth/verify-email': {
        status: 400,
        body: { detail: 'O link é inválido ou já expirou. Pede outro na app.' },
      },
    })
    renderApp('/confirmar-email#token=velho', { loggedIn: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(/já expirou.*Enviar outra vez/)
  })

  it('sem token, não pede nada à API', async () => {
    const fetchMock = mockApi({})
    renderApp('/confirmar-email', { loggedIn: false })

    expect(await screen.findByRole('alert')).toHaveTextContent('Este link não está completo.')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/refresh'])
  })
})

describe('email por confirmar', () => {
  it('mostra o aviso e envia outro link', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: UNVERIFIED },
      'GET /purchases': { body: [] },
      'POST /auth/verify-email/resend': {
        status: 202,
        body: { detail: 'Enviámos um link para ana@example.com.' },
      },
    })
    renderApp('/')

    const banner = await screen.findByRole('region', { name: 'Confirmar o email' })
    expect(banner).toHaveTextContent('Confirma o teu email.')
    await userEvent.click(within(banner).getByRole('button', { name: 'Enviar outra vez' }))

    expect(await within(banner).findByRole('status')).toHaveTextContent(
      'Enviámos um link para ana@example.com.',
    )
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/verify-email/resend')).toBe(true)
  })

  it('sem o aviso quando o email já está confirmado', async () => {
    mockApi({ 'GET /auth/me': { body: USER }, 'GET /purchases': { body: [] } })
    renderApp('/')

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: 'Confirmar o email' })).toBeNull()
  })

  it('na conta, a partilha pede primeiro o email confirmado', async () => {
    mockApi({ 'GET /auth/me': { body: UNVERIFIED } })
    renderApp('/conta')

    const sharing = await screen.findByRole('region', { name: 'Partilha' })
    expect(sharing).toHaveTextContent('confirma primeiro o teu email')
    expect(within(sharing).queryByRole('button', { name: 'Convidar' })).toBeNull()
  })
})
