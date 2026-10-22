import { CameraView, useCameraPermissions } from 'expo-camera'
import type { BarcodeScanningResult } from 'expo-camera'
import { useRef, useState } from 'react'
import { Linking, Modal, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { api, ApiError } from './api'
import { useColors } from './theme'
import { Button } from './ui'
import type { InvoiceScan } from '@/shared/types'

// O QR das faturas (Portaria 195/2020) começa sempre pelo NIF do emitente: "A:123456789*…".
const AT_QR = /^A:\d{9}\*/

const NOT_AN_INVOICE =
  'Encontrei um código QR, mas não é de uma fatura. Procura o QR da AT, perto do total.'

/**
 * Lê o código QR da fatura com a câmara, num ecrã por cima do formulário. A leitura é
 * automática: o texto do QR vai para a API (que o valida com o faturapt) e, se for de uma
 * fatura, `onScanned` recebe as sugestões. Um QR de outra coisa só dá um aviso, e a câmara
 * continua à procura.
 */
export function InvoiceQRScanner({
  onScanned,
  onClose,
}: {
  onScanned: (scan: InvoiceScan) => void
  onClose: () => void
}) {
  const colors = useColors()
  const [permission, requestPermission] = useCameraPermissions()
  const [note, setNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // A câmara vê o mesmo QR muitas vezes por segundo: cada texto só é verificado uma vez.
  const seen = useRef<string | null>(null)
  const busy = useRef(false)

  async function handleCode({ data }: BarcodeScanningResult) {
    if (busy.current || data === seen.current) return
    seen.current = data
    if (!AT_QR.test(data)) return setNote(NOT_AN_INVOICE)
    busy.current = true
    setChecking(true)
    try {
      onScanned(await api.scanQr(data))
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setNote(NOT_AN_INVOICE)
      } else {
        seen.current = null // falha de rede: o mesmo QR pode ser lido outra vez
        setNote(err instanceof ApiError ? err.message : 'Não foi possível ler o código QR')
      }
    } finally {
      busy.current = false
      setChecking(false)
    }
  }

  let body
  if (!permission) {
    body = null // a perguntar ao sistema se já há autorização
  } else if (!permission.granted) {
    body = (
      <View style={styles.permission}>
        <Text style={[styles.text, { color: colors.text }]}>
          Para ler o código QR da fatura, o Warrantly precisa de acesso à câmara.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Autorizar a câmara" onPress={requestPermission} />
        ) : (
          <Button title="Abrir as definições" onPress={() => Linking.openSettings()} />
        )}
      </View>
    )
  } else {
    body = (
      <CameraView
        testID="qr-camera"
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={checking ? undefined : handleCode}
        accessibilityLabel="Imagem da câmara"
      />
    )
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          Ler o código QR
        </Text>
        <Text style={{ color: colors.muted }}>
          Aponta ao código QR da fatura (o quadrado perto do total). A leitura é automática.
        </Text>
        <View style={styles.body}>{body}</View>
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.text }]}>
          {checking ? 'A verificar o código…' : (note ?? '')}
        </Text>
        <Button title="Cancelar" variant="secondary" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { flex: 1, justifyContent: 'center' },
  camera: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  permission: { gap: 16 },
  text: { fontSize: 16 },
})
