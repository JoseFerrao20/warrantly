export type WarrantyStatus = 'active' | 'expiring' | 'expired'

export interface User {
  id: number
  email: string
  full_name: string | null
  /** Abriu o link de confirmação do registo; sem isso, não partilha o arquivo (ADR 0008). */
  email_verified: boolean
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
  /** Quem registou a compra: com a partilha do arquivo, pode ser outra pessoa. */
  user_id: number
  owner_name: string
  product_name: string
  store: string
  category: string | null
  purchase_date: string // AAAA-MM-DD
  price: string // decimal em texto, ex.: "749.99"
  warranty_months: number
  warranty_end: string // AAAA-MM-DD
  invoice_number: string | null
  store_email: string | null
  store_nif: string | null // de quem passou a fatura (do código QR)
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
  store_nif: string | null
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
  store_nif: string | null
  /** Uma compra que já tem esta fatura (mesmo NIF e mesmo n.º), se houver. */
  duplicate_purchase_id: number | null
}

export interface Claim {
  subject: string
  body: string
  within_warranty: boolean
}

/** Uma pessoa com quem partilho o arquivo (convite pendente ou aceite). */
export interface Share {
  id: number
  email: string
  accepted: boolean
  created_at: string
}

/** Um arquivo partilhado comigo. */
export interface SharedArchive {
  id: number
  owner_name: string
  owner_email: string
  accepted: boolean
  created_at: string
}

export interface Sharing {
  members: Share[]
  shared_with_me: SharedArchive[]
}
