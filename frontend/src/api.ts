import type {
  Claim,
  InvoiceScan,
  Purchase,
  PurchaseInput,
  Share,
  SharedArchive,
  Sharing,
  UploadTicket,
  User,
  UserSession,
} from './types'

const BASE = '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * O token de acesso fica só em memória, e não no localStorage: um XSS não o consegue ler nem
 * levar para outro sítio depois de a página fechar. Ao abrir (ou recarregar) a página, o
 * AuthProvider pede um novo com o cookie httpOnly do refresh token (ADR 0004).
 */
let accessToken: string | null = null

export function getToken(): string | null {
  return accessToken
}

export function setToken(token: string | null): void {
  accessToken = token
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

// Um só pedido de renovação de cada vez, mesmo que vários pedidos recebam 401 juntos.
let refreshing: Promise<string | null> | null = null

/**
 * Pede um token de acesso novo. O refresh token vai sozinho no cookie httpOnly (o JavaScript
 * não o vê); a API troca-o por um novo a cada uso. Devolve null se a sessão terminou.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch(BASE + '/auth/refresh', { method: 'POST' })
    .then(async (response) => {
      if (!response.ok) return null
      const { access_token } = (await response.json()) as { access_token: string }
      setToken(access_token)
      return access_token
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * fetch com o token de acesso. O token dura 15 minutos: com 401, renova-o uma vez e repete o
 * pedido; se a sessão já não servir, avisa o AuthProvider (volta ao login).
 */
async function authFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getToken()
  const response = await fetch(BASE + path, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (response.status === 401 && token) {
    if (retry && (await refreshAccessToken())) return authFetch(path, init, false)
    onUnauthorized()
  }
  return response
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const response = await authFetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(response.status, body))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Para respostas que são ficheiros (fatura, PDF da reclamação, exportação). */
async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const response = await authFetch(path, init)
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
  /** Termina a sessão neste browser (a API apaga o cookie). Sem rede, sai na mesma. */
  async logout(): Promise<void> {
    await fetch(BASE + '/auth/logout', { method: 'POST' }).catch(() => undefined)
  },
  requestPasswordReset: (email: string) =>
    request<{ detail: string }>('/auth/password-reset', { method: 'POST', json: { email } }),
  confirmPasswordReset: (token: string, password: string) =>
    request<void>('/auth/password-reset/confirm', { method: 'POST', json: { token, password } }),
  verifyEmail: (token: string) =>
    request<void>('/auth/verify-email', { method: 'POST', json: { token } }),
  resendVerification: () =>
    request<{ detail: string }>('/auth/verify-email/resend', { method: 'POST' }),
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
  listSessions: () => request<UserSession[]>('/auth/sessions'),
  endSession: (id: number) => request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
  endOtherSessions: () =>
    request<{ ended: number }>('/auth/sessions/end-others', { method: 'POST' }),

  getSharing: () => request<Sharing>('/sharing'),
  invite: (email: string) => request<Share>('/sharing', { method: 'POST', json: { email } }),
  acceptShare: (id: number) =>
    request<SharedArchive>(`/sharing/${id}/accept`, { method: 'POST' }),
  removeShare: (id: number) => request<void>(`/sharing/${id}`, { method: 'DELETE' }),

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
  createUpload: () => request<UploadTicket>('/purchases/uploads', { method: 'POST' }),
  /** Envia o ficheiro diretamente para o S3 (sem passar pela API, nem levar o token da sessão). */
  async uploadToStorage(ticket: UploadTicket, file: File): Promise<void> {
    const body = new FormData()
    for (const [name, value] of Object.entries(ticket.fields ?? {})) body.append(name, value)
    body.append('file', file) // o S3 exige o ficheiro em último lugar
    const response = await fetch(ticket.url!, { method: 'POST', body })
    if (!response.ok) throw new ApiError(response.status, 'Não foi possível enviar a fatura')
  },
  scanUpload: (token: string) =>
    request<InvoiceScan>(`/purchases/uploads/${token}/scan`, { method: 'POST' }),
  attachUpload: (id: number, token: string, filename: string) =>
    request<Purchase>(`/purchases/${id}/invoice/upload`, {
      method: 'PUT',
      json: { token, filename },
    }),
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
