import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { ApiError } from '../api'
import { useAuth } from '../useAuth'

export function LoginPage() {
  const { user, notice, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, fullName.trim() || null)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ligar ao servidor')
    } finally {
      setSubmitting(false)
    }
  }

  const isLogin = mode === 'login'
  return (
    <main className="auth">
      <h1 className="brand">Warrantly</h1>
      <p className="muted">As tuas garantias, num só sítio.</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form className="card form" onSubmit={onSubmit}>
        <h2>{isLogin ? 'Entrar' : 'Criar conta'}</h2>
        {!isLogin && (
          <label>
            <span>
              Nome <span className="muted">(opcional, para assinar as reclamações)</span>
            </span>
            <input
              autoComplete="name"
              maxLength={200}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
        )}
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
        <label>
          Palavra-passe
          <input
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={isLogin ? undefined : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {!isLogin && <small className="muted">Pelo menos 8 caracteres.</small>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          {isLogin ? 'Entrar' : 'Criar conta'}
        </button>
        <button
          type="button"
          className="button-link"
          onClick={() => {
            setMode(isLogin ? 'register' : 'login')
            setError(null)
          }}
        >
          {isLogin ? 'Ainda não tens conta? Cria uma' : 'Já tens conta? Entra'}
        </button>
      </form>
    </main>
  )
}
