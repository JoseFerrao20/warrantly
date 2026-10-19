import { useLocalSearchParams } from 'expo-router'
import * as MailComposer from 'expo-mail-composer'
import * as Sharing from 'expo-sharing'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, Field } from '@/lib/ui'
import type { Claim, Purchase } from '@/shared/types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * A reclamação à loja, como no site: a API escreve a carta, e o envio é pelo email da
 * própria pessoa. No telemóvel, o email abre já com o destinatário, o assunto, a carta e o
 * PDF (carta e fatura) em anexo. Sem uma conta de email no telemóvel, partilha-se o PDF.
 */
export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const { user, updateName } = useAuth()
  const needsName = !user?.full_name
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [fullName, setFullName] = useState('')
  const [description, setDescription] = useState('')
  const [claim, setClaim] = useState<Claim | null>(null)
  // A descrição da carta mostrada: o PDF tem de lhe corresponder, mesmo que a caixa mude.
  const [claimDescription, setClaimDescription] = useState('')
  const [storeEmail, setStoreEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<'claim' | 'send' | null>(null)

  useEffect(() => {
    api
      .getPurchase(Number(id))
      .then((loaded) => {
        setPurchase(loaded)
        setStoreEmail(loaded.store_email ?? '')
      })
      .catch((err) => setError(message(err, 'Erro ao carregar')))
  }, [id])

  async function generate() {
    if (needsName && !fullName.trim()) return setError('Escreve o teu nome, para assinar a carta.')
    if (!description.trim()) return setError('Descreve o problema.')
    setError(null)
    setStatus(null)
    setBusy('claim')
    try {
      if (needsName) await updateName(fullName)
      setClaim(await api.generateClaim(Number(id), description.trim()))
      setClaimDescription(description.trim())
    } catch (err) {
      setError(message(err, 'Não foi possível gerar a reclamação'))
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!claim) return
    const recipient = storeEmail.trim()
    if (recipient && !EMAIL_PATTERN.test(recipient)) return setError('O email da loja não é válido.')
    setError(null)
    setStatus(null)
    setBusy('send')
    try {
      const pdf = await api.saveClaimPdf(Number(id), claimDescription)
      rememberStoreEmail(recipient || null)
      if (await MailComposer.isAvailableAsync()) {
        const result = await MailComposer.composeAsync({
          recipients: recipient ? [recipient] : [],
          subject: claim.subject,
          body: claim.body,
          attachments: [pdf],
        })
        if (result.status === MailComposer.MailComposerStatus.SENT) {
          setStatus('Reclamação enviada.')
        } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
          setStatus('A reclamação ficou nos rascunhos do email.')
        }
      } else {
        await Sharing.shareAsync(pdf, {
          mimeType: 'application/pdf',
          dialogTitle: 'Enviar a reclamação',
        })
        setStatus(
          'Não encontrámos uma conta de email no telemóvel: envia o PDF por onde preferires ' +
            '(tem a carta e a fatura).',
        )
      }
    } catch (err) {
      setError(message(err, 'Não foi possível preparar o email'))
    } finally {
      setBusy(null)
    }
  }

  /** Guarda o email da loja na compra, para a próxima vez (sem atrasar o envio). */
  function rememberStoreEmail(value: string | null) {
    if (!purchase || value === purchase.store_email) return
    api
      .updatePurchase(purchase.id, { store_email: value })
      .then(setPurchase)
      .catch(() => {}) // não impede a reclamação; fica por guardar
  }

  if (!purchase) return error ? <ErrorText>{error}</ErrorText> : null

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={[styles.product, { color: colors.text }]}>
        {purchase.product_name} · {purchase.store}
      </Text>
      {needsName && (
        <Field
          label="O teu nome (para assinar a carta)"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          maxLength={200}
        />
      )}
      <Field
        label="Descreve o problema"
        value={description}
        onChangeText={setDescription}
        placeholder="Não centrifuga e dá o erro E18 a meio do programa."
        multiline
        textAlignVertical="top"
        maxLength={2000}
      />
      <View style={styles.action}>
        <Button
          title={busy === 'claim' ? 'A gerar…' : 'Gerar reclamação'}
          onPress={generate}
          disabled={busy !== null}
        />
      </View>

      {claim && (
        <View style={styles.result}>
          {!claim.within_warranty && (
            <Text
              style={[
                styles.warning,
                {
                  backgroundColor: colors.status.expiring.bg,
                  color: colors.status.expiring.text,
                },
              ]}
            >
              A garantia desta compra já terminou: a loja pode recusar a reclamação.
            </Text>
          )}
          <Text style={{ color: colors.text }}>
            <Text style={{ fontWeight: '600' }}>Assunto: </Text>
            {claim.subject}
          </Text>
          <Text
            selectable
            accessibilityLabel="Texto da reclamação"
            style={[styles.letter, { color: colors.text, borderColor: colors.border }]}
          >
            {claim.body}
          </Text>
          <Field
            label="Email da loja (opcional, fica guardado)"
            value={storeEmail}
            onChangeText={setStoreEmail}
            placeholder="apoio@loja.pt"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="off"
          />
          <Text style={{ color: colors.muted }}>
            O email abre com a carta escrita e o PDF em anexo (
            {purchase.invoice_filename ? 'carta e fatura' : 'carta'}).
          </Text>
          <Button
            title={busy === 'send' ? 'A preparar…' : 'Enviar por email'}
            onPress={send}
            disabled={busy !== null}
          />
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      {status && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text, marginTop: 12 }}>
          {status}
        </Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 },
  product: { fontSize: 16, fontWeight: '600' },
  action: { marginTop: 16 },
  result: { marginTop: 24, gap: 12 },
  warning: { padding: 12, borderRadius: 8, overflow: 'hidden' },
  letter: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 20 },
})
