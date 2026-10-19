import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

import type {
  InvoiceScan,
  Purchase,
  PurchaseInput,
  UploadTicket,
  User,
  UserSession,
} from '@/shared/types'

import { deviceName } from './device'

// Endereço da API (ver .env.example): em desenvolvimento, o computador na rede local; na AWS,
// o CloudFront com /api.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
)

const TOKEN_KEY = 'warrantly.token'
const REFRESH_KEY = 'warrantly.refreshToken'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Um ficheiro do telemóvel (câmara ou ficheiros), como o fetch do React Native o envia. */
export interface PickedFile {
  uri: string
  name: string
  type: string
  size?: number
}

/** Token de acesso (15 min) e refresh token (30 dias desde o último uso; ver app/sessions.py). */
export interface Session {
  access_token: string
  refresh_token?: string | null
}

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY)

/** Guarda a sessão no armazenamento seguro do telemóvel (null apaga-a). */
export async function setSession(session: Session | null): Promise<void> {
  const store = (key: string, value: string | null | undefined) =>
    value ? SecureStore.setItemAsync(key, value) : SecureStore.deleteItemAsync(key)
  await store(TOKEN_KEY, session?.access_token)
  await store(REFRESH_KEY, session?.refresh_token)
}

// Um só pedido de renovação de cada vez, mesmo que vários pedidos recebam 401 juntos.
let refreshing: Promise<boolean> | null = null

/** Troca o refresh token por uma sessão nova (a API roda os dois). false: a sessão terminou. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY)
    if (!refreshToken) return false
    const response = await fetch(API_URL + '/auth/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) return false
    await setSession((await response.json()) as Session)
    return true
  })()
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg).join('; ')
  return `Erro inesperado (${status})`
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retry = true,
): Promise<T> {
  const { json, headers, ...rest } = init
  const token = await getToken()
  let response: Response
  try {
    response = await fetch(API_URL + path, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError(0, 'Sem ligação ao servidor. Confirma a internet e tenta outra vez.')
  }
  if (response.status === 401 && token) {
    // O token de acesso dura 15 minutos: renova-o uma vez e repete o pedido.
    if (retry && (await refreshSession())) return request<T>(path, init, false)
    onUnauthorized()
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(response.status, body))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const INVOICE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function fileForm(file: PickedFile, fields: Record<string, string> = {}): FormData {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.append(name, value)
  // No React Native, um ficheiro local envia-se como { uri, name, type }.
  body.append('file', file as unknown as Blob) // o S3 exige o ficheiro em último lugar
  return body
}

export const api = {
  login(email: string, password: string): Promise<Session> {
    const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    return request<Session>('/auth/login', {
      method: 'POST',
      // A app não tem cookies: pede o refresh token no corpo da resposta. O nome do telemóvel
      // aparece na lista de sessões da conta.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Client': 'mobile',
        'X-Device-Name': deviceName(),
      },
      body,
    })
  },
  /** Revoga o refresh token deste telemóvel (sem rede, sai na mesma). */
  async logout(): Promise<void> {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY)
    if (!refreshToken) return
    await request<void>('/auth/logout', { method: 'POST', json: { refresh_token: refreshToken } })
  },
  me: () => request<User>('/auth/me'),
  listSessions: () => request<UserSession[]>('/auth/sessions'),
  endSession: (id: number) => request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
  endOtherSessions: () =>
    request<{ ended: number }>('/auth/sessions/end-others', { method: 'POST' }),
  listPurchases: () => request<Purchase[]>('/purchases'),
  getPurchase: (id: number) => request<Purchase>(`/purchases/${id}`),
  createPurchase: (data: PurchaseInput) =>
    request<Purchase>('/purchases', { method: 'POST', json: data }),
  updatePurchase: (id: number, data: Partial<PurchaseInput>) =>
    request<Purchase>(`/purchases/${id}`, { method: 'PATCH', json: data }),
  deletePurchase: (id: number) => request<void>(`/purchases/${id}`, { method: 'DELETE' }),

  /**
   * Descarrega a fatura para a cache do telemóvel e devolve o endereço do ficheiro, para a
   * abrir no visualizador do sistema. O download não passa pelo `request`, por isso antes
   * pede-se o `/auth/me`: se o token de acesso tiver expirado, é aí que se renova.
   */
  async downloadInvoice(purchase: Purchase): Promise<string> {
    await request<User>('/auth/me')
    const token = await getToken()
    const extension = INVOICE_EXTENSIONS[purchase.invoice_content_type ?? ''] ?? 'pdf'
    try {
      const file = await File.downloadFileAsync(
        `${API_URL}/purchases/${purchase.id}/invoice`,
        // Um nome nosso, e não o do ficheiro original (que pode ter qualquer coisa).
        new File(Paths.cache, `fatura-${purchase.id}.${extension}`),
        { headers: token ? { Authorization: `Bearer ${token}` } : {}, idempotent: true },
      )
      return file.uri
    } catch {
      throw new ApiError(0, 'Não foi possível descarregar a fatura. Tenta outra vez.')
    }
  },

  createUpload: () => request<UploadTicket>('/purchases/uploads', { method: 'POST' }),
  async uploadToStorage(ticket: UploadTicket, file: PickedFile): Promise<void> {
    const response = await fetch(ticket.url!, {
      method: 'POST',
      body: fileForm(file, ticket.fields ?? {}),
    })
    if (!response.ok) throw new ApiError(response.status, 'Não foi possível enviar a fatura')
  },
  scanUpload: (token: string) =>
    request<InvoiceScan>(`/purchases/uploads/${token}/scan`, { method: 'POST' }),
  scanInvoice: (file: PickedFile) =>
    request<InvoiceScan>('/purchases/scan-invoice', { method: 'POST', body: fileForm(file) }),
  attachUpload: (id: number, token: string, filename: string) =>
    request<Purchase>(`/purchases/${id}/invoice/upload`, {
      method: 'PUT',
      json: { token, filename },
    }),
  uploadInvoice: (id: number, file: PickedFile) =>
    request<Purchase>(`/purchases/${id}/invoice`, { method: 'PUT', body: fileForm(file) }),

  registerPushToken: (token: string, platform: 'ios' | 'android') =>
    request<void>('/push-tokens', { method: 'POST', json: { token, platform } }),
  deletePushToken: (token: string) =>
    request<void>('/push-tokens', { method: 'DELETE', json: { token } }),
}
