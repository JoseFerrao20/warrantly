import { useState } from 'react'
import type { FormEvent } from 'react'

import { api, ApiError } from '../api'
import { SessionsSection } from '../components/SessionsSection'
import { getTheme, setTheme } from '../theme'
import type { Theme } from '../theme'
import { useAuth } from '../useAuth'
import { usePageTitle } from '../usePageTitle'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export function AccountPage() {
  const { user, updateProfile, deleteAccount } = useAuth()
  usePageTitle('A tua conta')

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [saved, setSaved] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [theme, setThemeState] = useState<Theme>(getTheme)

  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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

  async function exportData() {
    setExportError(null)
    setExported(false)
    setExporting(true)
    try {
      const blob = await api.exportPurchases()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `warrantly-${new Date().toISOString().slice(0, 10)}.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExported(true)
    } catch (err) {
      setExportError(message(err, 'Não foi possível exportar'))
    } finally {
      setExporting(false)
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

      <section className="card form">
        <h2>Exportar dados</h2>
        <p className="muted">
          Um ZIP com todas as compras (<code>compras.csv</code>, que abre no Excel, e{' '}
          <code>compras.json</code>) e as faturas guardadas, na pasta <code>faturas</code>.
        </p>
        {exportError && (
          <p className="form-error" role="alert">
            {exportError}
          </p>
        )}
        <div className="form-actions">
          {exported && <span role="status">Descarregado.</span>}
          <button type="button" className="button" onClick={exportData} disabled={exporting}>
            {exporting ? 'A preparar…' : 'Descarregar ZIP'}
          </button>
        </div>
      </section>

      <SessionsSection />

      <form className="card form danger-zone" onSubmit={removeAccount}>
        <h2>Apagar conta</h2>
        <p className="muted">
          Apaga a conta, todas as compras, as faturas guardadas e os alertas. Não dá para desfazer.
          Se quiseres guardar uma cópia, exporta os dados antes.
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
