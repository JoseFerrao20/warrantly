// Datas no formato AAAA-MM-DD, tratadas em UTC para não haver saltos de fuso horário.

const DAY_MS = 24 * 60 * 60 * 1000
export const EXPIRING_SOON_DAYS = 60

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function todayISO(now: Date = new Date()): string {
  const local = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  return format(local)
}

/** Soma meses como o Postgres: 31/01 + 1 mês = 28/02 (ou 29 em ano bissexto). */
export function addMonths(date: string, months: number): string {
  const start = parse(date)
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay))
  return format(target)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS)
}

function monthsBetween(from: string, to: string): number {
  const a = parse(from)
  const b = parse(to)
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()
  if (b.getUTCDate() < a.getUTCDate()) months -= 1
  return months
}

/** Texto curto do tempo que falta, como no painel: "expira em 21 d", "2 anos, 4 m", "expirada". */
export function remainingLabel(warrantyEnd: string, today: string): string {
  const days = daysBetween(today, warrantyEnd)
  if (days < 0) return 'expirada'
  if (days === 0) return 'expira hoje'
  if (days <= EXPIRING_SOON_DAYS) return `expira em ${days} d`
  const months = monthsBetween(today, warrantyEnd)
  const years = Math.floor(months / 12)
  const rest = months % 12
  const parts = []
  if (years > 0) parts.push(years === 1 ? '1 ano' : `${years} anos`)
  if (rest > 0 || years === 0) parts.push(`${rest} m`)
  return parts.join(', ')
}

/** Fração do prazo de garantia que já passou (0 a 1), para a barra do painel. */
export function elapsedFraction(purchaseDate: string, warrantyEnd: string, today: string): number {
  const total = daysBetween(purchaseDate, warrantyEnd)
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, daysBetween(purchaseDate, today) / total))
}

const dateFormat = new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC' })
const longDateFormat = new Intl.DateTimeFormat('pt-PT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const priceFormat = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })

export const formatDate = (date: string) => dateFormat.format(parse(date))
export const formatLongDate = (date: string) => longDateFormat.format(parse(date))
export const formatPrice = (price: string | number) => priceFormat.format(Number(price))

/** Aceita "749,99" ou "749.99"; devolve "749.99", ou null se não for um preço válido. */
export function parsePrice(text: string): string | null {
  const normalized = text.trim().replace(/\s|€/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return normalized
}

export function formatMonths(months: number): string {
  if (months % 12 === 0) return months === 12 ? '1 ano' : `${months / 12} anos`
  return `${months} meses`
}
