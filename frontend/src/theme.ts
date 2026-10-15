/** Tema da interface: "system" segue o sistema operativo; "light" e "dark" forçam um. */
export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'warrantly.theme'

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Sem localStorage, o tema vale só até a página ser recarregada.
  }
  applyTheme(theme)
}
