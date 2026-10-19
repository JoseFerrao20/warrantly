import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'
import { Button, ErrorText, Field, LinkButton } from '@/lib/ui'

type Mode = 'login' | 'register' | 'forgot'

const TITLES: Record<Mode, string> = {
  login: 'Entra com a mesma conta do site.',
  register: 'Cria a tua conta.',
  forgot: 'Enviamos-te um link para escolheres uma palavra-passe nova.',
}

/**
 * Entrar, criar conta e pedir o link para repor a palavra-passe, como no site. O link do email
 * abre o site, onde se escolhe a palavra-passe nova (e a confirmação do email também).
 */
export default function LoginScreen() {
  const { notice, login, register } = useAuth()
  const colors = useColors()
  const [mode, setMode] = useState<Mode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setSent(null)
  }

  async function submit() {
    setError(null)
    if (mode === 'register' && password.length < 8) {
      return setError('A palavra-passe tem de ter pelo menos 8 caracteres.')
    }
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else if (mode === 'register') await register(email, password, fullName || null)
      else {
        setSent((await api.requestPasswordReset(email.trim().toLowerCase())).detail)
        setBusy(false)
      }
      // Com sessão, o layout mostra o painel sozinho.
    } catch (err) {
      const fallback = {
        login: 'Não foi possível entrar',
        register: 'Não foi possível criar a conta',
        forgot: 'Não foi possível enviar o link',
      }[mode]
      setError(err instanceof ApiError ? err.message : fallback)
      setBusy(false)
    }
  }

  const action = {
    login: busy ? 'A entrar…' : 'Entrar',
    register: busy ? 'A criar…' : 'Criar conta',
    forgot: busy ? 'A enviar…' : 'Enviar link',
  }[mode]

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[styles.brand, { color: colors.text }]}>
          Warrantly
        </Text>
        {notice && mode === 'login' && (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, marginBottom: 8 }}>
            {notice}
          </Text>
        )}
        <Text style={{ color: colors.muted, marginBottom: 8 }}>{TITLES[mode]}</Text>

        {sent ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, marginTop: 12 }}>
            {sent}
          </Text>
        ) : (
          <>
            {mode === 'register' && (
              <Field
                label="Nome (opcional, assina as reclamações)"
                value={fullName}
                onChangeText={setFullName}
                autoComplete="name"
                textContentType="name"
                maxLength={200}
              />
            )}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            {mode !== 'forgot' && (
              <Field
                label="Palavra-passe"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                textContentType={mode === 'register' ? 'newPassword' : 'password'}
                onSubmitEditing={submit}
              />
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <View style={{ marginTop: 20 }}>
              <Button title={action} onPress={submit} disabled={busy} />
            </View>
          </>
        )}

        <View style={styles.links}>
          {mode === 'login' ? (
            <>
              <LinkButton
                title="Ainda não tens conta? Cria uma"
                onPress={() => switchTo('register')}
              />
              <LinkButton title="Esqueci-me da palavra-passe" onPress={() => switchTo('forgot')} />
            </>
          ) : (
            <LinkButton title="Voltar a entrar" onPress={() => switchTo('login')} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  form: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  brand: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  links: { marginTop: 16 },
})
