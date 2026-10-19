import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import type { PickedFile } from '@/lib/api'
import { attachStaged, scanStaged, stageInvoice } from '@/lib/invoice'
import type { StagedInvoice } from '@/lib/invoice'
import { useColors } from '@/lib/theme'
import { emptyForm, PurchaseFields, toInput } from '@/lib/purchaseForm'
import type { PurchaseForm } from '@/lib/purchaseForm'
import { Button, ErrorText } from '@/lib/ui'

// Os campos que a leitura da fatura pode sugerir.
type ScannedField = 'product_name' | 'store' | 'purchase_date' | 'price' | 'invoice_number'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export default function NewPurchaseScreen() {
  const colors = useColors()
  const router = useRouter()
  const [form, setForm] = useState<PurchaseForm>(emptyForm)
  // Campos em que o utilizador já escreveu: a leitura da fatura nunca os altera.
  const touched = useRef(new Set<keyof PurchaseForm>())
  const [invoice, setInvoice] = useState<StagedInvoice | null>(null)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'invoice' | 'save' | null>(null)

  function change(name: keyof PurchaseForm, value: string) {
    touched.current.add(name)
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleFile(file: PickedFile) {
    setError(null)
    setScanNote(null)
    setBusy('invoice')
    try {
      const staged = await stageInvoice(file)
      setInvoice(staged)
      const scan = await scanStaged(staged).catch(() => null) // a leitura é só uma ajuda
      const suggestions: Partial<Record<ScannedField, string | null>> = scan
        ? {
            product_name: scan.product_name,
            store: scan.store,
            purchase_date: scan.purchase_date,
            price: scan.price?.replace('.', ','),
            invoice_number: scan.invoice_number,
          }
        : {}
      const filled = Object.entries(suggestions).filter(
        ([name, value]) => value && !touched.current.has(name as ScannedField),
      )
      setForm((current) => ({ ...current, ...Object.fromEntries(filled) }))
      setScanNote(
        filled.length > 0
          ? 'Preenchemos alguns campos com o que lemos na fatura. Confirma antes de guardar.'
          : 'Não conseguimos ler os dados da fatura; preenche à mão.',
      )
    } catch (err) {
      setInvoice(null)
      setError(message(err, 'Não foi possível usar a fatura'))
    } finally {
      setBusy(null)
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      setError('Sem acesso à câmara. Podes autorizar nas definições do telemóvel.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
    if (result.canceled) return
    const photo = result.assets[0]
    await handleFile({
      uri: photo.uri,
      name: photo.fileName ?? 'fatura.jpg',
      type: photo.mimeType ?? 'image/jpeg',
      size: photo.fileSize,
    })
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    const file = result.assets[0]
    await handleFile({
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? 'application/octet-stream',
      size: file.size,
    })
  }

  async function save() {
    const checked = toInput(form)
    if ('error' in checked) return setError(checked.error)

    setError(null)
    setBusy('save')
    let id: number
    try {
      id = (await api.createPurchase(checked.input)).id
    } catch (err) {
      setBusy(null)
      return setError(message(err, 'Não foi possível guardar a compra'))
    }
    if (invoice) {
      try {
        await attachStaged(id, invoice)
      } catch (err) {
        Alert.alert(
          'Compra guardada sem fatura',
          `${message(err, 'A fatura não foi enviada')}. Podes juntá-la depois no site.`,
        )
      }
    }
    router.replace(`/compras/${id}`)
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.invoice}>
        <Text style={[styles.section, { color: colors.text }]}>Fatura</Text>
        <Text style={{ color: colors.muted }}>
          {invoice
            ? `Fatura escolhida: ${invoice.file.name}`
            : 'Fotografa ou escolhe a fatura; tentamos ler os dados por ti.'}
        </Text>
        <View style={styles.buttons}>
          <View style={{ flex: 1 }}>
            <Button title="Fotografar" onPress={takePhoto} disabled={busy !== null} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Escolher ficheiro"
              variant="secondary"
              onPress={pickFile}
              disabled={busy !== null}
            />
          </View>
        </View>
        {busy === 'invoice' && <Text style={{ color: colors.muted }}>A ler a fatura…</Text>}
        {scanNote && <Text style={{ color: colors.muted }}>{scanNote}</Text>}
      </View>

      <PurchaseFields form={form} onChange={change} />

      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ marginTop: 20 }}>
        <Button
          title={busy === 'save' ? 'A guardar…' : 'Guardar compra'}
          onPress={save}
          disabled={busy !== null}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 },
  invoice: { gap: 8, marginBottom: 8 },
  section: { fontSize: 18, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 10 },
})
