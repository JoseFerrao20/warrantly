import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { api, ApiError } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { WarrantyBar } from '../components/WarrantyBar'
import type { Purchase, WarrantyStatus } from '../types'
import { usePageTitle } from '../usePageTitle'
import { todayISO } from '../warranty'

const CARDS: { status: WarrantyStatus; label: string }[] = [
  { status: 'active', label: 'Ativas' },
  { status: 'expiring', label: 'A expirar (60 dias)' },
  { status: 'expired', label: 'Expiradas' },
]

// Pesquisa sem distinguir maiúsculas nem acentos ("maquina" encontra "Máquina").
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** A API ordena pelo fim da garantia; no painel, as expiradas passam para o fim (a mais recente primeiro). */
function panelOrder(purchases: Purchase[]): Purchase[] {
  const current = purchases.filter((p) => p.status !== 'expired')
  const expired = purchases.filter((p) => p.status === 'expired').reverse()
  return [...current, ...expired]
}

export function DashboardPage() {
  const navigate = useNavigate()
  usePageTitle('As tuas garantias')
  const [params, setParams] = useSearchParams()
  const statusFilter = params.get('estado') as WarrantyStatus | null
  const [query, setQuery] = useState('')
  const [purchases, setPurchases] = useState<Purchase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  useEffect(() => {
    api
      .listPurchases()
      .then(setPurchases)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar'))
  }, [])

  const counts = useMemo(() => {
    const result: Record<WarrantyStatus, number> = { active: 0, expiring: 0, expired: 0 }
    for (const p of purchases ?? []) result[p.status] += 1
    return result
  }, [purchases])

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return panelOrder(purchases ?? []).filter(
      (p) =>
        (!statusFilter || p.status === statusFilter) &&
        (!q || normalize(`${p.product_name} ${p.store} ${p.category ?? ''}`).includes(q)),
    )
  }, [purchases, statusFilter, query])

  function toggleStatus(status: WarrantyStatus) {
    setParams(statusFilter === status ? {} : { estado: status })
  }

  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    )
  if (!purchases) return <p className="page-message">A carregar…</p>

  if (purchases.length === 0) {
    return (
      <section className="empty">
        <h1>Ainda não tens compras registadas</h1>
        <p className="muted">
          Regista a primeira compra e a fatura; avisamos-te antes de a garantia acabar.
        </p>
        <Link to="/compras/nova" className="button button-primary">
          Registar compra
        </Link>
      </section>
    )
  }

  return (
    <>
      <h1 className="visually-hidden">As tuas garantias</h1>
      <div className="cards">
        {CARDS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            className={`summary summary-${status}${statusFilter === status ? ' selected' : ''}`}
            aria-pressed={statusFilter === status}
            onClick={() => toggleStatus(status)}
          >
            <span>{label}</span>
            <strong>{counts[status]}</strong>
          </button>
        ))}
      </div>

      <input
        type="search"
        className="search"
        placeholder="Pesquisar…"
        aria-label="Pesquisar compras"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <table className="purchases">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="col-store">Loja</th>
            <th className="col-bar">Garantia</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((p) => (
            <tr
              key={p.id}
              className={`row-${p.status}`}
              onClick={() => navigate(`/compras/${p.id}`)}
            >
              <td>
                <Link to={`/compras/${p.id}`}>{p.product_name}</Link>
              </td>
              <td className="col-store muted">{p.store}</td>
              <td className="col-bar">
                <WarrantyBar
                  purchaseDate={p.purchase_date}
                  warrantyEnd={p.warranty_end}
                  status={p.status}
                  today={today}
                />
              </td>
              <td>
                <StatusBadge status={p.status} warrantyEnd={p.warranty_end} today={today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && <p className="page-message">Nenhuma compra corresponde à pesquisa.</p>}
    </>
  )
}
