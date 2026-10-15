import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePurchase, mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

const CLAIM = {
  subject: 'Reclamação ao abrigo da garantia: Máquina de lavar Bosch',
  body: 'Exmos. Senhores Worten,\n\n...\n\nCom os melhores cumprimentos,\nAna Silva\nana@example.com',
  within_warranty: true,
}

async function describeProblem(text = 'Não centrifuga e dá o erro E18.') {
  await userEvent.type(await screen.findByLabelText('Descreve o problema'), text)
}

describe('ClaimSection', () => {
  it('gera a reclamação e mostra o texto para copiar ou enviar por email', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
      'POST /purchases/1/claim': { body: CLAIM },
    })
    renderApp('/compras/1')
    await describeProblem()

    await userEvent.click(screen.getByRole('button', { name: 'Gerar reclamação' }))

    expect(await screen.findByLabelText('Texto da reclamação')).toHaveTextContent(
      'Exmos. Senhores Worten,',
    )
    expect(screen.getByText(CLAIM.subject)).toBeInTheDocument()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases/1/claim')
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      description: 'Não centrifuga e dá o erro E18.',
    })
    const mail = screen.getByRole('link', { name: 'Abrir no email' })
    expect(mail.getAttribute('href')).toMatch(/^mailto:\?subject=Reclama/)
    expect(screen.queryByLabelText(/O teu nome/)).not.toBeInTheDocument()
  })

  it('copia o assunto e o texto', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
      'POST /purchases/1/claim': { body: CLAIM },
    })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderApp('/compras/1')
    await user.type(await screen.findByLabelText('Descreve o problema'), 'Avaria')
    await user.click(screen.getByRole('button', { name: 'Gerar reclamação' }))

    await user.click(await screen.findByRole('button', { name: 'Copiar texto' }))

    expect(writeText).toHaveBeenCalledWith(`${CLAIM.subject}\n\n${CLAIM.body}`)
    expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument()
  })

  it('sem nome no perfil, pede-o e guarda-o antes de gerar', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: { ...USER, full_name: null } },
      'GET /purchases/1': { body: makePurchase() },
      'PATCH /auth/me': (init) => ({ body: { ...USER, ...JSON.parse(init!.body as string) } }),
      'POST /purchases/1/claim': { body: CLAIM },
    })
    renderApp('/compras/1')

    await userEvent.type(await screen.findByLabelText(/O teu nome/), 'José Ferrão')
    await describeProblem()
    await userEvent.click(screen.getByRole('button', { name: 'Gerar reclamação' }))

    await screen.findByLabelText('Texto da reclamação')
    const calls = fetchMock.mock.calls.map((c) => `${c[1]?.method ?? 'GET'} ${c[0]}`)
    expect(calls.indexOf('PATCH /api/auth/me')).toBeLessThan(
      calls.indexOf('POST /api/purchases/1/claim'),
    )
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')
    expect(JSON.parse(patch![1]!.body as string)).toEqual({ full_name: 'José Ferrão' })
    expect(screen.queryByLabelText(/O teu nome/)).not.toBeInTheDocument()
  })

  it('descarrega o PDF da carta mostrada', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
      'POST /purchases/1/claim': { body: CLAIM },
      'POST /purchases/1/claim.pdf': { body: '%PDF-1.7' },
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp('/compras/1')
    await describeProblem('Não liga.')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar reclamação' }))
    await screen.findByLabelText('Texto da reclamação')
    await userEvent.type(screen.getByLabelText('Descreve o problema'), ' (editado)')

    await userEvent.click(screen.getByRole('button', { name: 'Descarregar PDF' }))

    await vi.waitFor(() => expect(click).toHaveBeenCalled())
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('reclamacao-1.pdf')
    expect(link.getAttribute('href')).toBe('blob:pdf')
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases/1/claim.pdf')
    expect(JSON.parse(call![1]!.body as string)).toEqual({ description: 'Não liga.' })
    expect(new Headers(call![1]!.headers).get('Authorization')).toBe('Bearer token-de-teste')
  })

  it('avisa quando a garantia já terminou', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase({ status: 'expired' }) },
      'POST /purchases/1/claim': { body: { ...CLAIM, within_warranty: false } },
    })
    renderApp('/compras/1')
    await describeProblem()

    await userEvent.click(screen.getByRole('button', { name: 'Gerar reclamação' }))

    expect(await screen.findByRole('status')).toHaveTextContent('A garantia desta compra já terminou')
  })
})
