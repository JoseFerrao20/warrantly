import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, renderApp, USER } from '../test/utils'
import type { UserSession } from '../types'

afterEach(() => vi.unstubAllGlobals())

const SESSIONS: UserSession[] = [
  {
    id: 3,
    device: 'Chrome no Windows',
    created_at: '2026-10-10T09:00:00Z',
    last_used_at: '2026-10-19T08:30:00Z',
    current: true,
  },
  {
    id: 2,
    device: 'App Warrantly: Pixel 8 (Android 16)',
    created_at: '2026-10-01T18:00:00Z',
    last_used_at: '2026-10-18T21:15:00Z',
    current: false,
  },
  {
    id: 1,
    device: 'Safari no iPhone',
    created_at: '2026-09-20T12:00:00Z',
    last_used_at: '2026-09-25T12:00:00Z',
    current: false,
  },
]

function sessionList() {
  return within(screen.getByRole('region', { name: 'Sessões' })).getByRole('list')
}

describe('SessionsSection', () => {
  it('lista os aparelhos com este marcado e sem botão para o terminar', async () => {
    mockApi({ 'GET /auth/me': { body: USER }, 'GET /auth/sessions': { body: SESSIONS } })
    renderApp('/conta')

    expect(await screen.findByText('Safari no iPhone')).toBeInTheDocument()
    const items = within(sessionList()).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Chrome no WindowsEste aparelho')
    expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument()
    expect(items[1]).toHaveTextContent(/Última atividade: .*2026/)
    expect(
      screen.getByRole('button', { name: 'Terminar sessão: Safari no iPhone' }),
    ).toBeInTheDocument()
  })

  it('termina a sessão de outro aparelho', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /auth/sessions': { body: SESSIONS },
      'DELETE /auth/sessions/1': { status: 204 },
    })
    renderApp('/conta')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Terminar sessão: Safari no iPhone' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sessão terminada: Safari no iPhone.',
    )
    expect(screen.queryByText('Safari no iPhone')).not.toBeInTheDocument()
    expect(within(sessionList()).getAllByRole('listitem')).toHaveLength(2)
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/sessions/1')
    expect(call![1]!.method).toBe('DELETE')
  })

  it('sai dos outros aparelhos e fica só este', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /auth/sessions': { body: SESSIONS },
      'POST /auth/sessions/end-others': { body: { ended: 2 } },
    })
    renderApp('/conta')

    await userEvent.click(await screen.findByRole('button', { name: 'Sair dos outros aparelhos' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Terminadas 2 sessões.')
    const items = within(sessionList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Este aparelho')
    // Sem outros aparelhos, o botão desaparece.
    expect(
      screen.queryByRole('button', { name: 'Sair dos outros aparelhos' }),
    ).not.toBeInTheDocument()
  })

  it('só com este aparelho não mostra o botão de sair dos outros', async () => {
    mockApi({ 'GET /auth/me': { body: USER }, 'GET /auth/sessions': { body: [SESSIONS[0]] } })
    renderApp('/conta')

    expect(await screen.findByText('Este aparelho')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sair dos outros aparelhos' }),
    ).not.toBeInTheDocument()
  })

  it('mostra o erro se não conseguir terminar a sessão', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /auth/sessions': { body: SESSIONS },
      'DELETE /auth/sessions/2': { status: 404, body: { detail: 'Sessão não encontrada' } },
    })
    renderApp('/conta')

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Terminar sessão: App Warrantly: Pixel 8 (Android 16)',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Sessão não encontrada')
    expect(within(sessionList()).getAllByRole('listitem')).toHaveLength(3)
  })
})
