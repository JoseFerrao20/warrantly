import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useColors } from '@/lib/theme'
import { ErrorText, StatusBadge } from '@/lib/ui'
import type { Purchase } from '@/shared/types'
import { formatDate, formatMonths, formatPrice, todayISO } from '@/shared/warranty'

export default function PurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getPurchase(Number(id))
      .then(setPurchase)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar'))
  }, [id])

  if (error) return <ErrorText>{error}</ErrorText>
  if (!purchase) return null

  const rows: [string, string][] = [
    ['Loja', purchase.store],
    ['Data da compra', formatDate(purchase.purchase_date)],
    ['Preço', formatPrice(purchase.price)],
    ['Garantia', formatMonths(purchase.warranty_months)],
    ['Fim da garantia', formatDate(purchase.warranty_end)],
  ]
  if (purchase.invoice_number) rows.push(['N.º da fatura', purchase.invoice_number])
  rows.push(['Fatura', purchase.invoice_filename ?? 'Sem fatura'])

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: purchase.product_name }} />
      <StatusBadge
        status={purchase.status}
        warrantyEnd={purchase.warranty_end}
        today={todayISO()}
      />
      <View style={{ marginTop: 16 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.row, { borderColor: colors.border }]}>
            <Text style={{ color: colors.muted }}>{label}</Text>
            <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: colors.muted, marginTop: 20 }}>
        Para ver a fatura, gerar a reclamação ou editar, usa o site.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { fontSize: 16, marginTop: 2 },
})
