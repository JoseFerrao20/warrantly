import { useState } from 'react'
import { Alert, StyleSheet, Text } from 'react-native'

import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, Field } from '@/lib/ui'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** O nome da conta, que assina as reclamações. */
export function ProfileSection() {
  const colors = useColors()
  const { user, updateName } = useAuth()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await updateName(fullName)
      setSaved(true)
    } catch (err) {
      setError(message(err, 'Não foi possível guardar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Text style={[styles.email, { color: colors.text }]}>{user?.email}</Text>
      <Field
        label="Nome (assina as reclamações)"
        value={fullName}
        onChangeText={(value) => {
          setFullName(value)
          setSaved(false)
        }}
        autoComplete="name"
        textContentType="name"
        maxLength={200}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {saved && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          Guardado.
        </Text>
      )}
      <Button title="Guardar nome" variant="secondary" disabled={busy} onPress={save} />
    </>
  )
}

/**
 * Apagar a conta, as compras, as faturas e os alertas (pede a palavra-passe), como no site.
 * Uma app que deixa criar conta tem de deixar apagá-la: é uma regra da App Store.
 */
export function DeleteAccountSection() {
  const colors = useColors()
  const { deleteAccount } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function confirm() {
    if (!password) return setError('Escreve a tua palavra-passe para confirmar.')
    setError(null)
    Alert.alert(
      'Apagar a conta?',
      'As compras, as faturas e os alertas são apagados. Não dá para desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Apagar conta', style: 'destructive', onPress: () => void remove() },
      ],
    )
  }

  async function remove() {
    setBusy(true)
    try {
      // Sem sessão, a app volta ao ecrã de entrada, com "A tua conta foi apagada."
      await deleteAccount(password)
    } catch (err) {
      setError(message(err, 'Não foi possível apagar a conta'))
      setBusy(false)
    }
  }

  return (
    <>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        Apagar conta
      </Text>
      <Text style={{ color: colors.muted }}>
        Apaga a conta, todas as compras, as faturas guardadas e os alertas. Se quiseres guardar
        uma cópia, exporta os dados antes.
      </Text>
      <Field
        label="Palavra-passe (para confirmar)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Button
        title={busy ? 'A apagar…' : 'Apagar conta'}
        variant="secondary"
        disabled={busy}
        onPress={confirm}
      />
    </>
  )
}

const styles = StyleSheet.create({
  email: { fontSize: 16 },
  title: { fontSize: 20, fontWeight: '600', marginTop: 8 },
})
