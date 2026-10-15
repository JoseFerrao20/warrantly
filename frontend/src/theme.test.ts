import { afterEach, describe, expect, it } from 'vitest'

import { getTheme, setTheme } from './theme'

afterEach(() => document.documentElement.removeAttribute('data-theme'))

describe('tema', () => {
  it('por omissão segue o sistema', () => {
    expect(getTheme()).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('guarda e aplica o tema escolhido', () => {
    setTheme('dark')
    expect(getTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    setTheme('system')
    expect(getTheme()).toBe('system')
    expect(localStorage.getItem('warrantly.theme')).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('ignora valores desconhecidos guardados', () => {
    localStorage.setItem('warrantly.theme', 'roxo')
    expect(getTheme()).toBe('system')
  })
})
