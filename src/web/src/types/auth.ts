export interface AuthSessionResponse {
  authEnabled: boolean
  authenticated: boolean
  username?: string
}

export interface AuthLoginResponse {
  success: boolean
  authEnabled?: boolean
}

export interface AuthLogoutResponse {
  success: boolean
}
