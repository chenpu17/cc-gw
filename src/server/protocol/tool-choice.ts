export type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } }

export function convertAnthropicToolChoiceToOpenAI(toolChoice: any): OpenAIToolChoice | undefined {
  if (toolChoice == null) return undefined

  if (typeof toolChoice === 'string') {
    const normalized = toolChoice.trim().toLowerCase()
    if (normalized === 'auto') return 'auto'
    if (normalized === 'none') return 'none'
    if (normalized === 'required' || normalized === 'any') return 'auto'
    return undefined
  }

  if (typeof toolChoice !== 'object') {
    return undefined
  }

  const typeRaw = (toolChoice as any).type
  const type = typeof typeRaw === 'string' ? typeRaw.trim().toLowerCase() : ''
  if (type === 'auto') return 'auto'
  if (type === 'none') return 'none'
  if (type === 'required' || type === 'any') return 'auto'

  if (type === 'tool') {
    const nameRaw = (toolChoice as any).name
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : ''
    if (!name) return undefined
    return { type: 'function', function: { name } }
  }

  return undefined
}

