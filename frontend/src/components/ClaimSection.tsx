import { useState } from 'react'
import type { FormEvent } from 'react'

import { api, ApiError } from '../api'
import type { Claim, Purchase } from '../types'
import { useAuth } from '../useAuth'

// Alguns programas de email cortam links mailto: muito longos.
const MAILTO_SAFE_LENGTH = 1800
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Gera a reclamação para a loja. O envio é feito pelo email do próprio utilizador: a app
 * prepara o PDF (carta + fatura) e abre o programa de email com a carta já escrita.
 */
export function ClaimSection({
  purchase,
  onPurchaseChange,
}: {
  purchase: Purchase
  onPurchaseChange: (purchase: Purchase) => void
}) {
  const purchaseId = purchase.id
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
  const [downloaded, setDownloaded] = useState(false)
  const [storeEmail, setStoreEmail] = useState(purchase.store_email ?? '')

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
      setDownloaded(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o PDF')
    } finally {
      setBusy(false)
    }
  }

  const recipient = storeEmail.trim()
  const recipientValid = recipient === '' || EMAIL_PATTERN.test(recipient)
  const mailto = claim
    ? `mailto:${recipientValid ? recipient : ''}?subject=${encodeURIComponent(claim.subject)}` +
      `&body=${encodeURIComponent(claim.body)}`
    : undefined

  /** Guarda o email da loja na compra (para a próxima vez), sem atrasar a abertura do email. */
  function rememberStoreEmail() {
    const value = recipient || null
    if (!recipientValid || value === purchase.store_email) return
    api
      .updatePurchase(purchaseId, { store_email: value })
      .then(onPurchaseChange)
      .catch(() => setError('Não foi possível guardar o email da loja'))
  }

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

          <h3>Enviar pelo teu email</h3>
          <ol className="send-steps">
            <li>
              <div className="step-body">
                <div>
                  <strong>Descarrega o PDF</strong>{' '}
                  <span className="muted">
                    ({purchase.invoice_filename ? 'carta e fatura' : 'carta'})
                  </span>
                </div>
                <button type="button" className="button" onClick={downloadPdf} disabled={busy}>
                  {downloaded ? 'Descarregado ✓' : 'Descarregar PDF'}
                </button>
              </div>
            </li>
            <li>
              <div className="step-body">
                <div>
                  <strong>Abre o teu email</strong>{' '}
                  <span className="muted">com a carta já escrita</span>
                </div>
                <label>
                  <span>
                    Email da loja <span className="muted">(opcional, fica guardado)</span>
                  </span>
                  <input
                    type="email"
                    autoComplete="off"
                    maxLength={320}
                    value={storeEmail}
                    onChange={(e) => setStoreEmail(e.target.value)}
                    placeholder="apoio@loja.pt"
                  />
                </label>
                {!recipientValid && <p className="field-error">Email da loja inválido</p>}
                <a className="button button-primary" href={mailto} onClick={rememberStoreEmail}>
                  Abrir no email
                </a>
              </div>
            </li>
            <li>
              <div className="step-body">
                <strong>Anexa o PDF</strong>
                <span>
                  O ficheiro <code>reclamacao-{purchaseId}.pdf</code> que descarregaste no passo 1,
                  e envia.
                </span>
              </div>
            </li>
          </ol>
          <p className="muted">
            {mailto && mailto.length > MAILTO_SAFE_LENGTH
              ? 'O texto é longo e alguns programas de email cortam-no: se aparecer incompleto, '
              : 'Se o email não abrir (por exemplo, Gmail no browser), '}
            usa{' '}
            <button type="button" className="button-link" onClick={copy}>
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>{' '}
            e cola-o na tua mensagem.
          </p>
        </div>
      )}
    </section>
  )
}
