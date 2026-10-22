import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import type { PickedFile } from '@/lib/api'
import {
  attachStaged,
  pickInvoiceFile,
  scanStaged,
  stageInvoice,
  takeInvoicePhoto,
} from '@/lib/invoice'
import type { StagedInvoice } from '@/lib/invoice'
import { InvoiceQRScanner } from '@/lib/qrScanner'
import { useColors } from '@/lib/theme'
import { emptyForm, PurchaseFields, toInput } from '@/lib/purchaseForm'
import type { PurchaseForm } from '@/lib/purchaseForm'
import { Button, ErrorText } from '@/lib/ui'
import type { InvoiceScan } from '@/shared/types'

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
  const [scanningQr, setScanningQr] = useState(false)

  function change(name: keyof PurchaseForm, value: string) {
    touched.current.add(name)
    setForm((current) => ({ ...current, [name]: value }))
  }

  /** Preenche os campos vazios com o que a leitura sugere; devolve quantos preencheu. */
  function applyScan(scan: InvoiceScan | null): number {
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
    return filled.length
  }

  function handleQr(scan: InvoiceScan) {
    setScanningQr(false)
    setError(null)
    applyScan(scan)
    setScanNote(
      'Lemos o código QR da fatura. Confirma a data, o preço e o n.º, e indica o produto e a ' +
        'loja. Para guardar a fatura, fotografa-a ou escolhe o ficheiro.',
    )
  }

  async function handleFile(file: PickedFile) {
    setError(null)
    setScanNote(null)
    setBusy('invoice')
    try {
      const staged = await stageInvoice(file)
      setInvoice(staged)
      const scan = await scanStaged(staged).catch(() => null) // a leitura é só uma ajuda
      setScanNote(
        applyScan(scan) > 0
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

  async function choose(pick: () => Promise<PickedFile | null>) {
    setError(null)
    try {
      const file = await pick()
      if (file) await handleFile(file)
    } catch (err) {
      setError(message(err, 'Não foi possível abrir a fatura'))
    }
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
            <Button title="Fotografar" onPress={() => choose(takeInvoicePhoto)} disabled={busy !== null} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Escolher ficheiro"
              variant="secondary"
              onPress={() => choose(pickInvoiceFile)}
              disabled={busy !== null}
            />
          </View>
        </View>
        <Button
          title="Ler o código QR"
          variant="secondary"
          onPress={() => setScanningQr(true)}
          disabled={busy !== null}
        />
        {busy === 'invoice' && <Text style={{ color: colors.muted }}>A ler a fatura…</Text>}
        {scanNote && <Text style={{ color: colors.muted }}>{scanNote}</Text>}
      </View>

      <PurchaseFields form={form} onChange={change} />

      {scanningQr && (
        <InvoiceQRScanner onScanned={handleQr} onClose={() => setScanningQr(false)} />
      )}

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
