import { api, ApiError } from './api'
import type { InvoiceScan, Purchase } from './types'

/**
 * Uma fatura escolhida, pronta a ler e a guardar. Com o S3 (produção), o ficheiro vai do browser
 * diretamente para o bucket uma só vez, e a leitura e a gravação usam o token; sem S3
 * (desenvolvimento), o ficheiro vai pela API, como antes.
 */
export interface StagedInvoice {
  file: File
  token: string | null
}

export async function stageInvoice(file: File): Promise<StagedInvoice> {
  const ticket = await api.createUpload()
  if (!ticket.direct || !ticket.token) return { file, token: null }
  if (file.size > ticket.max_bytes) {
    const maxMb = Math.floor(ticket.max_bytes / (1024 * 1024))
    throw new ApiError(413, `A fatura não pode ter mais de ${maxMb} MB`)
  }
  await api.uploadToStorage(ticket, file)
  return { file, token: ticket.token }
}

export function scanStaged(staged: StagedInvoice): Promise<InvoiceScan> {
  return staged.token ? api.scanUpload(staged.token) : api.scanInvoice(staged.file)
}

export function attachStaged(purchaseId: number, staged: StagedInvoice): Promise<Purchase> {
  return staged.token
    ? api.attachUpload(purchaseId, staged.token, staged.file.name)
    : api.uploadInvoice(purchaseId, staged.file)
}
