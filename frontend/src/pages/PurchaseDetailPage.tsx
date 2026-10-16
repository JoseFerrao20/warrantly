import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { api, ApiError } from '../api'
import { ClaimSection } from '../components/ClaimSection'
import { InvoicePicker } from '../components/InvoicePicker'
import { attachStaged, stageInvoice } from '../invoiceUpload'
import { StatusBadge } from '../components/StatusBadge'
import type { Purchase } from '../types'
import { usePageTitle } from '../usePageTitle'
import { formatDate, formatMonths, formatPrice, todayISO } from '../warranty'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

const INVOICE_VIEW_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export function PurchaseDetailPage() {
  const { id } = useParams()
  const purchaseId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  usePageTitle(purchase?.product_name ?? null)
  const [error, setError] = useState<string | null>(
    (location.state as { invoiceError?: string } | null)?.invoiceError ?? null,
  )
  const [newInvoice, setNewInvoice] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayISO()

  useEffect(() => {
    api
      .getPurchase(purchaseId)
      .then(setPurchase)
      .catch((err) => setError(message(err, 'Erro ao carregar')))
  }, [purchaseId])

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(message(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const uploadInvoice = () =>
    run(async () => {
      if (!newInvoice) return
      setPurchase(await attachStaged(purchaseId, await stageInvoice(newInvoice)))
      setNewInvoice(null)
    }, 'Erro ao enviar a fatura')

  const removeInvoice = () =>
    run(async () => {
      if (!window.confirm('Apagar a fatura desta compra?')) return
      await api.deleteInvoice(purchaseId)
      setPurchase(await api.getPurchase(purchaseId))
    }, 'Erro ao apagar a fatura')

  const openInvoice = () => {
    // Abre o separador já (para o browser não o bloquear) e só depois carrega o ficheiro.
    const tab = window.open('', '_blank')
    return run(async () => {
      try {
        const blob = await api.getInvoice(purchaseId)
        // O blob abre com a origem da app: só PDF e imagens (nunca HTML, que correria cá dentro).
        if (!INVOICE_VIEW_TYPES.includes(blob.type)) throw new Error('Tipo de ficheiro inesperado')
        const url = URL.createObjectURL(blob)
        if (tab) tab.location.href = url
        else window.location.href = url
      } catch (err) {
        tab?.close() // não deixar um separador em branco aberto
        throw err
      }
    }, 'Erro ao abrir a fatura')
  }

  const deletePurchase = () =>
    run(async () => {
      if (!window.confirm('Apagar esta compra e a fatura? Não dá para desfazer.')) return
      await api.deletePurchase(purchaseId)
      navigate('/', { replace: true })
    }, 'Erro ao apagar a compra')

  if (!purchase) {
    return error ? (
      <p className="form-error">{error}</p>
    ) : (
      <p className="page-message">A carregar…</p>
    )
  }

  return (
    <>
      <Link to="/" className="back">
        ← Garantias
      </Link>
      <h1>{purchase.product_name}</h1>
      <p className="muted">
        {purchase.store} · comprada a {formatDate(purchase.purchase_date)} ·{' '}
        {formatPrice(purchase.price)}
        {purchase.category && <> · {purchase.category}</>}
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="detail-grid">
        <section className="card">
          <h2>Garantia</h2>
          <p>
            Fim: <strong>{formatDate(purchase.warranty_end)}</strong>
          </p>
          <p className="muted">{formatMonths(purchase.warranty_months)} desde a compra</p>
          <StatusBadge
            status={purchase.status}
            warrantyEnd={purchase.warranty_end}
            today={today}
          />
        </section>

        <section className="card">
          <h2>Fatura</h2>
          {purchase.invoice_number && (
            <p>
              N.º <strong>{purchase.invoice_number}</strong>
            </p>
          )}
          {purchase.invoice_filename ? (
            <>
              <p className="invoice-name">{purchase.invoice_filename}</p>
              <div className="form-actions">
                <button type="button" className="button" onClick={openInvoice} disabled={busy}>
                  Ver fatura
                </button>
                <button
                  type="button"
                  className="button-link danger"
                  onClick={removeInvoice}
                  disabled={busy}
                >
                  Apagar fatura
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Ainda sem fatura.</p>
          )}
          <InvoicePicker file={newInvoice} onChange={setNewInvoice} />
          {newInvoice && (
            <button
              type="button"
              className="button button-primary"
              onClick={uploadInvoice}
              disabled={busy}
            >
              {purchase.invoice_filename ? 'Substituir fatura' : 'Guardar fatura'}
            </button>
          )}
        </section>
      </div>

      <ClaimSection purchase={purchase} onPurchaseChange={setPurchase} />

      <div className="form-actions detail-actions">
        <Link to={`/compras/${purchase.id}/editar`} className="button">
          Editar
        </Link>
        <button type="button" className="button-link danger" onClick={deletePurchase} disabled={busy}>
          Apagar compra
        </button>
      </div>
    </>
  )
}
