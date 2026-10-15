import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { api, ApiError } from '../api'
import { InvoicePicker } from '../components/InvoicePicker'
import type { PurchaseInput } from '../types'
import { usePageTitle } from '../usePageTitle'
import { addMonths, formatLongDate, parsePrice, todayISO } from '../warranty'

const WARRANTY_OPTIONS = [
  { months: 36, label: '3 anos (legal)' },
  { months: 24, label: '2 anos' },
  { months: 18, label: '18 meses (bem usado)' },
  { months: 12, label: '1 ano' },
]

interface FormState {
  product_name: string
  store: string
  category: string
  price: string
  purchase_date: string
  warranty_option: string // meses, ou "custom"
  custom_months: string
  invoice_number: string
  store_email: string
}

const emptyForm = (): FormState => ({
  product_name: '',
  store: '',
  category: '',
  price: '',
  purchase_date: todayISO(),
  warranty_option: '36',
  custom_months: '',
  invoice_number: '',
  store_email: '',
})

export function PurchaseFormPage() {
  const { id } = useParams()
  const editing = id !== undefined
  usePageTitle(editing ? 'Editar compra' : 'Nova compra')
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>(emptyForm)
  const [invoice, setInvoice] = useState<File | null>(null)
  const [currentInvoice, setCurrentInvoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(editing)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!editing) return
    api
      .getPurchase(Number(id))
      .then((p) => {
        const preset = WARRANTY_OPTIONS.some((o) => o.months === p.warranty_months)
        setForm({
          product_name: p.product_name,
          store: p.store,
          category: p.category ?? '',
          price: p.price.replace('.', ','),
          purchase_date: p.purchase_date,
          warranty_option: preset ? String(p.warranty_months) : 'custom',
          custom_months: preset ? '' : String(p.warranty_months),
          invoice_number: p.invoice_number ?? '',
          store_email: p.store_email ?? '',
        })
        setCurrentInvoice(p.invoice_filename)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [editing, id])

  const set = (field: keyof FormState) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  const months =
    form.warranty_option === 'custom' ? Number(form.custom_months) : Number(form.warranty_option)
  const validMonths = Number.isInteger(months) && months > 0 && months <= 1200
  const warrantyEnd =
    form.purchase_date && validMonths ? addMonths(form.purchase_date, months) : null

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const price = parsePrice(form.price)
    if (price === null) return setError('Preço inválido: usa, por exemplo, 749,99')
    if (!validMonths) return setError('Indica a duração da garantia em meses')

    const data: PurchaseInput = {
      product_name: form.product_name.trim(),
      store: form.store.trim(),
      category: form.category.trim() || null,
      purchase_date: form.purchase_date,
      price,
      warranty_months: months,
      invoice_number: form.invoice_number.trim() || null,
      store_email: form.store_email.trim() || null,
    }
    setSubmitting(true)
    try {
      const saved = editing
        ? await api.updatePurchase(Number(id), data)
        : await api.createPurchase(data)
      if (invoice) {
        try {
          await api.uploadInvoice(saved.id, invoice)
        } catch (err) {
          // A compra ficou guardada; mostramos o erro da fatura no detalhe.
          const message = err instanceof ApiError ? err.message : 'Erro ao enviar a fatura'
          navigate(`/compras/${saved.id}`, { state: { invoiceError: message } })
          return
        }
      }
      navigate(`/compras/${saved.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível guardar')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="page-message">A carregar…</p>

  return (
    <form className="card form purchase-form" onSubmit={onSubmit}>
      <h1>{editing ? 'Editar compra' : 'Nova compra'}</h1>

      <InvoicePicker file={invoice} onChange={setInvoice} currentName={currentInvoice} />

      <label>
        Produto
        <input
          required
          maxLength={200}
          value={form.product_name}
          onChange={(e) => set('product_name')(e.target.value)}
          placeholder="Portátil Lenovo IdeaPad 5"
        />
      </label>
      <div className="form-row">
        <label>
          Loja
          <input
            required
            maxLength={200}
            value={form.store}
            onChange={(e) => set('store')(e.target.value)}
            placeholder="Fnac"
          />
        </label>
        <label>
          Preço (€)
          <input
            required
            inputMode="decimal"
            value={form.price}
            onChange={(e) => set('price')(e.target.value)}
            placeholder="749,99"
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Data de compra
          <input
            type="date"
            required
            max={todayISO()}
            value={form.purchase_date}
            onChange={(e) => set('purchase_date')(e.target.value)}
          />
        </label>
        <label>
          Garantia
          <select
            value={form.warranty_option}
            onChange={(e) => set('warranty_option')(e.target.value)}
          >
            {WARRANTY_OPTIONS.map((o) => (
              <option key={o.months} value={o.months}>
                {o.label}
              </option>
            ))}
            <option value="custom">Outra (em meses)</option>
          </select>
        </label>
      </div>
      {form.warranty_option === 'custom' && (
        <label>
          Meses de garantia
          <input
            type="number"
            min={1}
            max={1200}
            required
            value={form.custom_months}
            onChange={(e) => set('custom_months')(e.target.value)}
          />
        </label>
      )}
      <label>
        <span>
          Categoria <span className="muted">(opcional)</span>
        </span>
        <input
          maxLength={100}
          value={form.category}
          onChange={(e) => set('category')(e.target.value)}
          placeholder="Informática"
        />
      </label>

      <label>
        <span>
          N.º da fatura <span className="muted">(opcional, aparece na reclamação)</span>
        </span>
        <input
          maxLength={100}
          value={form.invoice_number}
          onChange={(e) => set('invoice_number')(e.target.value)}
          placeholder="FT 2026/12345"
        />
      </label>

      <label>
        <span>
          Email da loja <span className="muted">(opcional, para enviares reclamações)</span>
        </span>
        <input
          type="email"
          maxLength={320}
          value={form.store_email}
          onChange={(e) => set('store_email')(e.target.value)}
          placeholder="apoio@loja.pt"
        />
      </label>

      {warrantyEnd && (
        <div className="notice" aria-live="polite">
          <span className="muted">Garantia válida até</span>
          <strong>{formatLongDate(warrantyEnd)}</strong>
          <small className="muted">
            calculado automaticamente · avisamos-te 60 e 15 dias antes de expirar
          </small>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Link to={editing ? `/compras/${id}` : '/'} className="button">
          Cancelar
        </Link>
        <button type="submit" className="button button-primary" disabled={submitting}>
          Guardar
        </button>
      </div>
    </form>
  )
}
