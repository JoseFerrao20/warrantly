import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePurchase, mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

async function fillForm() {
  await userEvent.type(await screen.findByLabelText('Produto'), 'Portátil Lenovo IdeaPad 5')
  await userEvent.type(screen.getByLabelText('Loja'), 'Fnac')
  await userEvent.type(screen.getByLabelText('Preço (€)'), '749,99')
  const date = screen.getByLabelText('Data de compra')
  await userEvent.clear(date)
  await userEvent.type(date, '2026-02-14')
}

describe('PurchaseFormPage', () => {
  it('calcula a data de fim da garantia enquanto se preenche', async () => {
    mockApi({ 'GET /auth/me': { body: USER } })
    renderApp('/compras/nova')
    await fillForm()

    expect(screen.getByText('14 de fevereiro de 2029')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Garantia'), '24')
    expect(screen.getByText('14 de fevereiro de 2028')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Garantia'), 'custom')
    await userEvent.type(screen.getByLabelText('Meses de garantia'), '6')
    expect(screen.getByText('14 de agosto de 2026')).toBeInTheDocument()
  })

  it('cria a compra, envia a fatura e abre o detalhe', async () => {
    const created = makePurchase({ id: 7, product_name: 'Portátil Lenovo IdeaPad 5', store: 'Fnac' })
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'POST /purchases': { status: 201, body: created },
      'PUT /purchases/7/invoice': { body: { ...created, invoice_filename: 'fatura.pdf' } },
      'GET /purchases/7': { body: { ...created, invoice_filename: 'fatura.pdf' } },
    })
    renderApp('/compras/nova')
    await fillForm()
    const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Fatura'), file)

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('heading', { name: 'Portátil Lenovo IdeaPad 5' })).toBeInTheDocument()
    const create = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST' && c[0] === '/api/purchases')
    expect(JSON.parse(create![1]!.body as string)).toEqual({
      product_name: 'Portátil Lenovo IdeaPad 5',
      store: 'Fnac',
      category: null,
      purchase_date: '2026-02-14',
      price: '749.99',
      warranty_months: 36,
    })
    const upload = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
    expect((upload![1]!.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('não envia um preço inválido', async () => {
    const fetchMock = mockApi({ 'GET /auth/me': { body: USER } })
    renderApp('/compras/nova')
    await fillForm()
    await userEvent.clear(screen.getByLabelText('Preço (€)'))
    await userEvent.type(screen.getByLabelText('Preço (€)'), '12,345')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Preço inválido')
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
  })

  it('edita uma compra existente com os valores preenchidos', async () => {
    const purchase = makePurchase({ id: 3, price: '429.00', warranty_months: 24 })
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/3': { body: purchase },
      'PATCH /purchases/3': (init) => ({ body: { ...purchase, ...JSON.parse(init!.body as string) } }),
    })
    renderApp('/compras/3/editar')

    expect(await screen.findByDisplayValue('Máquina de lavar Bosch')).toBeInTheDocument()
    expect(screen.getByLabelText('Preço (€)')).toHaveValue('429,00')
    expect(screen.getByLabelText('Garantia')).toHaveValue('24')

    await userEvent.clear(screen.getByLabelText('Loja'))
    await userEvent.type(screen.getByLabelText('Loja'), 'Fnac')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByRole('heading', { name: 'Máquina de lavar Bosch' })
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')
    expect(JSON.parse(patch![1]!.body as string)).toMatchObject({ store: 'Fnac', price: '429.00' })
  })
})
