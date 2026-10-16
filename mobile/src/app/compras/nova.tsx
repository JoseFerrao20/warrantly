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
import { Button, ErrorText, Field } from '@/lib/ui'
import { parsePrice, todayISO } from '@/shared/warranty'

type FormField = 'product_name' | 'store' | 'purchase_date' | 'price' | 'invoice_number'
type Form = Record<FormField, string> & { warranty_months: string }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export default function NewPurchaseScreen() {
  const colors = useColors()
  const router = useRouter()
  const [form, setForm] = useState<Form>({
    product_name: '',
    store: '',
    purchase_date: todayISO(),
    price: '',
    warranty_months: '36',
    invoice_number: '',
  })
  // Campos em que o utilizador já escreveu: a leitura da fatura nunca os altera.
  const touched = useRef(new Set<keyof Form>())
  const [invoice, setInvoice] = useState<StagedInvoice | null>(null)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'invoice' | 'save' | null>(null)

  function change(name: keyof Form, value: string) {
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
      const suggestions: Partial<Record<FormField, string | null>> = scan
        ? {
            product_name: scan.product_name,
            store: scan.store,
            purchase_date: scan.purchase_date,
            price: scan.price?.replace('.', ','),
            invoice_number: scan.invoice_number,
          }
        : {}
      const filled = Object.entries(suggestions).filter(
        ([name, value]) => value && !touched.current.has(name as FormField),
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
    const price = parsePrice(form.price)
    const months = Number(form.warranty_months)
    if (!form.product_name.trim() || !form.store.trim()) {
      return setError('Indica o produto e a loja.')
    }
    if (!DATE_PATTERN.test(form.purchase_date)) {
      return setError('A data da compra tem de estar no formato AAAA-MM-DD.')
    }
    if (price === null) return setError('O preço não é válido (ex.: 749,99).')
    if (!Number.isInteger(months) || months < 1) {
      return setError('A garantia tem de ser um número de meses.')
    }

    setError(null)
    setBusy('save')
    let id: number
    try {
      const purchase = await api.createPurchase({
        product_name: form.product_name.trim(),
        store: form.store.trim(),
        category: null,
        purchase_date: form.purchase_date,
        price,
        warranty_months: months,
        invoice_number: form.invoice_number.trim() || null,
        store_email: null,
      })
      id = purchase.id
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

      <Field
        label="Produto"
        value={form.product_name}
        onChangeText={(v) => change('product_name', v)}
      />
      <Field label="Loja" value={form.store} onChangeText={(v) => change('store', v)} />
      <Field
        label="Data da compra (AAAA-MM-DD)"
        value={form.purchase_date}
        onChangeText={(v) => change('purchase_date', v)}
        keyboardType="numbers-and-punctuation"
      />
      <Field
        label="Preço (€)"
        value={form.price}
        onChangeText={(v) => change('price', v)}
        keyboardType="decimal-pad"
      />
      <Field
        label="Garantia (meses)"
        value={form.warranty_months}
        onChangeText={(v) => change('warranty_months', v)}
        keyboardType="number-pad"
      />
      <Field
        label="N.º da fatura (opcional)"
        value={form.invoice_number}
        onChangeText={(v) => change('invoice_number', v)}
      />

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
