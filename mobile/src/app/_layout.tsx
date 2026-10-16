import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'

import { AuthProvider, useAuth } from '@/lib/auth'
import { useColors } from '@/lib/theme'

function Navigation() {
  const { user } = useAuth()
  const colors = useColors()

  if (user === undefined) {
    // A ler o token guardado: um instante, antes de decidir entre o login e o painel.
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator accessibilityLabel="A carregar" />
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerBackTitle: 'Voltar',
      }}
    >
      <Stack.Protected guard={user !== null}>
        <Stack.Screen name="index" options={{ title: 'As tuas garantias' }} />
        <Stack.Screen name="compras/nova" options={{ title: 'Nova compra' }} />
        <Stack.Screen name="compras/[id]" options={{ title: 'Compra' }} />
      </Stack.Protected>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="entrar" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Navigation />
    </AuthProvider>
  )
}
