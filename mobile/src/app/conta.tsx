import { useFocusEffect } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { SharingSection } from '@/lib/sharing'
import { useColors } from '@/lib/theme'
import { Button, ErrorText } from '@/lib/ui'
import type { UserSession } from '@/shared/types'
import { todayISO } from '@/shared/warranty'

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

/**
 * A conta, como a página da conta do site: a partilha do arquivo com a família (ADR 0007), os
 * aparelhos com sessão aberta, para terminar a de um telemóvel perdido ou emprestado, e o
 * "Sair" deste telemóvel.
 */
export default function AccountScreen() {
  const colors = useColors()
  const { user, logout } = useAuth()
  const [sessions, setSessions] = useState<UserSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      api
        .listSessions()
        .then((list) => !cancelled && setSessions(list))
        .catch((err) => !cancelled && setError(message(err, 'Não foi possível carregar as sessões')))
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

  const endOne = (session: UserSession) =>
    run(async () => {
      await api.endSession(session.id)
      setSessions((list) => list?.filter((s) => s.id !== session.id) ?? null)
      return `Sessão terminada: ${session.device}.`
    }, 'Não foi possível terminar a sessão')

  const endOthers = () =>
    run(async () => {
      const { ended } = await api.endOtherSessions()
      setSessions((list) => list?.filter((s) => s.current) ?? null)
      return ended === 1 ? 'Terminada 1 sessão.' : `Terminadas ${ended} sessões.`
    }, 'Não foi possível terminar as sessões')

  async function exportData() {
    setExportError(null)
    setExporting(true)
    try {
      const uri = await api.downloadExport(todayISO())
      // O menu do sistema: guardar nos ficheiros, no Drive, enviar por email…
      await Sharing.shareAsync(uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Guardar a exportação',
      })
    } catch (err) {
      setExportError(message(err, 'Não foi possível exportar'))
    } finally {
      setExporting(false)
    }
  }

  const others = sessions?.filter((s) => !s.current) ?? []

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.email, { color: colors.text }]}>{user?.email}</Text>

      <SharingSection />

      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        Exportar dados
      </Text>
      <Text style={{ color: colors.muted }}>
        Um ZIP com todas as tuas compras (compras.csv, que abre no Excel, e compras.json) e as
        faturas guardadas.
      </Text>
      <Button
        title={exporting ? 'A preparar…' : 'Exportar (ZIP)'}
        variant="secondary"
        disabled={exporting}
        onPress={exportData}
      />
      {exportError && <ErrorText>{exportError}</ErrorText>}

      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        Sessões
      </Text>
      <Text style={{ color: colors.muted }}>
        Os aparelhos onde entraste na tua conta. Se não reconheceres algum, ou perdeste um
        telemóvel, termina a sessão dele e muda a palavra-passe no site.
      </Text>

      {sessions === null && !error && <Text style={{ color: colors.muted }}>A carregar…</Text>}
      {sessions?.map((session) => (
        <View
          key={session.id}
          accessibilityLabel={`Sessão: ${session.device}`}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <View style={styles.rowHeader}>
            <Text style={[styles.device, { color: colors.text }]}>{session.device}</Text>
            {session.current && (
              <Text
                style={[
                  styles.badge,
                  { backgroundColor: colors.status.active.bg, color: colors.status.active.text },
                ]}
              >
                Este telemóvel
              </Text>
            )}
          </View>
          <Text style={{ color: colors.muted }}>
            Última atividade: {formatDateTime(session.last_used_at)}
          </Text>
          <Text style={{ color: colors.muted }}>Entrada: {formatDateTime(session.created_at)}</Text>
          {!session.current && (
            <View style={styles.rowAction}>
              <Button
                title="Terminar"
                variant="secondary"
                accessibilityLabel={`Terminar sessão: ${session.device}`}
                disabled={busy}
                onPress={() => endOne(session)}
              />
            </View>
          )}
        </View>
      ))}

      {error && <ErrorText>{error}</ErrorText>}
      {status && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {status}
        </Text>
      )}
      {others.length > 0 && (
        <Button
          title="Sair dos outros aparelhos"
          variant="secondary"
          disabled={busy}
          onPress={endOthers}
        />
      )}

      <View style={styles.logout}>
        <Button title="Sair" onPress={logout} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  email: { fontSize: 16 },
  title: { fontSize: 20, fontWeight: '600', marginTop: 8 },
  row: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 4 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  device: { fontSize: 16, fontWeight: '600' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
    fontSize: 13,
  },
  rowAction: { marginTop: 8, alignSelf: 'flex-start' },
  logout: { marginTop: 24 },
})
