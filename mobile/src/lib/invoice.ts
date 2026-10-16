import { api, ApiError } from './api'
import type { PickedFile } from './api'
import type { InvoiceScan, Purchase } from '@/shared/types'

/**
 * Como no frontend web (src/invoiceUpload.ts): com S3, a fatura vai do telemóvel diretamente
 * para o bucket uma só vez, e a leitura e a gravação usam o token; sem S3, vai pela API.
 */
export interface StagedInvoice {
  file: PickedFile
  token: string | null
}

export async function stageInvoice(file: PickedFile): Promise<StagedInvoice> {
  const ticket = await api.createUpload()
  if (file.size !== undefined && file.size > ticket.max_bytes) {
    const maxMb = Math.floor(ticket.max_bytes / (1024 * 1024))
    throw new ApiError(413, `A fatura não pode ter mais de ${maxMb} MB`)
  }
  if (!ticket.direct || !ticket.token) return { file, token: null }
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
