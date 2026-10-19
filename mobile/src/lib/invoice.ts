import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'

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

/** Fotografa a fatura com a câmara. null se a pessoa cancelar; erro sem acesso à câmara. */
export async function takeInvoicePhoto(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    throw new ApiError(0, 'Sem acesso à câmara. Podes autorizar nas definições do telemóvel.')
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
  if (result.canceled) return null
  const photo = result.assets[0]
  return {
    uri: photo.uri,
    name: photo.fileName ?? 'fatura.jpg',
    type: photo.mimeType ?? 'image/jpeg',
    size: photo.fileSize,
  }
}

/** Escolhe um PDF ou uma imagem nos ficheiros do telemóvel. null se a pessoa cancelar. */
export async function pickInvoiceFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  })
  if (result.canceled) return null
  const file = result.assets[0]
  return {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? 'application/octet-stream',
    size: file.size,
  }
}
