import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { api, ApiError } from '../api'
import { usePageTitle } from '../usePageTitle'

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Não foi possível ligar ao servidor'
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <h1 className="brand">Warrantly</h1>
      <p className="muted">As tuas garantias, num só sítio.</p>
      <div className="card form">
        <h2>{title}</h2>
        {children}
        <Link to="/entrar" className="button-link">
          Voltar a entrar
        </Link>
      </div>
    </main>
  )
}

/** Pede o link por email. A resposta é a mesma, exista ou não a conta. */
export function ForgotPasswordPage() {
  usePageTitle('Recuperar a palavra-passe')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      setSent((await api.requestPasswordReset(email)).detail)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard title="Recuperar a palavra-passe">
      {sent ? (
        <p className="notice" role="status">
          {sent}
        </p>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          <p className="muted">Enviamos-te um link para escolheres uma palavra-passe nova.</p>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={submitting}>
            Enviar link
          </button>
        </form>
      )}
    </AuthCard>
  )
}

/** Página do link do email: /repor-palavra-passe#token=... */
export function ResetPasswordPage() {
  usePageTitle('Nova palavra-passe')
  const location = useLocation()
  const navigate = useNavigate()
  // O token vem no fragmento (#), que o browser não envia ao servidor.
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'))
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Tira o token da barra de endereço (e do histórico) depois de o ler.
    if (location.hash) navigate(location.pathname, { replace: true })
  }, [location.hash, location.pathname, navigate])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmation) {
      setError('As palavras-passe não são iguais.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await api.confirmPasswordReset(token!, password)
      navigate('/entrar', {
        replace: true,
        state: { notice: 'A palavra-passe foi alterada. Entra com a nova.' },
      })
    } catch (err) {
      setError(errorText(err))
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthCard title="Nova palavra-passe">
        <p className="form-error" role="alert">
          Este link não está completo. Abre o link do email outra vez ou pede um novo.
        </p>
        <Link to="/recuperar-palavra-passe">Pedir um novo link</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Nova palavra-passe">
      <form className="form" onSubmit={onSubmit}>
        <label>
          Nova palavra-passe
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <small className="muted">Pelo menos 8 caracteres.</small>
        <label>
          Repetir a palavra-passe
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            {error.includes('Pede um novo') && (
              <Link to="/recuperar-palavra-passe">Pedir um novo link</Link>
            )}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          Guardar palavra-passe
        </button>
        <p className="muted">Depois de mudar, todas as sessões abertas terminam.</p>
      </form>
    </AuthCard>
  )
}
