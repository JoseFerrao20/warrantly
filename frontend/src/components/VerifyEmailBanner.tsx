import { useState } from 'react'

import { api, ApiError } from '../api'

/** Aviso enquanto o email da conta não está confirmado, com o botão para pedir outro link. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function resend() {
    setStatus(null)
    setError(null)
    setSending(true)
    try {
      setStatus((await api.resendVerification()).detail)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o email')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="verify-banner" aria-label="Confirmar o email">
      <p>
        <strong>Confirma o teu email.</strong> Abre o link que enviámos para {email} para poderes
        partilhar as garantias com a família.
      </p>
      <button type="button" className="button" onClick={resend} disabled={sending}>
        {sending ? 'A enviar…' : 'Enviar outra vez'}
      </button>
      {status && (
        <p role="status" className="muted">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  )
}
