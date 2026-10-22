import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePurchase, mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

describe('PurchaseDetailPage', () => {
  it('mostra os dados da compra e da fatura', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': {
        body: makePurchase({ invoice_filename: 'fatura-worten.pdf', store_nif: '503630330' }),
      },
    })
    renderApp('/compras/1')

    expect(await screen.findByRole('heading', { name: 'Máquina de lavar Bosch' })).toBeInTheDocument()
    expect(screen.getByText(/Worten · comprada a 03\/11\/2023 · 429,00\s€/)).toBeInTheDocument()
    expect(screen.getByText('03/11/2026')).toBeInTheDocument()
    expect(screen.getByText('fatura-worten.pdf')).toBeInTheDocument()
    expect(screen.getByText('503630330')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver fatura' })).toBeInTheDocument()
  })

  it('não abre a fatura se o ficheiro não for PDF nem imagem', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase({ invoice_filename: 'fatura.pdf' }) },
      // A simulação responde com application/json: um tipo que nunca se deve abrir.
      'GET /purchases/1/invoice': { body: '<script>alert(1)</script>' },
    })
    const tab = { close: vi.fn(), location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    renderApp('/compras/1')

    await userEvent.click(await screen.findByRole('button', { name: 'Ver fatura' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao abrir a fatura')
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.href).toBe('')
  })

  it('apaga a compra depois de confirmar e volta ao painel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
      'DELETE /purchases/1': { status: 204 },
      'GET /purchases': { body: [] },
    })
    renderApp('/compras/1')

    await userEvent.click(await screen.findByRole('button', { name: 'Apagar compra' }))

    expect(await screen.findByText('Ainda não tens compras registadas')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true)
  })

  it('não apaga se o utilizador cancelar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
    })
    renderApp('/compras/1')

    await userEvent.click(await screen.findByRole('button', { name: 'Apagar compra' }))

    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Máquina de lavar Bosch' })).toBeInTheDocument()
  })

  it('mostra o erro da API ao enviar uma fatura inválida', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/1': { body: makePurchase() },
      'PUT /purchases/1/invoice': {
        status: 415,
        body: { detail: 'A fatura tem de ser um PDF ou uma imagem (JPEG, PNG ou WebP)' },
      },
    })
    renderApp('/compras/1')
    const file = new File(['olá'], 'notas.pdf', { type: 'application/pdf' })

    await userEvent.upload(await screen.findByLabelText('Fatura'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar fatura' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A fatura tem de ser um PDF')
  })
})
