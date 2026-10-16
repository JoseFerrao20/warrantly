import * as SecureStore from 'expo-secure-store'
import { renderRouter } from 'expo-router/testing-library'

import RootLayout from '@/app/_layout'
import PurchaseScreen from '@/app/compras/[id]'
import NewPurchaseScreen from '@/app/compras/nova'
import LoginScreen from '@/app/entrar'
import DashboardScreen from '@/app/index'
import type { Purchase, User } from '@/shared/types'

export const USER: User = {
  id: 1,
  email: 'ana@example.com',
  full_name: 'Ana',
  created_at: '2026-01-01T10:00:00Z',
}

export function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 1,
    product_name: 'Máquina de lavar Bosch',
    store: 'Worten',
    category: null,
    purchase_date: '2025-03-10',
    price: '429.00',
    warranty_months: 36,
    warranty_end: '2028-03-10',
    invoice_number: null,
    store_email: null,
    invoice_filename: null,
    invoice_content_type: null,
    invoice_size: null,
    created_at: '2025-03-10T10:00:00Z',
    updated_at: '2025-03-10T10:00:00Z',
    status: 'active',
    ...overrides,
  }
}

type Handler = (init: RequestInit & { url: string }) => unknown
export interface Call {
  method: string
  url: string
  init: RequestInit
}

const NO_CONTENT = { status: 204, body: null }

/**
 * Substitui o fetch: cada rota ("GET /purchases") devolve um corpo JSON, ou uma função que
 * recebe o pedido. Um `{ status, body }` simula um erro. Rotas desconhecidas dão 404. Os
 * tokens de push são aceites, a não ser que o teste diga outra coisa.
 */
export function mockApi(testRoutes: Record<string, unknown | Handler>): Call[] {
  const routes: Record<string, unknown | Handler> = {
    'POST /push-tokens': NO_CONTENT,
    'DELETE /push-tokens': NO_CONTENT,
    ...testRoutes,
  }
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    calls.push({ method, url, init })
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${url}`]
    let body = typeof route === 'function' ? (route as Handler)({ ...init, url }) : route
    let status = route === undefined ? 404 : 200
    if (body && typeof body === 'object' && 'status' in body && 'body' in body) {
      ;({ status, body } = body as { status: number; body: unknown })
    }
    return {
      ok: status < 400,
      status,
      json: async () => body ?? { detail: 'Não encontrado' },
    } as Response
  }) as typeof fetch
  return calls
}

export async function signIn() {
  await SecureStore.setItemAsync('warrantly.token', 'token-de-teste')
}

export function resetStorage() {
  ;(SecureStore as unknown as { __reset: () => void }).__reset()
}

export function renderApp(initialUrl = '/') {
  return renderRouter(
    {
      _layout: RootLayout,
      index: DashboardScreen,
      entrar: LoginScreen,
      'compras/nova': NewPurchaseScreen,
      'compras/[id]': PurchaseScreen,
    },
    { initialUrl },
  )
}
