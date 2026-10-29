const DEFAULT_API = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '')
let configuredApi: string | null = null
export async function getApiBaseUrl(): Promise<string> {
  if (configuredApi) return configuredApi
  if (window.novaDesktop?.getApiUrl) {
    try { configuredApi = (await window.novaDesktop.getApiUrl()).replace(/\/$/, '') } catch { /* use web default */ }
  }
  return configuredApi || DEFAULT_API
}
export async function setApiBaseUrl(url: string): Promise<string> {
  const clean = url.trim().replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(clean) } catch { throw new Error('Enter a complete API URL, such as https://api.example.com') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('API URL must start with http:// or https://')
  return clean
}
export async function persistApiBaseUrl(url: string): Promise<string> {
  const clean = await setApiBaseUrl(url)
  if (window.novaDesktop?.setApiUrl) configuredApi = await window.novaDesktop.setApiUrl(clean)
  else configuredApi = clean
  return configuredApi
}
export async function testApiBaseUrl(url: string): Promise<string> {
  const candidate = await setApiBaseUrl(url)
  const response = await fetch(`${candidate}/api/health`, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`API health check failed (${response.status}). Check the server URL.`)
  const health = await response.json()
  if (health?.status !== 'ok') throw new Error('This server did not identify itself as a Nova API.')
  return candidate
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const base = await getApiBaseUrl()
  const response = await fetch(`${base}${path}`, { ...options, headers })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }
  return response.json()
}
export const API = DEFAULT_API
