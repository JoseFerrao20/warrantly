import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, renderApp } from '../test/utils'

afterEach(() => vi.unstubAllGlobals())

const SENT = 'Se existir uma conta com este email, enviámos um link para repor a palavra-passe.'

describe('recuperar a palavra-passe', () => {
  it('o login tem um link para recuperar a palavra-passe', async () => {
    mockApi({})
    renderApp('/entrar', { loggedIn: false })

    await userEvent.click(screen.getByRole('link', { name: 'Esqueci-me da palavra-passe' }))

    expect(
      await screen.findByRole('heading', { name: 'Recuperar a palavra-passe' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Recuperar a palavra-passe · Warrantly')
  })

  it('pede o link e mostra a mesma mensagem, exista ou não a conta', async () => {
    const fetchMock = mockApi({ 'POST /auth/password-reset': { status: 202, body: { detail: SENT } } })
    renderApp('/recuperar-palavra-passe', { loggedIn: false })

    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(SENT)
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/password-reset')!
    expect(JSON.parse(call[1]!.body as string)).toEqual({ email: 'ana@example.com' })
  })

  it('mostra o erro quando o email não está configurado', async () => {
    mockApi({
      'POST /auth/password-reset': {
        status: 503,
        body: { detail: 'O envio de emails não está configurado' },
      },
    })
    renderApp('/recuperar-palavra-passe', { loggedIn: false })

    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O envio de emails não está configurado')
  })
})

describe('nova palavra-passe', () => {
  async function fill(password: string, confirmation = password) {
    await userEvent.type(screen.getByLabelText('Nova palavra-passe'), password)
    await userEvent.type(screen.getByLabelText('Repetir a palavra-passe'), confirmation)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar palavra-passe' }))
  }

  it('muda a palavra-passe com o token do link e volta ao login', async () => {
    const fetchMock = mockApi({ 'POST /auth/password-reset/confirm': { status: 204 } })
    renderApp('/repor-palavra-passe#token=abc.def.ghi', { loggedIn: false })

    await fill('nova-palavra-passe')

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'A palavra-passe foi alterada. Entra com a nova.',
    )
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/password-reset/confirm')!
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      token: 'abc.def.ghi',
      password: 'nova-palavra-passe',
    })
  })

  it('as duas palavras-passe têm de ser iguais', async () => {
    const fetchMock = mockApi({})
    renderApp('/repor-palavra-passe#token=abc', { loggedIn: false })

    await fill('nova-palavra-passe', 'outra-coisa-qualquer')

    expect(screen.getByRole('alert')).toHaveTextContent('As palavras-passe não são iguais.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('com o link expirado, oferece um novo', async () => {
    mockApi({
      'POST /auth/password-reset/confirm': {
        status: 400,
        body: { detail: 'O link é inválido ou já expirou. Pede um novo.' },
      },
    })
    renderApp('/repor-palavra-passe#token=velho', { loggedIn: false })

    await fill('nova-palavra-passe')

    expect(await screen.findByRole('alert')).toHaveTextContent('O link é inválido ou já expirou.')
    expect(screen.getByRole('link', { name: 'Pedir um novo link' })).toHaveAttribute(
      'href',
      '/recuperar-palavra-passe',
    )
  })

  it('sem token no link, explica o que fazer', () => {
    mockApi({})
    renderApp('/repor-palavra-passe', { loggedIn: false })

    expect(screen.getByRole('alert')).toHaveTextContent('Este link não está completo.')
    expect(screen.queryByLabelText('Nova palavra-passe')).not.toBeInTheDocument()
  })
})
