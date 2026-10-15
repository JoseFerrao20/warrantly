import type { Claim, InvoiceScan, Purchase, PurchaseInput, User } from './types'

const BASE = '/api'
const TOKEN_KEY = 'warrantly.token'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Sem localStorage (ex.: modo privado restrito): a sessão dura só enquanto a página está aberta.
  }
}

// Chamado quando a API responde 401 (token expirado ou inválido).
let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // Erros de validação do FastAPI: [{ loc, msg }, ...]
    return detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
  }
  return `Erro inesperado (${status})`
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const token = getToken()
  const response = await fetch(BASE + path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (response.status === 401 && token) onUnauthorized()
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(response.status, body))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Para respostas que são ficheiros (fatura, PDF da reclamação, exportação). */
async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const token = getToken()
  const response = await fetch(BASE + path, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (response.status === 401 && token) onUnauthorized()
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(response.status, body))
  }
  return response.blob()
}

export const api = {
  async login(email: string, password: string): Promise<string> {
    const body = new URLSearchParams({ username: email, password })
    const { access_token } = await request<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body,
    })
    return access_token
  },
  register: (email: string, password: string, fullName: string | null) =>
    request<User>('/auth/register', {
      method: 'POST',
      json: { email, password, full_name: fullName },
    }),
  me: () => request<User>('/auth/me'),
  updateMe: (data: { full_name: string | null }) =>
    request<User>('/auth/me', { method: 'PATCH', json: data }),
  deleteMe: (password: string) =>
    request<void>('/auth/me', { method: 'DELETE', json: { password } }),

  listPurchases: () => request<Purchase[]>('/purchases'),
  getPurchase: (id: number) => request<Purchase>(`/purchases/${id}`),
  createPurchase: (data: PurchaseInput) =>
    request<Purchase>('/purchases', { method: 'POST', json: data }),
  updatePurchase: (id: number, data: Partial<PurchaseInput>) =>
    request<Purchase>(`/purchases/${id}`, { method: 'PATCH', json: data }),
  deletePurchase: (id: number) => request<void>(`/purchases/${id}`, { method: 'DELETE' }),
  generateClaim: (id: number, description: string) =>
    request<Claim>(`/purchases/${id}/claim`, { method: 'POST', json: { description } }),

  uploadInvoice(id: number, file: File) {
    const body = new FormData()
    body.append('file', file)
    return request<Purchase>(`/purchases/${id}/invoice`, { method: 'PUT', body })
  },
  scanInvoice(file: File) {
    const body = new FormData()
    body.append('file', file)
    return request<InvoiceScan>('/purchases/scan-invoice', { method: 'POST', body })
  },
  deleteInvoice: (id: number) => request<void>(`/purchases/${id}/invoice`, { method: 'DELETE' }),
  getInvoice: (id: number) => requestBlob(`/purchases/${id}/invoice`),
  exportPurchases: () => requestBlob('/purchases/export'),
  getClaimPdf: (id: number, description: string) =>
    requestBlob(`/purchases/${id}/claim.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    }),
}
