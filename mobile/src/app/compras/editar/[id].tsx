import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { formFromPurchase, PurchaseFields, toInput } from '@/lib/purchaseForm'
import type { PurchaseForm } from '@/lib/purchaseForm'
import { Button, ErrorText } from '@/lib/ui'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** Editar os dados de uma compra (a fatura troca-se no site). */
export default function EditPurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [form, setForm] = useState<PurchaseForm | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getPurchase(Number(id))
      .then((purchase) => {
        setForm(formFromPurchase(purchase))
        setCategory(purchase.category) // a app não mostra a categoria, mas não a apaga
      })
      .catch((err) => setError(message(err, 'Erro ao carregar')))
  }, [id])

  if (!form) return error ? <ErrorText>{error}</ErrorText> : null

  function change(name: keyof PurchaseForm, value: string) {
    setForm((current) => current && { ...current, [name]: value })
  }

  async function save() {
    const checked = toInput(form!, category)
    if ('error' in checked) return setError(checked.error)
    setError(null)
    setSaving(true)
    try {
      await api.updatePurchase(Number(id), checked.input)
      router.back() // o detalhe recarrega ao voltar a aparecer
    } catch (err) {
      setError(message(err, 'Não foi possível guardar'))
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <PurchaseFields form={form} onChange={change} />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ marginTop: 20 }}>
        <Button
          title={saving ? 'A guardar…' : 'Guardar alterações'}
          onPress={save}
          disabled={saving}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 },
})
