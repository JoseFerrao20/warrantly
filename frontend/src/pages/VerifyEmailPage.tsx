import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { api, ApiError } from '../api'
import { useAuth } from '../useAuth'
import { usePageTitle } from '../usePageTitle'
import { AuthCard } from './PasswordResetPages'

/** Página do link do email de confirmação: /confirmar-email#token=... (ADR 0008). */
export function VerifyEmailPage() {
  usePageTitle('Confirmar o email')
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  // O token vem no fragmento (#), que o browser não envia ao servidor.
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'))
  const [result, setResult] = useState<'ok' | string | null>(
    token ? null : 'Este link não está completo. Abre o link do email outra vez.',
  )

  useEffect(() => {
    // Tira o token da barra de endereço (e do histórico) depois de o ler.
    if (location.hash) navigate(location.pathname, { replace: true })
  }, [location.hash, location.pathname, navigate])

  useEffect(() => {
    if (!token) return
    // Confirmar duas vezes não faz mal (o StrictMode corre este efeito duas vezes).
    api
      .verifyEmail(token)
      .then(async () => {
        setResult('ok')
        await refreshUser().catch(() => undefined) // com sessão aberta, tira o aviso
      })
      .catch((err) =>
        setResult(err instanceof ApiError ? err.message : 'Não foi possível ligar ao servidor'),
      )
  }, [token, refreshUser])

  return (
    <AuthCard title="Confirmar o email">
      {result === null && <p className="muted">A confirmar…</p>}
      {result === 'ok' && (
        <>
          <p className="notice" role="status">
            O teu email está confirmado. Já podes partilhar as garantias com a família.
          </p>
          <Link to="/" className="button button-primary">
            Ir para as garantias
          </Link>
        </>
      )}
      {result !== null && result !== 'ok' && (
        <p className="form-error" role="alert">
          {result} Para receberes outro, entra na tua conta e carrega em "Enviar outra vez".
        </p>
      )}
    </AuthCard>
  )
}
