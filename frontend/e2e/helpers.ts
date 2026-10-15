import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export const PASSWORD = 'e2e-palavra-passe'

/** Email único por teste: os testes correm em paralelo contra a mesma base de dados. */
export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

/** Data AAAA-MM-DD a `months` meses e `days` dias de hoje (valores negativos = passado). */
export function dateFromToday(months: number, days = 0): string {
  const date = new Date()
  date.setMonth(date.getMonth() + months)
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Cria uma conta pela API e deixa a página com a sessão iniciada (mais rápido do que pela UI). */
export async function signUp(page: Page, fullName: string | null = null) {
  const email = uniqueEmail()
  const register = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, full_name: fullName },
  })
  expect(register.status()).toBe(201)
  const login = await page.request.post('/api/auth/login', {
    form: { username: email, password: PASSWORD },
  })
  const { access_token: token } = (await login.json()) as { access_token: string }
  await page.addInitScript((value) => localStorage.setItem('warrantly.token', value), token)
  return { email, token }
}

export interface PurchaseData {
  product_name: string
  store: string
  purchase_date: string
  price: string
  warranty_months?: number
  category?: string | null
}

export async function createPurchase(page: Page, token: string, data: PurchaseData) {
  const response = await page.request.post('/api/purchases', {
    data,
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: number }
}
