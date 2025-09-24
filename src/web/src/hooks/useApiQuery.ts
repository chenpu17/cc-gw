import { keepPreviousData, useQuery, UseQueryOptions, UseQueryResult } from '@tanstack/react-query'
import { AxiosRequestConfig } from 'axios'
import { apiClient, toApiError } from '@/services/api'

export function useApiQuery<TData = unknown, TError = Error>(
  key: readonly unknown[],
  request: AxiosRequestConfig,
  options?: Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'>
): UseQueryResult<TData, TError> {
  return useQuery({
    queryKey: key,
    placeholderData: keepPreviousData,
    ...options,
    queryFn: async () => {
      try {
        const response = await apiClient.request<TData>(request)
        return response.data
      } catch (error) {
        throw (toApiError(error) as unknown as TError)
      }
    }
  })
}
