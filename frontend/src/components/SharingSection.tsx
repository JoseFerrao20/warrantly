import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { api, ApiError } from '../api'
import type { Share, SharedArchive, Sharing } from '../types'
import { useAuth } from '../useAuth'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Partilhar o arquivo com a família (ADR 0007): quem aceita vê as minhas compras, edita-as e
 * reclama à loja. Também mostra os arquivos partilhados comigo, para aceitar ou sair.
 */
export function SharingSection() {
  const { user } = useAuth()
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .getSharing()
      .then((data) => !cancelled && setSharing(data))
      .catch((err) => !cancelled && setError(message(err, 'Não foi possível carregar a partilha')))
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<string>, fallback: string) {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      setStatus(await action())
    } catch (err) {
      setError(message(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  function invite(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const share = await api.invite(email.trim())
      setSharing((s) => s && { ...s, members: [...s.members, share] })
      setEmail('')
      return `Convite enviado para ${share.email}.`
    }, 'Não foi possível enviar o convite')
  }

  function removeMember(share: Share) {
    if (!window.confirm(`Deixar de partilhar o arquivo com ${share.email}?`)) return
    void run(async () => {
      await api.removeShare(share.id)
      setSharing((s) => s && { ...s, members: s.members.filter((m) => m.id !== share.id) })
      return `Deixaste de partilhar com ${share.email}.`
    }, 'Não foi possível deixar de partilhar')
  }

  function accept(archive: SharedArchive) {
    void run(async () => {
      const accepted = await api.acceptShare(archive.id)
      setSharing(
        (s) =>
          s && {
            ...s,
            shared_with_me: s.shared_with_me.map((a) => (a.id === archive.id ? accepted : a)),
          },
      )
      return `As compras de ${archive.owner_name} já aparecem nas tuas garantias.`
    }, 'Não foi possível aceitar o convite')
  }

  function leave(archive: SharedArchive) {
    const question = archive.accepted
      ? `Deixar de ver as compras de ${archive.owner_name}?`
      : `Recusar o convite de ${archive.owner_name}?`
    if (!window.confirm(question)) return
    void run(async () => {
      await api.removeShare(archive.id)
      setSharing(
        (s) =>
          s && {
            ...s,
            shared_with_me: s.shared_with_me.filter((a) => a.id !== archive.id),
          },
      )
      return archive.accepted ? `Saíste do arquivo de ${archive.owner_name}.` : 'Convite recusado.'
    }, 'Não foi possível sair do arquivo')
  }

  return (
    <section className="card form" aria-labelledby="sharing-title">
      <h2 id="sharing-title">Partilha</h2>
      <p className="muted">
        Partilha as tuas garantias com a família: quem aceitar vê as tuas compras e as faturas, pode
        editá-las e reclamar à loja. Apagar compras e trocar faturas fica contigo, tal como os
        alertas por email.
      </p>

      {sharing && sharing.shared_with_me.length > 0 && (
        <>
          <h3>Partilhados contigo</h3>
          <ul className="session-list">
            {sharing.shared_with_me.map((archive) => (
              <li key={archive.id} className="session">
                <div>
                  <p className="session-device">
                    {archive.owner_name}
                    {!archive.accepted && <span className="badge badge-expiring">Convite</span>}
                  </p>
                  <p className="muted session-dates">{archive.owner_email}</p>
                </div>
                <div className="form-actions">
                  {!archive.accepted && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => accept(archive)}
                      disabled={busy}
                      aria-label={`Aceitar o convite de ${archive.owner_name}`}
                    >
                      Aceitar
                    </button>
                  )}
                  <button
                    type="button"
                    className="button"
                    onClick={() => leave(archive)}
                    disabled={busy}
                    aria-label={
                      archive.accepted
                        ? `Sair do arquivo de ${archive.owner_name}`
                        : `Recusar o convite de ${archive.owner_name}`
                    }
                  >
                    {archive.accepted ? 'Sair' : 'Recusar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {sharing && sharing.members.length > 0 && (
        <>
          <h3>Partilhas o teu arquivo com</h3>
          <ul className="session-list">
            {sharing.members.map((share) => (
              <li key={share.id} className="session">
                <div>
                  <p className="session-device">{share.email}</p>
                  <p className="muted session-dates">
                    {share.accepted ? 'Aceitou o convite' : 'Ainda não aceitou'}
                  </p>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => removeMember(share)}
                  disabled={busy}
                  aria-label={`Remover a partilha com ${share.email}`}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!user?.email_verified ? (
        <p className="muted">
          Para partilhar o arquivo e ver os convites que te fizerem, confirma primeiro o teu email
          (o link está no email que enviámos quando criaste a conta).
        </p>
      ) : (
        <form onSubmit={invite} className="form">
          <label>
            Email de quem convidas
            <input
              type="email"
              autoComplete="off"
              required
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            {status && <span role="status">{status}</span>}
            <button type="submit" className="button" disabled={busy}>
              Convidar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
