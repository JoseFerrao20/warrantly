import type { WarrantyStatus } from '../types'
import { elapsedFraction } from '../warranty'

export function WarrantyBar({
  purchaseDate,
  warrantyEnd,
  status,
  today,
}: {
  purchaseDate: string
  warrantyEnd: string
  status: WarrantyStatus
  today: string
}) {
  const elapsed = elapsedFraction(purchaseDate, warrantyEnd, today)
  const percent = Math.round(elapsed * 100)
  return (
    <div
      className="bar"
      role="progressbar"
      aria-label="Tempo de garantia já passado"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {status !== 'expired' && (
        <div className={`bar-fill bar-${status}`} style={{ width: `${Math.max(percent, 2)}%` }} />
      )}
    </div>
  )
}
