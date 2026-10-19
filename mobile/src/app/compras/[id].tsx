import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, StatusBadge } from '@/lib/ui'
import type { Purchase } from '@/shared/types'
import { formatDate, formatMonths, formatPrice, todayISO } from '@/shared/warranty'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export default function PurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const router = useRouter()
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'invoice' | 'delete' | null>(null)

  // Recarrega ao voltar a este ecrã (ex.: depois de editar).
  useFocusEffect(
    useCallback(() => {
      api
        .getPurchase(Number(id))
        .then(setPurchase)
        .catch((err) => setLoadError(message(err, 'Erro ao carregar')))
    }, [id]),
  )

  if (loadError) return <ErrorText>{loadError}</ErrorText>
  if (!purchase) return null
  const current = purchase

  async function openInvoice() {
    setError(null)
    setBusy('invoice')
    try {
      const uri = await api.downloadInvoice(current)
      // Abre o menu do sistema para ver a fatura (ou guardá-la, ou enviá-la).
      await Sharing.shareAsync(uri, {
        mimeType: current.invoice_content_type ?? undefined,
        dialogTitle: 'Abrir a fatura',
      })
    } catch (err) {
      setError(message(err, 'Não foi possível abrir a fatura'))
    } finally {
      setBusy(null)
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Apagar a compra?',
      `"${current.product_name}" e a fatura são apagadas. Não dá para desfazer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Apagar', style: 'destructive', onPress: () => void remove() },
      ],
    )
  }

  async function remove() {
    setError(null)
    setBusy('delete')
    try {
      await api.deletePurchase(current.id)
      router.replace('/')
    } catch (err) {
      setError(message(err, 'Não foi possível apagar a compra'))
      setBusy(null)
    }
  }

  const rows: [string, string][] = [
    ['Loja', current.store],
    ['Data da compra', formatDate(current.purchase_date)],
    ['Preço', formatPrice(current.price)],
    ['Garantia', formatMonths(current.warranty_months)],
    ['Fim da garantia', formatDate(current.warranty_end)],
  ]
  if (current.invoice_number) rows.push(['N.º da fatura', current.invoice_number])
  if (current.store_email) rows.push(['Email da loja', current.store_email])
  rows.push(['Fatura', current.invoice_filename ?? 'Sem fatura'])

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: current.product_name }} />
      <StatusBadge status={current.status} warrantyEnd={current.warranty_end} today={todayISO()} />
      <View style={{ marginTop: 16 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.row, { borderColor: colors.border }]}>
            <Text style={{ color: colors.muted }}>{label}</Text>
            <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        {current.invoice_filename && (
          <Button
            title={busy === 'invoice' ? 'A abrir…' : 'Ver a fatura'}
            onPress={openInvoice}
            disabled={busy !== null}
          />
        )}
        <Button
          title="Editar"
          variant="secondary"
          onPress={() => router.push(`/compras/editar/${current.id}`)}
          disabled={busy !== null}
        />
        <Button
          title={busy === 'delete' ? 'A apagar…' : 'Apagar'}
          variant="secondary"
          onPress={confirmDelete}
          disabled={busy !== null}
        />
      </View>
      <Text style={{ color: colors.muted, marginTop: 20 }}>
        Para gerar a reclamação ou trocar a fatura, usa o site.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { fontSize: 16, marginTop: 2 },
  actions: { marginTop: 20, gap: 10 },
})
