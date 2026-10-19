import { File } from 'expo-file-system'
import { shareAsync } from 'expo-sharing'
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library'
import { Alert } from 'react-native'
import type { AlertButton } from 'react-native'

import type { Sharing, UserSession } from '@/shared/types'
import { USER, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(resetStorage)
afterEach(() => jest.clearAllMocks())

const SESSIONS: UserSession[] = [
  {
    id: 3,
    device: 'App Warrantly: Pixel 8 (Android)',
    created_at: '2026-10-10T09:00:00Z',
    last_used_at: '2026-10-19T08:30:00Z',
    current: true,
  },
  {
    id: 2,
    device: 'Chrome no Windows',
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

async function openAccount(routes: Record<string, unknown>) {
  await signIn()
  const calls = mockApi({ 'GET /auth/me': USER, 'GET /purchases': [], ...routes })
  const app = await renderApp()
  await fireEvent.press(await screen.findByRole('link', { name: 'Conta' }))
  await waitFor(() => expect(app.getPathname()).toBe('/conta'))
  return { app, calls }
}

test('a conta mostra o email e as sessões, com este telemóvel marcado', async () => {
  await openAccount({ 'GET /auth/sessions': SESSIONS })

  expect(await screen.findByText(USER.email)).toBeOnTheScreen()
  const phone = await screen.findByLabelText('Sessão: App Warrantly: Pixel 8 (Android)')
  expect(within(phone).getByText('Este telemóvel')).toBeOnTheScreen()
  expect(within(phone).queryByRole('button')).toBeNull()
  expect(within(phone).getByText(/^Última atividade: .*2026/)).toBeOnTheScreen()
  // As outras têm "Terminar".
  expect(screen.getByRole('button', { name: 'Terminar sessão: Safari no iPhone' })).toBeOnTheScreen()
})

test('termina a sessão de outro aparelho', async () => {
  const { calls } = await openAccount({
    'GET /auth/sessions': SESSIONS,
    'DELETE /auth/sessions/2': { status: 204, body: null },
  })

  await fireEvent.press(
    await screen.findByRole('button', { name: 'Terminar sessão: Chrome no Windows' }),
  )

  expect(await screen.findByText('Sessão terminada: Chrome no Windows.')).toBeOnTheScreen()
  expect(screen.queryByLabelText('Sessão: Chrome no Windows')).toBeNull()
  expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/auth/sessions/2'))).toBe(true)
})

test('sai dos outros aparelhos e fica só este', async () => {
  await openAccount({
    'GET /auth/sessions': SESSIONS,
    'POST /auth/sessions/end-others': { ended: 2 },
  })

  await fireEvent.press(await screen.findByRole('button', { name: 'Sair dos outros aparelhos' }))

  expect(await screen.findByText('Terminadas 2 sessões.')).toBeOnTheScreen()
  expect(screen.queryByLabelText('Sessão: Safari no iPhone')).toBeNull()
  expect(screen.getByLabelText('Sessão: App Warrantly: Pixel 8 (Android)')).toBeOnTheScreen()
  expect(screen.queryByRole('button', { name: 'Sair dos outros aparelhos' })).toBeNull()
})

test('só com este telemóvel não há botão para sair dos outros', async () => {
  await openAccount({ 'GET /auth/sessions': [SESSIONS[0]] })

  expect(await screen.findByText('Este telemóvel')).toBeOnTheScreen()
  expect(screen.queryByRole('button', { name: 'Sair dos outros aparelhos' })).toBeNull()
})

test('mostra o erro se não conseguir terminar a sessão', async () => {
  await openAccount({
    'GET /auth/sessions': SESSIONS,
    'DELETE /auth/sessions/1': { status: 404, body: { detail: 'Sessão não encontrada' } },
  })

  await fireEvent.press(
    await screen.findByRole('button', { name: 'Terminar sessão: Safari no iPhone' }),
  )

  expect(await screen.findByRole('alert')).toHaveTextContent('Sessão não encontrada')
  expect(screen.getByLabelText('Sessão: Safari no iPhone')).toBeOnTheScreen()
})

describe('partilha', () => {
  const SHARING: Sharing = {
    members: [
      { id: 4, email: 'rui@example.com', accepted: true, created_at: '2026-10-10T09:00:00Z' },
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

  afterEach(() => jest.restoreAllMocks())

  /** Responde ao Alert como se a pessoa carregasse no botão com este texto. */
  function answerAlert(text: string) {
    return jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.text === text)?.onPress?.()
      })
  }

  test('convida alguém pelo email', async () => {
    const { calls } = await openAccount({
      'POST /sharing': {
        id: 5,
        email: 'joao@example.com',
        accepted: false,
        created_at: '2026-10-19T09:00:00Z',
      },
    })

    await fireEvent.changeText(
      await screen.findByLabelText('Email de quem convidas'),
      'joao@example.com',
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Convidar' }))

    expect(await screen.findByText('Convite enviado para joao@example.com.')).toBeOnTheScreen()
    expect(screen.getByLabelText('Partilha com joao@example.com')).toBeOnTheScreen()
    expect(screen.getByLabelText('Email de quem convidas')).toHaveDisplayValue('')
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/sharing'))!
    expect(JSON.parse(post.init.body as string)).toEqual({ email: 'joao@example.com' })
  })

  test('mostra o erro da API', async () => {
    await openAccount({
      'POST /sharing': {
        status: 409,
        body: { detail: 'Já partilhaste o arquivo com este email' },
      },
    })

    await fireEvent.changeText(
      await screen.findByLabelText('Email de quem convidas'),
      'rui@example.com',
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Convidar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já partilhaste o arquivo com este email',
    )
  })

  test('aceita um convite e deixa de partilhar com alguém', async () => {
    const alert = answerAlert('Remover')
    const { calls } = await openAccount({
      'GET /sharing': SHARING,
      'POST /sharing/7/accept': { ...SHARING.shared_with_me[0], accepted: true },
      'DELETE /sharing/4': { status: 204, body: null },
    })

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Aceitar o convite de Maria Silva' }),
    )
    expect(
      await screen.findByText('As compras de Maria Silva já aparecem nas tuas garantias.'),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sair do arquivo de Maria Silva' })).toBeOnTheScreen()

    await fireEvent.press(
      screen.getByRole('button', { name: 'Remover a partilha com rui@example.com' }),
    )
    expect(await screen.findByText('Deixaste de partilhar com rui@example.com.')).toBeOnTheScreen()
    expect(alert).toHaveBeenCalledWith(
      'Deixar de partilhar o arquivo com rui@example.com?',
      undefined,
      expect.anything(),
    )
    expect(screen.queryByLabelText('Partilha com rui@example.com')).toBeNull()
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sharing/4'))).toBe(true)
  })

  test('recusar um convite pede confirmação', async () => {
    answerAlert('Cancelar')
    const { calls } = await openAccount({ 'GET /sharing': SHARING })

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Recusar o convite de Maria Silva' }),
    )

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByLabelText('Arquivo de Maria Silva')).toBeOnTheScreen()
  })
})

test('sem o email confirmado, a partilha pede o link e envia-o outra vez', async () => {
  await signIn()
  mockApi({
    'GET /auth/me': { ...USER, email_verified: false },
    'GET /purchases': [],
    'POST /auth/verify-email/resend': { detail: 'Enviámos um link para ana@example.com.' },
  })
  const app = await renderApp()
  await fireEvent.press(await screen.findByRole('link', { name: 'Conta' }))
  await waitFor(() => expect(app.getPathname()).toBe('/conta'))

  expect(await screen.findByText(/confirma primeiro o teu email/)).toBeOnTheScreen()
  expect(screen.queryByLabelText('Email de quem convidas')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Convidar' })).toBeNull()

  await fireEvent.press(screen.getByRole('button', { name: 'Enviar outra vez' }))
  expect(await screen.findByText('Enviámos um link para ana@example.com.')).toBeOnTheScreen()
})

test('exporta os dados num ZIP e abre o menu do sistema para o guardar', async () => {
  const { calls } = await openAccount({})

  await fireEvent.press(await screen.findByRole('button', { name: 'Exportar (ZIP)' }))

  await waitFor(() => expect(shareAsync).toHaveBeenCalled())
  const [[url, destination, options]] = jest.mocked(File.downloadFileAsync).mock.calls
  expect(url).toMatch(/\/purchases\/export$/)
  expect(destination.uri).toMatch(/^file:\/\/\/cache\/warrantly-\d{4}-\d{2}-\d{2}\.zip$/)
  expect(options).toMatchObject({ headers: { Authorization: expect.stringMatching(/^Bearer /) } })
  expect(shareAsync).toHaveBeenCalledWith(destination.uri, {
    mimeType: 'application/zip',
    dialogTitle: 'Guardar a exportação',
  })
  // Antes do download, o /auth/me renova o token de acesso se for preciso.
  expect(calls.some((c) => c.url.endsWith('/auth/me'))).toBe(true)
})

test('sem rede, a exportação avisa', async () => {
  await openAccount({})
  jest.mocked(File.downloadFileAsync).mockRejectedValueOnce(new Error('offline'))

  await fireEvent.press(await screen.findByRole('button', { name: 'Exportar (ZIP)' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Não foi possível exportar. Tenta outra vez.',
  )
  expect(shareAsync).not.toHaveBeenCalled()
})
