/**
 * Copy text to clipboard with fallback for non-secure contexts.
 * navigator.clipboard.writeText requires HTTPS or localhost.
 * Falls back to execCommand('copy') for HTTP environments.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Try modern Clipboard API first (requires secure context)
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to legacy method
    }
  }

  // Fallback: use execCommand with a temporary textarea
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Prevent scrolling to bottom
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.width = '2em'
  textarea.style.height = '2em'
  textarea.style.padding = '0'
  textarea.style.border = 'none'
  textarea.style.outline = 'none'
  textarea.style.boxShadow = 'none'
  textarea.style.background = 'transparent'
  textarea.setAttribute('readonly', '')

  document.body.appendChild(textarea)
  textarea.select()

  try {
    const success = document.execCommand('copy')
    if (!success) {
      throw new Error('execCommand copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}
