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
export function isLocalApiBaseUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
  } catch {
    return false
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const base = await getApiBaseUrl()
  return apiAtBaseUrl<T>(base, path, options)
}
export async function apiAtBaseUrl<T = any>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}${path}`, { ...options, headers })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }
  return response.json()
}
export type AIStreamEvent = {
  type: string
  text?: string
  provider?: string
  model?: string
  details?: string
  conversation_id?: number
  sources?: { filename: string; chunk: number }[]
}
export async function streamApi(
  path: string,
  body: unknown,
  onEvent: (event: AIStreamEvent) => void,
  baseOverride?: string,
): Promise<void> {
  const base = baseOverride || await getApiBaseUrl()
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    redirect: 'error',
  })
  if (!response.ok) {
    const raw = await response.text()
    let message = raw || `Request failed: ${response.status}`
    try { message = JSON.parse(raw)?.detail || message } catch { /* use response text */ }
    throw new Error(message)
  }
  if (!response.body) throw new Error('The server did not start a streaming response.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const dispatch = (line: string) => {
    if (!line.startsWith('data:')) return
    const event = JSON.parse(line.slice(5).trim()) as AIStreamEvent
    if (event.type === 'error') throw new Error(event.details || 'AI generation failed.')
    onEvent(event)
  }
  while (true) {
    const { value, done } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) dispatch(line)
    if (done) {
      if (pending) dispatch(pending)
      break
    }
  }
}
export const API = DEFAULT_API
