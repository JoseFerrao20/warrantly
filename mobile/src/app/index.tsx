import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, StatusBadge } from '@/lib/ui'
import type { Purchase } from '@/shared/types'
import { todayISO } from '@/shared/warranty'

const STATUS_ORDER = { expiring: 0, active: 1, expired: 2 }

export default function DashboardScreen() {
  const colors = useColors()
  const router = useRouter()
  const { user } = useAuth()
  const [purchases, setPurchases] = useState<Purchase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const today = todayISO()

  const load = useCallback(async () => {
    try {
      const list = await api.listPurchases()
      // Como no site: as que estão a expirar primeiro, as expiradas no fim.
      setPurchases(
        [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
      )
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar as compras')
    }
  }, [])

  // Recarrega sempre que o painel volta a aparecer (ex.: depois de criar uma compra).
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const expiring = purchases?.filter((p) => p.status === 'expiring').length ?? 0

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="link" onPress={() => router.push('/conta')} hitSlop={12}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Conta</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={purchases ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 12 }}>
            {error && <ErrorText>{error}</ErrorText>}
            {expiring > 0 && (
              <Text
                style={[
                  styles.notice,
                  {
                    backgroundColor: colors.status.expiring.bg,
                    color: colors.status.expiring.text,
                  },
                ]}
              >
                {expiring === 1
                  ? '1 garantia termina nos próximos 60 dias.'
                  : `${expiring} garantias terminam nos próximos 60 dias.`}
              </Text>
            )}
            <Button title="+ Nova compra" onPress={() => router.push('/compras/nova')} />
          </View>
        }
        ListEmptyComponent={
          purchases ? (
            <Text style={[styles.empty, { color: colors.muted }]}>
              Ainda não tens compras registadas. Fotografa a primeira fatura!
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/compras/${item.id}`)}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={[styles.product, { color: colors.text }]}>{item.product_name}</Text>
            <Text style={{ color: colors.muted, marginBottom: 6 }}>
              {item.store}
              {item.user_id !== user?.id && ` · de ${item.owner_name}`}
            </Text>
            <StatusBadge status={item.status} warrantyEnd={item.warranty_end} today={today} />
          </Pressable>
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  notice: { padding: 12, borderRadius: 8, overflow: 'hidden', fontSize: 15 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 16 },
  row: { padding: 14, borderRadius: 10, borderWidth: 1 },
  product: { fontSize: 17, fontWeight: '600' },
})
