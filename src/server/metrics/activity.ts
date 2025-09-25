let activeRequests = 0

export function incrementActiveRequests(): void {
  activeRequests += 1
}

export function decrementActiveRequests(): void {
  if (activeRequests > 0) {
    activeRequests -= 1
  }
}

export function getActiveRequestCount(): number {
  return activeRequests
}
