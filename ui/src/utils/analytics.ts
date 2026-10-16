export function auditErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown; detail?: unknown } } })?.response?.data
  if (typeof data?.error !== 'string' || !data.error.trim()) return fallback
  const detail = typeof data.detail === 'string' ? data.detail.trim() : ''
  return detail ? `${data.error}: ${detail}` : data.error
}
