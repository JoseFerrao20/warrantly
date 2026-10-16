import * as SecureStore from 'expo-secure-store'

import type { InvoiceScan, Purchase, PurchaseInput, UploadTicket, User } from '@/shared/types'

// Endereço da API (ver .env.example): em desenvolvimento, o computador na rede local; na AWS,
// o CloudFront com /api.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
)

const TOKEN_KEY = 'warrantly.token'

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

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY)
export const setToken = (token: string | null) =>
  token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY)

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

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
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
  if (response.status === 401 && token) onUnauthorized()
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(response.status, body))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function fileForm(file: PickedFile, fields: Record<string, string> = {}): FormData {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.append(name, value)
  // No React Native, um ficheiro local envia-se como { uri, name, type }.
  body.append('file', file as unknown as Blob) // o S3 exige o ficheiro em último lugar
  return body
}

export const api = {
  async login(email: string, password: string): Promise<string> {
    const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    const { access_token } = await request<{ access_token: string }>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return access_token
  },
  me: () => request<User>('/auth/me'),
  listPurchases: () => request<Purchase[]>('/purchases'),
  getPurchase: (id: number) => request<Purchase>(`/purchases/${id}`),
  createPurchase: (data: PurchaseInput) =>
    request<Purchase>('/purchases', { method: 'POST', json: data }),

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
