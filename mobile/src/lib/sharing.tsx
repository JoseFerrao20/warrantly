import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, Field } from '@/lib/ui'
import type { Share, SharedArchive, Sharing } from '@/shared/types'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** Pergunta antes de uma ação que não se desfaz (deixar de partilhar, sair, recusar). */
function confirm(title: string, action: string, onConfirm: () => void) {
  Alert.alert(title, undefined, [
    { text: 'Cancelar', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ])
}

/**
 * A partilha do arquivo com a família (ADR 0007), como na página da conta do site: convidar
 * pelo email, aceitar ou recusar os convites recebidos, e deixar de partilhar ou sair.
 */
export function SharingSection() {
  const colors = useColors()
  const { user } = useAuth()
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      api
        .getSharing()
        .then((data) => !cancelled && setSharing(data))
        .catch(
          (err) => !cancelled && setError(message(err, 'Não foi possível carregar a partilha')),
        )
      return () => {
        cancelled = true
      }
    }, []),
  )

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

  const invite = () => {
    if (!email.trim()) return setError('Escreve o email de quem convidas.')
    return run(async () => {
      const share = await api.invite(email.trim())
      setSharing((s) => s && { ...s, members: [...s.members, share] })
      setEmail('')
      return `Convite enviado para ${share.email}.`
    }, 'Não foi possível enviar o convite')
  }

  const resend = () =>
    run(async () => (await api.resendVerification()).detail, 'Não foi possível enviar o email')

  const accept = (archive: SharedArchive) =>
    run(async () => {
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

  const leave = (archive: SharedArchive) =>
    confirm(
      archive.accepted
        ? `Deixar de ver as compras de ${archive.owner_name}?`
        : `Recusar o convite de ${archive.owner_name}?`,
      archive.accepted ? 'Sair' : 'Recusar',
      () =>
        void run(async () => {
          await api.removeShare(archive.id)
          setSharing(
            (s) =>
              s && {
                ...s,
                shared_with_me: s.shared_with_me.filter((a) => a.id !== archive.id),
              },
          )
          return archive.accepted
            ? `Saíste do arquivo de ${archive.owner_name}.`
            : 'Convite recusado.'
        }, 'Não foi possível sair do arquivo'),
    )

  const removeMember = (share: Share) =>
    confirm(
      `Deixar de partilhar o arquivo com ${share.email}?`,
      'Remover',
      () =>
        void run(async () => {
          await api.removeShare(share.id)
          setSharing(
            (s) =>
              s && {
                ...s,
                members: s.members.filter((m) => m.id !== share.id),
              },
          )
          return `Deixaste de partilhar com ${share.email}.`
        }, 'Não foi possível deixar de partilhar'),
    )

  const card = [styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]

  return (
    <>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        Partilha
      </Text>
      <Text style={{ color: colors.muted }}>
        Partilha as tuas garantias com a família: quem aceitar vê as tuas compras e as faturas,
        pode editá-las e reclamar à loja. Apagar compras e trocar faturas fica contigo.
      </Text>

      {sharing?.shared_with_me.map((archive) => (
        <View
          key={`in-${archive.id}`}
          accessibilityLabel={`Arquivo de ${archive.owner_name}`}
          style={card}
        >
          <Text style={[styles.name, { color: colors.text }]}>{archive.owner_name}</Text>
          <Text style={{ color: colors.muted }}>
            {archive.accepted
              ? 'Partilha contigo as garantias'
              : 'Convidou-te para ver as garantias'}
          </Text>
          <View style={styles.actions}>
            {!archive.accepted && (
              <Button
                title="Aceitar"
                accessibilityLabel={`Aceitar o convite de ${archive.owner_name}`}
                disabled={busy}
                onPress={() => accept(archive)}
              />
            )}
            <Button
              title={archive.accepted ? 'Sair' : 'Recusar'}
              variant="secondary"
              accessibilityLabel={
                archive.accepted
                  ? `Sair do arquivo de ${archive.owner_name}`
                  : `Recusar o convite de ${archive.owner_name}`
              }
              disabled={busy}
              onPress={() => leave(archive)}
            />
          </View>
        </View>
      ))}

      {sharing?.members.map((share) => (
        <View
          key={`out-${share.id}`}
          accessibilityLabel={`Partilha com ${share.email}`}
          style={card}
        >
          <Text style={[styles.name, { color: colors.text }]}>{share.email}</Text>
          <Text style={{ color: colors.muted }}>
            {share.accepted ? 'Aceitou o convite' : 'Ainda não aceitou'}
          </Text>
          <View style={styles.actions}>
            <Button
              title="Remover"
              variant="secondary"
              accessibilityLabel={`Deixar de partilhar com ${share.email}`}
              disabled={busy}
              onPress={() => removeMember(share)}
            />
          </View>
        </View>
      ))}

      {user?.email_verified ? (
        <Field
          label="Email de quem convidas"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="off"
          maxLength={320}
        />
      ) : (
        <>
          <Text style={{ color: colors.text }}>
            Para partilhar e ver os convites que te fizerem, confirma primeiro o teu email: abre o
            link que enviámos para {user?.email}.
          </Text>
          <Button title="Enviar outra vez" variant="secondary" disabled={busy} onPress={resend} />
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {status && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {status}
        </Text>
      )}
      {user?.email_verified && (
        <Button title="Convidar" variant="secondary" disabled={busy} onPress={invite} />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginTop: 8 },
  row: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '600' },
  actions: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
