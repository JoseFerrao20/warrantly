import { useState } from 'react'
import type { FormEvent } from 'react'

import { api, ApiError } from '../api'
import type { Claim } from '../types'
import { useAuth } from '../useAuth'

/** Gera o texto da reclamação para a loja (o utilizador copia-o ou abre-o no email). */
export function ClaimSection({ purchaseId }: { purchaseId: number }) {
  const { user, updateProfile } = useAuth()
  const needsName = !user?.full_name
  const [fullName, setFullName] = useState('')
  const [description, setDescription] = useState('')
  const [claim, setClaim] = useState<Claim | null>(null)
  // Descrição usada na carta mostrada (o PDF tem de corresponder, mesmo que a caixa mude depois).
  const [claimDescription, setClaimDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      if (needsName) await updateProfile(fullName.trim())
      setClaim(await api.generateClaim(purchaseId, description))
      setClaimDescription(description)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar a reclamação')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!claim) return
    try {
      await navigator.clipboard.writeText(`${claim.subject}\n\n${claim.body}`)
      setCopied(true)
    } catch {
      setError('Não foi possível copiar; seleciona o texto e copia à mão')
    }
  }

  async function downloadPdf() {
    setError(null)
    setBusy(true)
    try {
      const blob = await api.getClaimPdf(purchaseId, claimDescription)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `reclamacao-${purchaseId}.pdf`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o PDF')
    } finally {
      setBusy(false)
    }
  }

  const mailto = claim
    ? `mailto:?subject=${encodeURIComponent(claim.subject)}&body=${encodeURIComponent(claim.body)}`
    : undefined

  return (
    <section className="card claim">
      <h2>Reclamação à loja</h2>
      <form className="form" onSubmit={onSubmit}>
        {needsName && (
          <label>
            O teu nome (para assinar a carta)
            <input
              required
              maxLength={200}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
        )}
        <label>
          Descreve o problema
          <textarea
            required
            maxLength={2000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Não centrifuga e dá o erro E18 a meio do programa."
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Gerar reclamação
          </button>
        </div>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {claim && (
        <div className="claim-result">
          {!claim.within_warranty && (
            <p className="warning" role="status">
              A garantia desta compra já terminou: a loja pode recusar a reclamação.
            </p>
          )}
          <p>
            <strong>Assunto:</strong> {claim.subject}
          </p>
          <pre className="claim-preview" aria-label="Texto da reclamação">
            {claim.body}
          </pre>
          <div className="form-actions">
            <a className="button" href={mailto}>
              Abrir no email
            </a>
            <button type="button" className="button" onClick={downloadPdf} disabled={busy}>
              Descarregar PDF
            </button>
            <button type="button" className="button button-primary" onClick={copy}>
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
