// Triggers a browser download of `blob` as `filename` - the shared last step of every "export a
// file" action (dome config, edges info, STEP archive, ...).
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Triggers a browser download of `data` as pretty-printed JSON - shared by every "export as
// JSON" action (dome config, edges info, ...) so they all produce files the same way.
export function downloadJson(data: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}
