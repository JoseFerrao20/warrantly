import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError } from '../api'
import { getTheme, setTheme } from '../theme'
import type { Theme } from '../theme'
import { useAuth } from '../useAuth'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export function AccountPage() {
  const { user, updateProfile, deleteAccount } = useAuth()

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [saved, setSaved] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [theme, setThemeState] = useState<Theme>(getTheme)

  const [password, setPassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    setProfileError(null)
    setBusy(true)
    try {
      await updateProfile(fullName.trim() || null)
      setSaved(true)
    } catch (err) {
      setProfileError(message(err, 'Não foi possível guardar'))
    } finally {
      setBusy(false)
    }
  }

  async function removeAccount(event: FormEvent) {
    event.preventDefault()
    setDeleteError(null)
    if (!window.confirm('Apagar a conta, todas as compras e faturas? Não dá para desfazer.')) return
    setBusy(true)
    try {
      // Sem sessão, a app volta sozinha ao login, que mostra "A tua conta foi apagada".
      await deleteAccount(password)
    } catch (err) {
      setDeleteError(message(err, 'Não foi possível apagar a conta'))
      setBusy(false)
    }
  }

  return (
    <div className="account">
      <h1>A tua conta</h1>

      <form className="card form" onSubmit={saveProfile}>
        <h2>Perfil</h2>
        <p className="muted">{user?.email}</p>
        <label>
          <span>
            Nome <span className="muted">(assina as reclamações)</span>
          </span>
          <input
            autoComplete="name"
            maxLength={200}
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        {profileError && (
          <p className="form-error" role="alert">
            {profileError}
          </p>
        )}
        <div className="form-actions">
          {saved && <span role="status">Guardado.</span>}
          <button type="submit" className="button button-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>

      <section className="card form">
        <h2>Aparência</h2>
        <label>
          Tema
          <select
            value={theme}
            onChange={(e) => {
              const value = e.target.value as Theme
              setTheme(value)
              setThemeState(value)
            }}
          >
            <option value="system">Igual ao sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </label>
      </section>

      <form className="card form danger-zone" onSubmit={removeAccount}>
        <h2>Apagar conta</h2>
        <p className="muted">
          Apaga a conta, todas as compras, as faturas guardadas e os alertas. Não dá para desfazer.
        </p>
        <label>
          Palavra-passe (para confirmar)
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {deleteError && (
          <p className="form-error" role="alert">
            {deleteError}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button button-danger" disabled={busy}>
            Apagar conta
          </button>
        </div>
      </form>
    </div>
  )
}
