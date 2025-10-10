export type QueryValue = string | number | boolean | null | undefined

export function appendQuery(
  url: string,
  query: string | Record<string, QueryValue | QueryValue[]> | null | undefined
): string {
  if (!query) return url

  const baseHasQuery = url.includes('?')

  if (typeof query === 'string') {
    const normalized = query.startsWith('?') ? query.slice(1) : query
    if (!normalized) {
      return baseHasQuery ? url : `${url}?`
    }
    return baseHasQuery ? `${url}&${normalized}` : `${url}?${normalized}`
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null) continue
        params.append(key, String(item))
      }
    } else {
      params.append(key, String(value))
    }
  }

  const serialized = params.toString()
  if (!serialized) {
    return baseHasQuery ? url : `${url}?`
  }

  return baseHasQuery ? `${url}&${serialized}` : `${url}?${serialized}`
}
