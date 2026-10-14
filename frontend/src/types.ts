export type WarrantyStatus = 'active' | 'expiring' | 'expired'

export interface User {
  id: number
  email: string
  created_at: string
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
}
