import { Pressable, StyleSheet, Text, TextInput } from 'react-native'
import type { PressableProps, TextInputProps } from 'react-native'

import { useColors } from './theme'
import { remainingLabel } from '@/shared/warranty'
import type { WarrantyStatus } from '@/shared/types'

export function Button({
  title,
  variant = 'primary',
  ...props
}: PressableProps & { title: string; variant?: 'primary' | 'secondary' }) {
  const colors = useColors()
  const primary = variant === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.primary : 'transparent',
          borderColor: primary ? colors.primary : colors.border,
          opacity: props.disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
      {...props}
    >
      <Text style={[styles.buttonText, { color: primary ? colors.primaryText : colors.text }]}>
        {title}
      </Text>
    </Pressable>
  )
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useColors()
  return (
    <>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.subtle}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
        ]}
        {...props}
      />
    </>
  )
}

export function StatusBadge({
  status,
  warrantyEnd,
  today,
}: {
  status: WarrantyStatus
  warrantyEnd: string
  today: string
}) {
  const { bg, text } = useColors().status[status]
  return (
    <Text style={[styles.badge, { backgroundColor: bg, color: text }]}>
      {remainingLabel(warrantyEnd, today)}
    </Text>
  )
}

export function ErrorText({ children }: { children: string }) {
  const colors = useColors()
  return (
    <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48, // alvo de toque confortável
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 14, marginTop: 12, marginBottom: 4 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
    fontSize: 13,
  },
  error: { marginTop: 12, fontSize: 15 },
})
