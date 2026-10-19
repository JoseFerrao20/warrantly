export type WarrantyStatus = 'active' | 'expiring' | 'expired'

export interface User {
  id: number
  email: string
  full_name: string | null
  created_at: string
}

/** Uma sessão aberta (um aparelho com login feito), na página da conta. */
export interface UserSession {
  id: number
  device: string
  created_at: string
  last_used_at: string
  current: boolean
}

export interface Purchase {
  id: number
  product_name: string
  store: string
  category: string | null
  purchase_date: string // AAAA-MM-DD
  price: string // decimal em texto, ex.: "749.99"
  warranty_months: number
  warranty_end: string // AAAA-MM-DD
  invoice_number: string | null
  store_email: string | null
  invoice_filename: string | null
  invoice_content_type: string | null
  invoice_size: number | null
  created_at: string
  updated_at: string
  status: WarrantyStatus
}

export interface PurchaseInput {
  product_name: string
  store: string
  category: string | null
  purchase_date: string
  price: string
  warranty_months: number
  invoice_number: string | null
  store_email: string | null
}

/** Upload direto browser → S3 (POST pré-assinado). Sem S3, `direct` é false. */
export interface UploadTicket {
  direct: boolean
  max_bytes: number
  token: string | null
  url: string | null
  fields: Record<string, string> | null
}

/** Sugestões lidas da fatura (null = não encontrado). */
export interface InvoiceScan {
  text_found: boolean
  ocr_available: boolean
  product_name: string | null
  store: string | null
  purchase_date: string | null
  price: string | null
  invoice_number: string | null
  store_email: string | null
}

export interface Claim {
  subject: string
  body: string
  within_warranty: boolean
}
