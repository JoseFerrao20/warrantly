import { describe, expect, it } from 'vitest'

import {
  addMonths,
  elapsedFraction,
  formatLongDate,
  formatMonths,
  formatPrice,
  parsePrice,
  remainingLabel,
} from './warranty'

describe('addMonths (igual ao Postgres)', () => {
  it.each([
    ['2026-10-14', 36, '2029-10-14'],
    ['2024-02-29', 36, '2027-02-28'],
    ['2025-01-31', 1, '2025-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2026-11-30', 3, '2027-02-28'],
  ])('%s + %i meses = %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected)
  })
})

describe('remainingLabel', () => {
  const today = '2026-10-14'
  it.each([
    ['2026-10-13', 'expirada'],
    ['2026-10-14', 'expira hoje'],
    ['2026-11-04', 'expira em 21 d'],
    ['2026-12-13', 'expira em 60 d'],
    ['2027-12-14', '1 ano, 2 m'],
    ['2029-02-14', '2 anos, 4 m'],
    ['2029-10-14', '3 anos'],
    ['2027-03-01', '4 m'],
  ])('fim a %s → "%s"', (end, expected) => {
    expect(remainingLabel(end, today)).toBe(expected)
  })
})

describe('elapsedFraction', () => {
  it('vai de 0 a 1 ao longo da garantia', () => {
    expect(elapsedFraction('2026-01-01', '2027-01-01', '2026-01-01')).toBe(0)
    expect(elapsedFraction('2026-01-01', '2027-01-01', '2026-07-02')).toBeCloseTo(0.5, 2)
    expect(elapsedFraction('2026-01-01', '2027-01-01', '2028-01-01')).toBe(1)
  })
})

describe('parsePrice', () => {
  it.each([
    ['749,99', '749.99'],
    ['749.99', '749.99'],
    [' 12 € ', '12'],
    ['0,5', '0.5'],
  ])('"%s" → %s', (text, expected) => {
    expect(parsePrice(text)).toBe(expected)
  })

  it.each(['', 'abc', '-1', '1,999', '1.2.3'])('rejeita "%s"', (text) => {
    expect(parsePrice(text)).toBeNull()
  })
})

describe('formatação em português', () => {
  it('formata preço, data longa e duração', () => {
    expect(formatPrice('749.99')).toMatch(/^749,99\s€$/)
    expect(formatLongDate('2029-02-14')).toBe('14 de fevereiro de 2029')
    expect(formatMonths(36)).toBe('3 anos')
    expect(formatMonths(12)).toBe('1 ano')
    expect(formatMonths(18)).toBe('18 meses')
  })
})
