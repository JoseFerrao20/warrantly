import type { WarrantyStatus } from '../types'
import { remainingLabel } from '../warranty'

export function StatusBadge({
  status,
  warrantyEnd,
  today,
}: {
  status: WarrantyStatus
  warrantyEnd: string
  today: string
}) {
  return <span className={`badge badge-${status}`}>{remainingLabel(warrantyEnd, today)}</span>
}
