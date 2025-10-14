import axios from 'axios'

export const apiClient = axios.create({
  baseURL: '/',
  timeout: 15000,
  withCredentials: true
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('API request failed', error)
    }
    return Promise.reject(error)
  }
)

export interface ApiError {
  message: string
  code?: string
  status?: number
}

export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const message =
      (error.response?.data as { error?: string })?.error ||
      error.message ||
      '请求失败，请稍后再试'
    return {
      message,
      status,
      code: String(status ?? 'unknown')
    }
  }
  return {
    message: error instanceof Error ? error.message : '请求失败，请稍后再试'
  }
}
