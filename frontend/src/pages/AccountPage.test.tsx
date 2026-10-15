import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, renderApp, USER } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

describe('AccountPage', () => {
  it('abre a partir do email na barra de topo e altera o nome', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases': { body: [] },
      'PATCH /auth/me': (init) => ({ body: { ...USER, ...JSON.parse(init!.body as string) } }),
    })
    renderApp('/')

    await userEvent.click(await screen.findByRole('link', { name: USER.email }))
    const name = await screen.findByLabelText(/^Nome/)
    expect(name).toHaveValue('Ana Silva')
    await userEvent.clear(name)
    await userEvent.type(name, 'Ana Sofia Silva')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Guardado.')
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')
    expect(JSON.parse(patch![1]!.body as string)).toEqual({ full_name: 'Ana Sofia Silva' })
  })

  it('muda o tema e lembra-se dele', async () => {
    mockApi({ 'GET /auth/me': { body: USER } })
    renderApp('/conta')

    const select = await screen.findByLabelText('Tema')
    expect(select).toHaveValue('system')
    await userEvent.selectOptions(select, 'dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('warrantly.theme')).toBe('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  it('descarrega o ZIP com os dados', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/export': { body: 'zip' },
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:zip'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp('/conta')

    await userEvent.click(await screen.findByRole('button', { name: 'Descarregar ZIP' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Descarregado.')
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toMatch(/^warrantly-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(link.getAttribute('href')).toBe('blob:zip')
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/purchases/export')
    expect(new Headers(call![1]!.headers).get('Authorization')).toBe('Bearer token-de-teste')
    click.mockRestore()
  })

  it('mostra o erro quando a exportação falha', async () => {
    mockApi({
      'GET /auth/me': { body: USER },
      'GET /purchases/export': { status: 500, body: { detail: 'Falhou' } },
    })
    renderApp('/conta')

    await userEvent.click(await screen.findByRole('button', { name: 'Descarregar ZIP' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descarregar ZIP' })).toBeEnabled()
  })

  it('apaga a conta com a palavra-passe e volta ao login', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = mockApi({
      'GET /auth/me': { body: USER },
      'DELETE /auth/me': { status: 204 },
    })
    renderApp('/conta')

    await userEvent.type(await screen.findByLabelText(/Palavra-passe/), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('A tua conta foi apagada.')
    expect(localStorage.getItem('warrantly.token')).toBeNull()
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')
    expect(JSON.parse(call![1]!.body as string)).toEqual({ password: 'segredo123' })
  })

  it('mostra o erro com a palavra-passe errada e não sai', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockApi({
      'GET /auth/me': { body: USER },
      'DELETE /auth/me': { status: 403, body: { detail: 'Palavra-passe incorreta' } },
    })
    renderApp('/conta')

    await userEvent.type(await screen.findByLabelText(/Palavra-passe/), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Palavra-passe incorreta')
    expect(screen.getByRole('heading', { name: 'A tua conta' })).toBeInTheDocument()
  })

  it('não apaga se o utilizador cancelar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetchMock = mockApi({ 'GET /auth/me': { body: USER } })
    renderApp('/conta')

    await userEvent.type(await screen.findByLabelText(/Palavra-passe/), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Apagar conta' }))

    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)
  })
})
