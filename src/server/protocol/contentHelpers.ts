export function stringifyToolContent(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function mergeText(base: string | undefined, extras: string[]): string {
  const parts: string[] = []
  if (base && base.trim().length > 0) {
    parts.push(base)
  }
  for (const part of extras) {
    if (part && part.trim().length > 0) {
      parts.push(part)
    }
  }
  return parts.join('\n\n')
}
