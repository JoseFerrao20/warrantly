import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * Cria uma conta pela API e deixa a página com a sessão iniciada (mais rápido do que pela UI).
 * O `page.request` partilha os cookies com o browser: o login deixa lá o cookie do refresh
 * token, e o site, ao abrir, pede com ele o token de acesso (que só vive em memória).
 */
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
  await confirmEmail(page, email)
  return { email, token }
}

/** O link de confirmação do último email enviado para `email` (ADR 0008). */
export async function confirmationLink(email: string): Promise<string> {
  const body = await lastEmailTo(email)
  const link = body.match(/https?:\/\/\S+\/confirmar-email#token=\S+/)
  expect(link, body).not.toBeNull()
  return link![0]
}

/**
 * Confirma o email pela API, com o token do email enviado no registo. Quase todos os testes
 * precisam disto: sem o email confirmado, aparece o aviso e a partilha fica fechada.
 */
export async function confirmEmail(page: Page, email: string) {
  const token = new URL(await confirmationLink(email)).hash.replace('#token=', '')
  const response = await page.request.post('/api/auth/verify-email', { data: { token } })
  expect(response.status()).toBe(204)
}

const mailDir = () => process.env.E2E_MAIL_DIR!

/** Corpo de um email .eml de uma só parte, descodificado (quoted-printable ou base64). */
function emailBody(raw: string): string {
  const [headers, ...rest] = raw.split(/\r?\n\r?\n/)
  const body = rest.join('\n\n')
  if (/Content-Transfer-Encoding: base64/i.test(headers)) {
    return Buffer.from(body, 'base64').toString('utf8')
  }
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
    const bytes = body
      .replace(/=\r?\n/g, '') // quebras de linha "suaves"
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    return Buffer.from(bytes, 'latin1').toString('utf8')
  }
  return body
}

/**
 * O corpo do último email enviado para `to` (a API dos E2E grava os emails em ficheiros .eml).
 * Espera um pouco, porque o email é escrito pelo servidor ao responder ao pedido.
 */
export async function lastEmailTo(to: string): Promise<string> {
  let found: string | undefined
  await expect
    .poll(() => {
      let names: string[] = []
      try {
        names = readdirSync(mailDir()).filter((name) => name.endsWith('.eml'))
      } catch {
        return false // a pasta só existe depois do primeiro email
      }
      found = names
        .sort()
        .reverse()
        .map((name) => readFileSync(join(mailDir(), name), 'utf8'))
        .find((raw) => raw.includes(`To: ${to}`))
      return found !== undefined
    })
    .toBe(true)
  return emailBody(found!)
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
