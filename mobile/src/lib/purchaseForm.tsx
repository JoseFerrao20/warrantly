import { Field } from './ui'
import type { Purchase, PurchaseInput } from '@/shared/types'
import { parsePrice, todayISO } from '@/shared/warranty'

/** Os campos de uma compra, como o utilizador os escreve (texto), na compra nova e na edição. */
export interface PurchaseForm {
  product_name: string
  store: string
  purchase_date: string
  price: string
  warranty_months: string
  invoice_number: string
  store_email: string
  store_nif: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emptyForm(): PurchaseForm {
  return {
    product_name: '',
    store: '',
    purchase_date: todayISO(),
    price: '',
    warranty_months: '36',
    invoice_number: '',
    store_email: '',
    store_nif: '',
  }
}

export function formFromPurchase(purchase: Purchase): PurchaseForm {
  return {
    product_name: purchase.product_name,
    store: purchase.store,
    purchase_date: purchase.purchase_date,
    price: purchase.price.replace('.', ','),
    warranty_months: String(purchase.warranty_months),
    invoice_number: purchase.invoice_number ?? '',
    store_email: purchase.store_email ?? '',
    store_nif: purchase.store_nif ?? '',
  }
}

/** Valida o formulário: os dados para a API, ou a mensagem do primeiro erro. */
export function toInput(
  form: PurchaseForm,
  category: string | null = null,
): { input: PurchaseInput } | { error: string } {
  const price = parsePrice(form.price)
  const months = Number(form.warranty_months)
  const storeEmail = form.store_email.trim()
  if (!form.product_name.trim() || !form.store.trim()) {
    return { error: 'Indica o produto e a loja.' }
  }
  if (!DATE_PATTERN.test(form.purchase_date)) {
    return { error: 'A data da compra tem de estar no formato AAAA-MM-DD.' }
  }
  if (price === null) return { error: 'O preço não é válido (ex.: 749,99).' }
  if (!Number.isInteger(months) || months < 1) {
    return { error: 'A garantia tem de ser um número de meses.' }
  }
  if (storeEmail && !EMAIL_PATTERN.test(storeEmail)) {
    return { error: 'O email da loja não é válido.' }
  }
  return {
    input: {
      product_name: form.product_name.trim(),
      store: form.store.trim(),
      category,
      purchase_date: form.purchase_date,
      price,
      warranty_months: months,
      invoice_number: form.invoice_number.trim() || null,
      store_email: storeEmail || null,
      store_nif: form.store_nif.trim() || null,
    },
  }
}

export function PurchaseFields({
  form,
  onChange,
}: {
  form: PurchaseForm
  onChange: (name: keyof PurchaseForm, value: string) => void
}) {
  return (
    <>
      <Field
        label="Produto"
        value={form.product_name}
        onChangeText={(v) => onChange('product_name', v)}
      />
      <Field label="Loja" value={form.store} onChangeText={(v) => onChange('store', v)} />
      <Field
        label="Data da compra (AAAA-MM-DD)"
        value={form.purchase_date}
        onChangeText={(v) => onChange('purchase_date', v)}
        keyboardType="numbers-and-punctuation"
      />
      <Field
        label="Preço (€)"
        value={form.price}
        onChangeText={(v) => onChange('price', v)}
        keyboardType="decimal-pad"
      />
      <Field
        label="Garantia (meses)"
        value={form.warranty_months}
        onChangeText={(v) => onChange('warranty_months', v)}
        keyboardType="number-pad"
      />
      <Field
        label="N.º da fatura (opcional)"
        value={form.invoice_number}
        onChangeText={(v) => onChange('invoice_number', v)}
      />
      <Field
        label="Email da loja (opcional, para a reclamação)"
        value={form.store_email}
        onChangeText={(v) => onChange('store_email', v)}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="off"
      />
      <Field
        label="NIF da loja (opcional, vem do código QR)"
        value={form.store_nif}
        onChangeText={(v) => onChange('store_nif', v)}
        keyboardType="number-pad"
      />
    </>
  )
}
