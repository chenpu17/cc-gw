import axios from 'axios'
import type {
  CustomEndpointsResponse,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  EndpointResponse
} from '@/types/endpoints'
import type { EventsResponse } from '@/types/events'

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

// Custom Endpoints API
export const customEndpointsApi = {
  list: async (): Promise<CustomEndpointsResponse> => {
    const response = await apiClient.get<CustomEndpointsResponse>('/api/custom-endpoints')
    return response.data
  },

  create: async (data: CreateEndpointRequest): Promise<EndpointResponse> => {
    const response = await apiClient.post<EndpointResponse>('/api/custom-endpoints', data)
    return response.data
  },

  update: async (id: string, data: UpdateEndpointRequest): Promise<EndpointResponse> => {
    const response = await apiClient.put<EndpointResponse>(`/api/custom-endpoints/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<{ success: boolean }>(`/api/custom-endpoints/${id}`)
    return response.data
  }
}

export const eventsApi = {
  list: async (params?: { limit?: number; cursor?: number; level?: string; type?: string }): Promise<EventsResponse> => {
    const response = await apiClient.get<EventsResponse>('/api/events', {
      params: {
        limit: params?.limit,
        cursor: params?.cursor,
        level: params?.level,
        type: params?.type
      }
    })
    return response.data
  }
}
