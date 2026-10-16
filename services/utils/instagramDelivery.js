function instagramDeliveryResult(row) {
  if (row.status === 'published') return { success: true, result: [row.result], deliveryId: row._id, ...(row.commentWarning && { warning: row.commentWarning }) };
  if (['failed', 'uncertain', 'cancelled'].includes(row.status)) return { success: false, error: row.error || 'Instagram delivery failed', uncertain: row.status === 'uncertain', retryable: false, deliveryId: row._id };
  return { success: false, processing: true, retryable: true, deliveryId: row._id, status: row.status };
}
module.exports = { instagramDeliveryResult };
