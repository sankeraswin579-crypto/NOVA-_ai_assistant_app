/// <reference types="vite/client" />
interface Window {
  novaDesktop?: {
    platform: string
    desktop: boolean
    getApiUrl: () => Promise<string>
    setApiUrl: (url: string) => Promise<string>
  }
}
