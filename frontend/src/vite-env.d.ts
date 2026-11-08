/// <reference types="vite/client" />
interface Window {
  novaDesktop?: {
    platform: string
    desktop: boolean
    getApiUrl: () => Promise<string>
    setApiUrl: (url: string) => Promise<string>
    chooseProject: () => Promise<{ id: string; name: string; files: string[] } | null>
    refreshProject: (projectId: string) => Promise<{ id: string; name: string; files: string[] }>
    readProjectFiles: (projectId: string, paths: string[]) => Promise<ProjectFile[]>
    searchProjectFiles: (projectId: string, files: string[], query: string) => Promise<{ path: string; score: number; snippet: string }[]>
    retrieveProjectContext: (projectId: string, files: string[], query: string, selectedPaths: string[]) => Promise<ProjectFile[]>
    applyProjectChange: (projectId: string, change: { path: string; originalContent: string; proposedContent: string }, approved: boolean) => Promise<{ applied: boolean; path?: string; backupPath?: string }>
    listProjectTests: (projectId: string) => Promise<{ id: string; label: string }[]>
    runProjectTest: (projectId: string, commandId: string, approved: boolean) => Promise<{ approved: boolean; command?: string; exitCode?: number | null; output: string }>
    sanitizeProjectText: (projectId: string, text: string) => Promise<string>
  }
}

type ProjectFile = { path: string; content: string; containsSensitiveData?: boolean; truncated?: boolean }
