import { useColorScheme } from 'react-native'

import type { WarrantyStatus } from '@/shared/types'

// As mesmas cores do frontend web (frontend/src/index.css), com contraste ≥ 4.5:1 nos dois temas.
const light = {
  text: '#1f2933',
  muted: '#52606d',
  subtle: '#616d7a',
  border: '#c9ced6',
  surface: '#f3f5f8',
  background: '#ffffff',
  primary: '#2563eb',
  primaryText: '#ffffff',
  link: '#2563eb', // 5.2:1 no branco
  danger: '#c81e1e',
  status: {
    active: { bg: '#e3f9f0', text: '#147d64' },
    expiring: { bg: '#fff7e6', text: '#b44d12' },
    expired: { bg: '#f3f5f8', text: '#616d7a' },
  } satisfies Record<WarrantyStatus, { bg: string; text: string }>,
}

const dark: typeof light = {
  text: '#e4e7eb',
  muted: '#b3bcc6',
  subtle: '#9aa5b1',
  border: '#3e4c59',
  surface: '#1c242d',
  background: '#11171d',
  primary: '#2563eb',
  primaryText: '#ffffff',
  link: '#7aa7ff', // o azul dos botões teria só 3.8:1 no fundo escuro
  danger: '#f87171',
  status: {
    active: { bg: '#0f3a2e', text: '#6fdcb3' },
    expiring: { bg: '#3a2a0d', text: '#f7c46c' },
    expired: { bg: '#1c242d', text: '#9aa5b1' },
  },
}

export type Colors = typeof light

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light
}
