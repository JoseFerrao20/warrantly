import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePurchase, mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

// Pela ordem da API (fim da garantia, do mais antigo para o mais recente).
const PURCHASES = [
  makePurchase({ id: 4, product_name: 'Rádio antigo', store: 'Fnac', status: 'expired', warranty_end: '2024-03-01' }),
  makePurchase({ id: 3, product_name: 'Torradeira Philips', store: 'Continente', status: 'expired', warranty_end: '2025-01-10' }),
  makePurchase({ id: 1, product_name: 'Máquina de lavar Bosch', store: 'Worten', status: 'expiring' }),
  makePurchase({ id: 2, product_name: 'Portátil Lenovo', store: 'Fnac', status: 'active', warranty_end: '2029-02-14' }),
]

function setup() {
  mockApi({ 'GET /auth/me': { body: USER }, 'GET /purchases': { body: PURCHASES } })
  renderApp('/')
}

function productNames() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('DashboardPage', () => {
  it('mostra os totais por estado e as expiradas no fim da lista', async () => {
    setup()

    expect(await screen.findByText('Máquina de lavar Bosch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ativas\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /A expirar \(60 dias\)\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Expiradas\s*2/ })).toBeInTheDocument()
    expect(productNames()).toEqual([
      'Máquina de lavar Bosch',
      'Portátil Lenovo',
      'Torradeira Philips',
      'Rádio antigo',
    ])
    expect(screen.getAllByText('expirada')).toHaveLength(2)
  })

  it('filtra por estado ao clicar num cartão (e volta a mostrar tudo no segundo clique)', async () => {
    setup()
    const expired = await screen.findByRole('button', { name: /Expiradas/ })

    await userEvent.click(expired)
    expect(productNames()).toEqual(['Torradeira Philips', 'Rádio antigo'])
    expect(expired).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(expired)
    expect(productNames()).toHaveLength(4)
  })

  it('pesquisa por produto ou loja sem ligar a acentos', async () => {
    setup()
    const search = await screen.findByRole('searchbox', { name: 'Pesquisar compras' })

    await userEvent.type(search, 'maquina')
    expect(productNames()).toEqual(['Máquina de lavar Bosch'])

    await userEvent.clear(search)
    await userEvent.type(search, 'continente')
    expect(productNames()).toEqual(['Torradeira Philips'])

    await userEvent.clear(search)
    await userEvent.type(search, 'nada disto')
    expect(screen.getByText('Nenhuma compra corresponde à pesquisa.')).toBeInTheDocument()
  })

  it('abre o detalhe ao clicar numa compra', async () => {
    setup()
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases': { body: PURCHASES },
      'GET /purchases/2': { body: PURCHASES[3] },
    })

    await userEvent.click(await screen.findByText('Portátil Lenovo'))

    expect(await screen.findByRole('heading', { name: 'Portátil Lenovo' })).toBeInTheDocument()
    expect(screen.getByText('← Garantias')).toBeInTheDocument()
  })
})
