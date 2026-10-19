import { useEffect, useState } from 'react'

import { api, ApiError } from '../api'
import type { UserSession } from '../types'

const dateTimeFormat = new Intl.DateTimeFormat('pt-PT', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value))
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** Os aparelhos com sessão aberta, para terminar a de um aparelho perdido ou emprestado. */
export function SessionsSection() {
  const [sessions, setSessions] = useState<UserSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .listSessions()
      .then((list) => !cancelled && setSessions(list))
      .catch((err) => !cancelled && setError(message(err, 'Não foi possível carregar as sessões')))
    return () => {
      cancelled = true
    }
  }, [])

  async function endOne(session: UserSession) {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      await api.endSession(session.id)
      setSessions((list) => list?.filter((s) => s.id !== session.id) ?? null)
      setStatus(`Sessão terminada: ${session.device}.`)
    } catch (err) {
      setError(message(err, 'Não foi possível terminar a sessão'))
    } finally {
      setBusy(false)
    }
  }

  async function endOthers() {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const { ended } = await api.endOtherSessions()
      setSessions((list) => list?.filter((s) => s.current) ?? null)
      setStatus(ended === 1 ? 'Terminada 1 sessão.' : `Terminadas ${ended} sessões.`)
    } catch (err) {
      setError(message(err, 'Não foi possível terminar as sessões'))
    } finally {
      setBusy(false)
    }
  }

  const others = sessions?.filter((s) => !s.current) ?? []

  return (
    <section className="card form" aria-labelledby="sessions-title">
      <h2 id="sessions-title">Sessões</h2>
      <p className="muted">
        Os aparelhos onde entraste na tua conta. Se não reconheceres algum, ou perdeste o
        telemóvel, termina a sessão dele e muda a palavra-passe.
      </p>
      {sessions === null && !error && <p className="muted">A carregar…</p>}
      {sessions && sessions.length > 0 && (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session">
              <div>
                <p className="session-device">
                  {session.device}
                  {session.current && <span className="badge badge-active">Este aparelho</span>}
                </p>
                <p className="muted session-dates">
                  Última atividade: {formatDateTime(session.last_used_at)} · Entrada:{' '}
                  {formatDateTime(session.created_at)}
                </p>
              </div>
              {!session.current && (
                <button
                  type="button"
                  className="button"
                  onClick={() => endOne(session)}
                  disabled={busy}
                  aria-label={`Terminar sessão: ${session.device}`}
                >
                  Terminar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {status && <span role="status">{status}</span>}
        {others.length > 0 && (
          <button type="button" className="button" onClick={endOthers} disabled={busy}>
            Sair dos outros aparelhos
          </button>
        )}
      </div>
    </section>
  )
}
