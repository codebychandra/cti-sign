import type { RecordStatus } from '../lib/types'

const styles: Record<RecordStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-cti-blue',
  viewed: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-cti-red',
}

const labels: Record<RecordStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  completed: 'Completed',
  declined: 'Declined',
}

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <span className={`badge ${styles[status]}`}>{labels[status]}</span>
}
