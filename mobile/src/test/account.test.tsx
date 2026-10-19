import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library'

import type { UserSession } from '@/shared/types'
import { USER, mockApi, renderApp, resetStorage, signIn } from '@/test/utils'

beforeEach(resetStorage)

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
