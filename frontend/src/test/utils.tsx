import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import { App } from '../App'
import { AuthProvider } from '../auth'
import type { Purchase } from '../types'

type Handler = (init: RequestInit | undefined) => { status?: number; body?: unknown }

/**
 * Simula a API: cada chave é "MÉTODO /caminho" (sem o /api). Devolve o mock do fetch
 * para os testes verificarem os pedidos feitos.
 */
export function mockApi(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, '')
    const key = `${init?.method ?? 'GET'} ${path}`
    const route = routes[key]
    if (!route) throw new Error(`Pedido inesperado: ${key}`)
    const { status = 200, body } = typeof route === 'function' ? route(init) : route
    return new Response(status === 204 ? null : JSON.stringify(body ?? null), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const USER = { id: 1, email: 'ana@example.com', created_at: '2026-10-01T10:00:00Z' }

export function renderApp(path: string, { loggedIn = true } = {}) {
  if (loggedIn) localStorage.setItem('warrantly.token', 'token-de-teste')
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

export function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 1,
    product_name: 'Máquina de lavar Bosch',
    store: 'Worten',
    category: 'Eletrodomésticos',
    purchase_date: '2023-11-03',
    price: '429.00',
    warranty_months: 36,
    warranty_end: '2026-11-03',
    invoice_filename: null,
    invoice_content_type: null,
    invoice_size: null,
    created_at: '2023-11-03T10:00:00Z',
    updated_at: '2023-11-03T10:00:00Z',
    status: 'expiring',
    ...overrides,
  }
}
