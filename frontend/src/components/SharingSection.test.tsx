import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePurchase, mockApi, renderApp, USER } from '../test/utils'
import type { Sharing } from '../types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SHARING: Sharing = {
  members: [
    {
      id: 4,
      email: 'rui@example.com',
      accepted: true,
      created_at: '2026-10-10T09:00:00Z',
    },
  ],
  shared_with_me: [
    {
      id: 7,
      owner_name: 'Maria Silva',
      owner_email: 'maria@example.com',
      accepted: false,
      created_at: '2026-10-18T09:00:00Z',
    },
  ],
}

function section() {
  return screen.getByRole('region', { name: 'Partilha' })
}

describe('SharingSection', () => {
  it('convida alguém pelo email', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'POST /sharing': {
        status: 201,
        body: {
          id: 5,
          email: 'joao@example.com',
          accepted: false,
          created_at: '2026-10-19T09:00:00Z',
        },
      },
    })
    renderApp('/conta')

    const input = await screen.findByLabelText('Email de quem convidas')
    await userEvent.type(input, 'joao@example.com')
    await userEvent.click(within(section()).getByRole('button', { name: 'Convidar' }))

    expect(
      await within(section()).findByText('Convite enviado para joao@example.com.'),
    ).toBeInTheDocument()
    expect(within(section()).getByText('Ainda não aceitou')).toBeInTheDocument()
    expect(input).toHaveValue('')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && init.body)!
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      email: 'joao@example.com',
    })
  })

  it('mostra o erro da API (ex.: já partilhado)', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'POST /sharing': {
        status: 409,
        body: { detail: 'Já partilhaste o arquivo com este email' },
      },
    })
    renderApp('/conta')

    await userEvent.type(await screen.findByLabelText('Email de quem convidas'), 'rui@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Convidar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já partilhaste o arquivo com este email',
    )
  })

  it('aceita um convite e deixa de partilhar com alguém', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /sharing': { body: SHARING },
      'POST /sharing/7/accept': {
        body: { ...SHARING.shared_with_me[0], accepted: true },
      },
      'DELETE /sharing/4': { status: 204 },
    })
    renderApp('/conta')

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Aceitar o convite de Maria Silva',
      }),
    )
    expect(
      await screen.findByText('As compras de Maria Silva já aparecem nas tuas garantias.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sair do arquivo de Maria Silva' }),
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Deixar de partilhar com rui@example.com',
      }),
    )
    expect(
      await screen.findByText('Deixaste de partilhar com rui@example.com.'),
    ).toBeInTheDocument()
    expect(window.confirm).toHaveBeenCalledWith(
      'Deixar de partilhar o arquivo com rui@example.com?',
    )
    expect(within(section()).queryByText('rui@example.com')).toBeNull()
  })
})

describe('compras partilhadas', () => {
  const SHARED = makePurchase({
    id: 9,
    user_id: 2,
    owner_name: 'Maria Silva',
    invoice_filename: 'fatura.pdf',
    invoice_content_type: 'application/pdf',
  })

  it('no painel, mostram de quem são', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases': { body: [makePurchase(), SHARED] },
    })
    renderApp('/')

    const rows = await screen.findAllByRole('row')
    expect(rows.some((r) => within(r).queryByText('de Maria Silva'))).toBe(true)
    expect(screen.getAllByText(/^de /)).toHaveLength(1) // as minhas não têm a etiqueta
  })

  it('no detalhe, não se apagam nem se troca a fatura', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/9': { body: SHARED },
    })
    renderApp('/compras/9')

    expect(await screen.findByText(/Partilhada por Maria Silva/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver fatura' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apagar compra' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apagar fatura' })).toBeNull()
    expect(screen.queryByLabelText(/fatura/i, { selector: 'input[type=file]' })).toBeNull()
  })
})
