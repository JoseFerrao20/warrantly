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
  it('lê a fatura e preenche só os campos vazios', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'POST /purchases/scan-invoice': {
        body: {
          text_found: true,
          ocr_available: true,
          product_name: 'Máquina de lavar Bosch',
          store: 'Worten',
          purchase_date: '2023-11-03',
          price: '429.00',
          invoice_number: 'FT 2023/48213',
          store_email: null,
        },
      },
    })
    renderApp('/compras/nova')
    // O utilizador já escreveu o produto: a leitura não o substitui.
    await userEvent.type(await screen.findByLabelText('Produto'), 'Máquina da cozinha')

    const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Fatura'), file)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Lemos a fatura e preenchemos: loja, preço, data e n.º da fatura. Confirma os valores antes de guardar.',
    )
    expect(screen.getByLabelText('Produto')).toHaveValue('Máquina da cozinha')
    expect(screen.getByLabelText('Loja')).toHaveValue('Worten')
    expect(screen.getByLabelText('Preço (€)')).toHaveValue('429,00')
    expect(screen.getByLabelText('Data de compra')).toHaveValue('2023-11-03')
    expect(screen.getByLabelText(/N\.º da fatura/)).toHaveValue('FT 2023/48213')
    expect(screen.getByLabelText(/Email da loja/)).toHaveValue('')
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases/scan-invoice')
    expect((call![1]!.body as FormData).get('file')).toBe(file)
  })

  it('avisa quando não consegue ler a fatura', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'POST /purchases/scan-invoice': {
        body: {
          text_found: false,
          ocr_available: true,
          product_name: null,
          store: null,
          purchase_date: null,
          price: null,
          invoice_number: null,
          store_email: null,
        },
      },
    })
    renderApp('/compras/nova')
    const file = new File(['\x89PNG'], 'foto.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Fatura'), file)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não conseguimos ler os dados desta fatura; preenche à mão.',
    )
    expect(screen.getByLabelText('Loja')).toHaveValue('')
  })

  it('com S3, envia a fatura diretamente para o bucket uma só vez', async () => {
    const created = makePurchase({ id: 7, product_name: 'Portátil Lenovo IdeaPad 5', store: 'Fnac' })
    const token = 'a'.repeat(32)
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'POST /purchases/uploads': {
        body: {
          direct: true,
          max_bytes: 10 * 1024 * 1024,
          token,
          url: 'https://faturas.s3.eu-central-1.amazonaws.com/',
          fields: { key: `uploads/1/${token}`, policy: 'p', 'x-amz-signature': 's' },
        },
      },
      'POST https://faturas.s3.eu-central-1.amazonaws.com/': { status: 204 },
      [`POST /purchases/uploads/${token}/scan`]: {
        body: {
          text_found: true,
          ocr_available: true,
          product_name: null,
          store: 'Fnac',
          purchase_date: null,
          price: null,
          invoice_number: null,
          store_email: null,
        },
      },
      'POST /purchases': { status: 201, body: created },
      'PUT /purchases/7/invoice/upload': { body: { ...created, invoice_filename: 'fatura.pdf' } },
      'GET /purchases/7': { body: { ...created, invoice_filename: 'fatura.pdf' } },
    })
    renderApp('/compras/nova')
    const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' })
    await userEvent.upload(await screen.findByLabelText('Fatura'), file)
    expect(await screen.findByRole('status')).toHaveTextContent('preenchemos: loja')
    await fillForm()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('heading', { name: 'Portátil Lenovo IdeaPad 5' })).toBeInTheDocument()
    const s3Calls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://faturas'))
    expect(s3Calls).toHaveLength(1) // a leitura e a gravação usam o mesmo envio
    const sent = s3Calls[0][1]!.body as FormData
    expect([...sent.keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'file'])
    expect(sent.get('file')).toBe(file)
    expect(new Headers(s3Calls[0][1]!.headers).get('Authorization')).toBeNull()
    const attach = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases/7/invoice/upload')
    expect(JSON.parse(attach![1]!.body as string)).toEqual({ token, filename: 'fatura.pdf' })
  })

  it('recusa logo uma fatura maior do que o limite', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'POST /purchases/uploads': {
        body: { direct: true, max_bytes: 4, token: 'b'.repeat(32), url: 'https://s3/', fields: {} },
      },
      'POST /purchases': { status: 201, body: makePurchase({ id: 8 }) },
      'GET /purchases/8': { body: makePurchase({ id: 8 }) },
    })
    renderApp('/compras/nova')
    await userEvent.upload(
      await screen.findByLabelText('Fatura'),
      new File(['%PDF-1.4 grande'], 'f.pdf', { type: 'application/pdf' }),
    )
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    // A compra fica guardada; o erro da fatura aparece no detalhe.
    expect(await screen.findByRole('alert')).toHaveTextContent('não pode ter mais de 0 MB')
  })

  it('a zona da fatura é um botão que abre o seletor de ficheiros', async () => {
    mockApi({ 'GET /auth/me': { body: USER } })
    renderApp('/compras/nova')
    const input = (await screen.findByLabelText('Fatura')) as HTMLInputElement
    const click = vi.spyOn(input, 'click')

    const dropzone = screen.getByRole('button', { name: /Arrasta a fatura/ })
    dropzone.focus()
    await userEvent.keyboard('{Enter}')

    expect(click).toHaveBeenCalled()
    expect(document.title).toBe('Nova compra · Warrantly')
  })

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
      invoice_number: null,
      store_email: null,
      store_nif: null,
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

it('envia o número da fatura quando preenchido', async () => {
  const created = makePurchase({ id: 8 })
  const fetchMock = mockApi({
    'GET /auth/me': { body: USER },
    'POST /purchases': { status: 201, body: created },
    'GET /purchases/8': { body: created },
  })
  renderApp('/compras/nova')
  await fillForm()
  await userEvent.type(screen.getByLabelText(/N\.º da fatura/), ' FT 2026/12345 ')

  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

  await screen.findByRole('heading', { name: created.product_name })
  const create = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
  expect(JSON.parse(create![1]!.body as string).invoice_number).toBe('FT 2026/12345')
})

it('com o NIF da loja do código QR, avisa de uma fatura já registada e guarda o NIF', async () => {
  const created = makePurchase({ id: 8 })
  const fetchMock = mockApi({
    'GET /auth/me': { body: USER },
    'POST /purchases/scan-invoice': {
      body: {
        text_found: true,
        ocr_available: true,
        product_name: null,
        store: 'Worten Amadora', // o nome que o utilizador deu a este NIF da última vez
        purchase_date: '2023-11-05',
        price: '490.00',
        invoice_number: 'FR 0123/456790',
        store_email: null,
        store_nif: '503630330',
        duplicate_purchase_id: 3,
      },
    },
    'POST /purchases': { status: 201, body: created },
    'GET /purchases/8': { body: created },
  })
  renderApp('/compras/nova')
  const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' })
  await userEvent.upload(await screen.findByLabelText('Fatura'), file)

  expect(await screen.findByRole('status')).toHaveTextContent('NIF da loja')
  expect(screen.getByLabelText('Loja')).toHaveValue('Worten Amadora')
  expect(screen.getByLabelText(/NIF da loja/)).toHaveValue('503630330')
  expect(screen.getByRole('alert')).toHaveTextContent('Já tens uma compra com esta fatura')
  expect(screen.getByRole('link', { name: 'Ver a compra registada' })).toHaveAttribute(
    'href',
    '/compras/3',
  )

  await userEvent.type(screen.getByLabelText('Produto'), 'Máquina de lavar')
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

  await screen.findByRole('heading', { name: created.product_name })
  const create = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases')
  expect(JSON.parse(create![1]!.body as string).store_nif).toBe('503630330')
})
