import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, Field } from '@/lib/ui'

export default function LoginScreen() {
  const { login } = useAuth()
  const colors = useColors()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      await login(email, password) // com sessão, o layout mostra o painel sozinho
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar')
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.form}>
        <Text accessibilityRole="header" style={[styles.brand, { color: colors.text }]}>
          Warrantly
        </Text>
        <Text style={{ color: colors.muted, marginBottom: 8 }}>
          Entra com a mesma conta do site.
        </Text>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Palavra-passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
        />
        {error && <ErrorText>{error}</ErrorText>}
        <View style={{ marginTop: 20 }}>
          <Button title={busy ? 'A entrar…' : 'Entrar'} onPress={submit} disabled={busy} />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  form: { paddingHorizontal: 24 },
  brand: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
})
