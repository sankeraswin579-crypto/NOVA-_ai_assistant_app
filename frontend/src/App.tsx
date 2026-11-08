import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUp, Bot, Check, ChevronDown, Copy, FileText, FolderOpen, Globe2, MessageSquare, Plus, Save, Search, Send, Settings2, Sparkles, Trash2, Wifi, WifiOff, X, Zap, Play, WandSparkles, Users } from 'lucide-react'
import { api, getApiBaseUrl, isLocalApiBaseUrl, persistApiBaseUrl, streamApi, testApiBaseUrl } from './api'
import ProjectWorkspace from './ProjectWorkspace'
import AgentCommandCenter from './AgentCommandCenter'

type Note = { id: number; title: string; content: string; updated_at: string }
type Conversation = { id: number; title: string; created_at: string; messages?: { role: string; content: string }[] }
type Message = { role: 'user' | 'assistant'; content: string }
type ProjectSelection = { id: string; name: string; files: string[] }
type AutoBot = { id: string; name: string; role: string; description: string; color: string }
type AIProvider = 'ollama' | 'gemini' | 'openai' | 'groq'
type AIMode = 'local-only' | 'local-first' | 'cloud-first'
type ProviderInfo = { provider: AIProvider; model: string; configured: boolean; local: boolean }
const defaultBots: AutoBot[] = [
  { id: 'researcher', name: 'Researcher', role: 'Careful research assistant', description: 'Break down a question, surface key considerations, and distinguish facts from assumptions.', color: 'cyan' },
  { id: 'writer', name: 'Writer', role: 'Clear, thoughtful editor', description: 'Draft and refine writing for a specific audience, tone, and purpose.', color: 'violet' },
  { id: 'planner', name: 'Project planner', role: 'Practical project planner', description: 'Turn goals into actionable steps, milestones, dependencies, and risks.', color: 'mint' },
]

const starterPrompts = [
  { icon: '✦', title: 'Plan a project', text: 'Help me plan a small project with milestones and risks.' },
  { icon: '⌘', title: 'Explain a concept', text: 'Explain how Retrieval-Augmented Generation works in simple terms.' },
  { icon: '↗', title: 'Write something', text: 'Help me draft a clear, professional project description.' },
]

export default function App() {
  const [view, setView] = useState<'chat' | 'notes' | 'documents' | 'autobots' | 'project' | 'agents'>('chat')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [editingNote, setEditingNote] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(false)
  const [toast, setToast] = useState('')
  const [docName, setDocName] = useState('')
  const [docContent, setDocContent] = useState('')
  const [documents, setDocuments] = useState<{id:number;filename:string;content:string;indexed?:boolean}[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:8765')
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [checkingAI, setCheckingAI] = useState(false)
  const [bots, setBots] = useState<AutoBot[]>(defaultBots)
  const [selectedBot, setSelectedBot] = useState('researcher')
  const [botTask, setBotTask] = useState('')
  const [botBusy, setBotBusy] = useState(false)
  const [botResult, setBotResult] = useState('')
  const [botName, setBotName] = useState('')
  const [botRole, setBotRole] = useState('')
  const [botDescription, setBotDescription] = useState('')
  const [projectSelection, setProjectSelection] = useState<ProjectSelection | null>(null)
  const [selectedProjectPaths, setSelectedProjectPaths] = useState<string[]>([])
  const [projectContext, setProjectContext] = useState<{ name: string; paths: string[] } | null>(null)
  const [aiMode, setAiMode] = useState<AIMode>(() => {
    const saved = localStorage.getItem('nova-ai-mode')
    return saved === 'local-first' || saved === 'cloud-first' ? saved : 'local-only'
  })
  const [aiProvider, setAiProvider] = useState<AIProvider | 'automatic'>(() => {
    const saved = localStorage.getItem('nova-ai-provider')
    return saved === 'ollama' || saved === 'gemini' || saved === 'openai' || saved === 'groq'
      ? saved
      : 'automatic'
  })
  const [aiModel, setAiModel] = useState(() => localStorage.getItem('nova-ai-model') || '')
  const [aiProviders, setAiProviders] = useState<ProviderInfo[]>([])
  const [aiConnection, setAiConnection] = useState('')
  const [aiOnline, setAiOnline] = useState<boolean | null>(null)
  const [activeAI, setActiveAI] = useState('')
  const [writerAction, setWriterAction] = useState<'generate' | 'rewrite' | 'grammar' | 'summarize' | 'expand' | 'tone' | 'document-qa'>('generate')
  const [writerTone, setWriterTone] = useState('professional')
  const [writerDocumentIds, setWriterDocumentIds] = useState<number[]>([])
  const [writerSources, setWriterSources] = useState<{ filename: string; chunk: number }[]>([])

  useEffect(() => { void getApiBaseUrl().then(setApiUrl) }, [])
  useEffect(() => {
    void api<{ default_mode: AIMode; providers: ProviderInfo[] }>('/api/ai/providers').then(config => {
      setAiProviders(config.providers)
      setAiModel(current => current || config.providers.find(item => item.provider === 'ollama')?.model || '')
      if (!localStorage.getItem('nova-ai-mode')) setAiMode(config.default_mode)
    }).catch(() => setAiProviders([]))
  }, [])
  useEffect(() => { localStorage.setItem('nova-ai-mode', aiMode) }, [aiMode])
  useEffect(() => { localStorage.setItem('nova-ai-provider', aiProvider) }, [aiProvider])
  useEffect(() => { localStorage.setItem('nova-ai-model', aiModel) }, [aiModel])
  useEffect(() => {
    try { const stored = localStorage.getItem('nova-autobots'); if (stored) setBots(JSON.parse(stored)) } catch { /* use starter bots */ }
  }, [])
  function saveBots(next: AutoBot[]) { setBots(next); localStorage.setItem('nova-autobots', JSON.stringify(next)) }

  const refresh = async () => {
    try {
      const [cs, ns, ds] = await Promise.all([
        api<Conversation[]>('/api/conversations'), api<Note[]>('/api/notes'), api<any[]>('/api/documents')
      ])
      setConversations(cs); setNotes(ns); setDocuments(ds); setOnline(true)
    } catch { setOnline(false) }
  }
  useEffect(() => { void refresh() }, [])
  const filteredNotes = useMemo(() => notes.filter(n => (n.title + ' ' + n.content).toLowerCase().includes(search.toLowerCase())), [notes, search])
  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2400) }
  function changeAIProvider(value: string) {
    if (value !== 'automatic' && value !== 'ollama' && value !== 'gemini' && value !== 'openai' && value !== 'groq') return
    setAiProvider(value)
    if (value !== 'automatic') {
      setAiModel(aiProviders.find(item => item.provider === value)?.model || '')
    }
  }

  async function sendMessage(text = input) {
    const value = text.trim()
    if (!value || busy) return
    let projectApiBase: string | null = null
    if (projectContext) {
      projectApiBase = await getApiBaseUrl()
      if (!isLocalApiBaseUrl(projectApiBase) || !projectSelection || !window.novaDesktop?.retrieveProjectContext) {
        notify('Project context is only sent to a local Nova API. Change the API URL in Settings to use it.')
        return
      }
    }
    setInput(''); setBusy(true)
    setAiConnection('')
    setMessages(prev => [...prev, { role: 'user', content: value }, { role: 'assistant', content: '' }])
    try {
      const projectFiles = projectContext && window.novaDesktop
        ? await window.novaDesktop.retrieveProjectContext(projectSelection!.id, projectSelection!.files, value, projectContext.paths)
        : []
      await streamApi('/api/chat/stream', {
        message: value,
        conversation_id: conversationId,
        project_name: projectContext?.name,
        project_files: projectFiles.map(({ path, content }) => ({ path, content })),
        mode: projectFiles.length ? 'local-only' : aiMode,
        provider: projectFiles.length ? 'ollama' : aiProvider === 'automatic' ? null : aiProvider,
        model: projectFiles.length || aiProvider === 'automatic' ? null : aiModel || null,
      }, event => {
        if (event.type === 'conversation' && event.conversation_id) setConversationId(event.conversation_id)
        if (event.type === 'meta') setActiveAI(`${event.provider}:${event.model}`)
        if (event.type === 'token') {
          setAiOnline(true)
          setMessages(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + (event.text || '') }
            return next
          })
        }
        if (event.type === 'reset') {
          setMessages(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: '' }
            return next
          })
        }
        if (event.type === 'fallback' && event.details) setAiConnection(`Fallback: ${event.details}`)
      }, projectApiBase || undefined)
      await refresh()
    } catch (e) {
      setAiOnline(false)
      setAiConnection(e instanceof Error ? e.message : 'AI generation failed')
      setMessages(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        const errorText = `Nova couldn't generate a response.\n\n${e instanceof Error ? e.message : 'Unknown error'}`
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: errorText }
        else next.push({ role: 'assistant', content: errorText })
        return next
      })
    } finally { setBusy(false) }
  }
  async function openConversation(id: number) {
    try {
      const c = await api<Conversation>(`/api/conversations/${id}`)
      setConversationId(id)
      setMessages((c.messages || []).map(m => ({ role: m.role as Message['role'], content: m.content })))
      setView('chat')
    } catch { notify('Could not open conversation') }
  }
  function newChat() { setConversationId(null); setMessages([]); setInput(''); setView('chat') }

  async function chooseProject() {
    if (!window.novaDesktop?.chooseProject) { notify('Project context is available in the desktop app'); return }
    try {
      const selection = await window.novaDesktop.chooseProject()
      if (!selection) return
      setProjectSelection(selection)
      setSelectedProjectPaths([])
      setProjectContext(null)
      setView('project')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not scan this project folder')
    }
  }

  function attachProject() {
    if (!selectedProjectPaths.length || !projectSelection) { notify('Select at least one project file'); return }
    setProjectContext({ name: projectSelection.name, paths: selectedProjectPaths })
    setView('chat')
    notify(`${selectedProjectPaths.length} project files ready for relevant retrieval`)
  }

  async function refreshProject() {
    if (!window.novaDesktop?.refreshProject) return
    if (!projectSelection) return
    try {
      const refreshed = await window.novaDesktop.refreshProject(projectSelection.id)
      setProjectSelection(refreshed)
      setSelectedProjectPaths(current=>current.filter(path=>refreshed.files.includes(path)))
    } catch (e) {
      notify(e instanceof Error?e.message:'Could not refresh the project tree')
    }
  }

  function toggleProjectPath(path: string) {
    setSelectedProjectPaths(current => current.includes(path)
      ? current.filter(item => item !== path)
      : current.length < 8 ? [...current, path] : current)
  }

  async function checkConnection() {
    setCheckingConnection(true)
    try {
      const candidate = await testApiBaseUrl(apiUrl)
      setApiUrl(candidate)
      setOnline(true)
      notify('Nova API connection successful')
    } catch (e) { setOnline(false); notify(e instanceof Error ? e.message : 'Could not reach this API URL') }
    finally { setCheckingConnection(false) }
  }

  async function saveConnection() {
    setCheckingConnection(true)
    try {
      // Validate the candidate before replacing the currently working server URL.
      const savedUrl = await testApiBaseUrl(apiUrl)
      await persistApiBaseUrl(savedUrl)
      setApiUrl(savedUrl)
      setOnline(true)
      await refresh()
      notify('API URL saved')
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save API URL') }
    finally { setCheckingConnection(false) }
  }

  async function testAIConnection() {
    setCheckingAI(true)
    try {
      const preferred: AIProvider[] = aiProvider === 'automatic'
        ? aiMode === 'cloud-first' ? ['openai', 'gemini', 'groq', 'ollama'] : ['ollama', 'openai', 'gemini', 'groq']
        : [aiProvider]
      const target = preferred.find(provider => aiProviders.some(item => item.provider === provider && item.configured))
      if (!target) throw new Error('No provider is configured for the current routing mode.')
      const result = await api<{ available: boolean; message: string }>(`/api/ai/providers/${target}/health`)
      setAiOnline(result.available)
      setAiConnection(result.message)
      if (!result.available) throw new Error(result.message)
      notify(`${target} connection successful`)
    } catch (e) {
      setAiOnline(false)
      setAiConnection(e instanceof Error ? e.message : 'AI connection failed')
      notify(e instanceof Error ? e.message : 'AI connection failed')
    } finally { setCheckingAI(false) }
  }

  async function copyReply(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify('Reply copied')
    } catch { notify('Could not copy reply') }
  }

  async function saveReplyAsNote(text: string) {
    const content = text.trim()
    if (!content) return
    const firstLine = content.split(/\r?\n/, 1)[0].trim()
    const title = (firstLine || 'Nova response').slice(0, 80)
    try {
      await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content }) })
      await refresh()
      notify('Reply saved to Notes')
    } catch { notify('Could not save reply — check API connection') }
  }

  async function saveNote() {
    if (!noteTitle.trim()) { notify('Add a title first'); return }
    try {
      const payload = JSON.stringify({ title: noteTitle.trim(), content: noteContent })
      if (editingNote) await api(`/api/notes/${editingNote}`, { method: 'PUT', body: payload })
      else await api('/api/notes', { method: 'POST', body: payload })
      setNoteTitle(''); setNoteContent(''); setEditingNote(null); await refresh(); notify('Note saved')
    } catch { notify('Could not save note — check backend') }
  }
  function editNote(n: Note) { setEditingNote(n.id); setNoteTitle(n.title); setNoteContent(n.content) }
  async function deleteNote(id: number) {
    try { await api(`/api/notes/${id}`, { method: 'DELETE' }); await refresh(); if (editingNote === id) { setEditingNote(null); setNoteTitle(''); setNoteContent('') } notify('Note deleted') } catch { notify('Delete failed') }
  }
  async function importDocument(file?: File) {
    if (!file) return
    if (!/\.(txt|pdf|docx)$/i.test(file.name)) { notify('Choose a PDF, DOCX, or TXT file'); return }
    try {
      const data = new FormData()
      data.append('file', file)
      const result = await api<{ indexed:boolean; index_message?:string }>('/api/documents/upload', { method: 'POST', body: data })
      setDocName(file.name)
      setDocContent(file.name.toLowerCase().endsWith('.txt') ? await file.text() : '')
      await refresh()
      notify(result.indexed ? 'Document imported and indexed locally' : `Document saved but not indexed: ${result.index_message || 'Ollama embeddings are unavailable'}`)
    } catch (e) { notify(e instanceof Error ? e.message : 'Document import failed') }
  }
  async function savePastedDocument() {
    if (!docName.trim() || !docContent.trim()) { notify('Enter a filename and some text'); return }
    try {
      const result = await api<{ indexed:boolean; index_message?:string }>('/api/documents', { method: 'POST', body: JSON.stringify({ filename: docName, content: docContent }) })
      await refresh(); setDocName(''); setDocContent('')
      notify(result.indexed ? 'Document saved and indexed locally' : `Document saved but not indexed: ${result.index_message || 'Ollama embeddings are unavailable'}`)
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save document') }
  }
  async function runBot() {
    const bot = bots.find(item => item.id === selectedBot)
    if (!bot || !botTask.trim() || botBusy) return
    setBotBusy(true); setBotResult(''); setWriterSources([]); setAiConnection('')
    try {
      if (bot.id === 'writer') {
        await streamApi('/api/writer/stream', {
          action: writerAction,
          text: botTask.trim(),
          tone: writerTone,
          document_ids: writerDocumentIds,
          mode: aiMode,
          provider: aiProvider === 'automatic' ? null : aiProvider,
          model: aiProvider === 'automatic' ? null : aiModel || null,
        }, event => {
          if (event.type === 'meta') setActiveAI(`${event.provider}:${event.model}`)
          if (event.type === 'token') { setAiOnline(true); setBotResult(result => result + (event.text || '')) }
          if (event.type === 'reset') setBotResult('')
          if (event.type === 'fallback' && event.details) setAiConnection(`Fallback: ${event.details}`)
          if (event.type === 'sources') setWriterSources(event.sources || [])
        })
      } else {
        const prompt = `Act as ${bot.role}. ${bot.description}\n\nComplete this task for the user. Be practical and clear. Do not claim to have taken external actions or accessed information you were not given.\n\nTask:\n${botTask.trim()}`
        await streamApi('/api/chat/stream', {
          message: prompt,
          conversation_id: null,
          mode: aiMode,
          provider: aiProvider === 'automatic' ? null : aiProvider,
          model: aiProvider === 'automatic' ? null : aiModel || null,
        }, event => {
          if (event.type === 'meta') setActiveAI(`${event.provider}:${event.model}`)
          if (event.type === 'token') { setAiOnline(true); setBotResult(result => result + (event.text || '')) }
          if (event.type === 'reset') setBotResult('')
          if (event.type === 'fallback' && event.details) setAiConnection(`Fallback: ${event.details}`)
        })
      }
      await refresh()
    } catch (e) {
      setAiOnline(false)
      setAiConnection(e instanceof Error ? e.message : 'AI generation failed')
      setBotResult(`Nova couldn't generate a response.\n\n${e instanceof Error ? e.message : 'Unknown error'}`)
    }
    finally { setBotBusy(false) }
  }
  function createBot() {
    if (!botName.trim() || !botRole.trim()) { notify('Add a name and role for your bot'); return }
    const bot: AutoBot = { id: `custom-${Date.now()}`, name: botName.trim(), role: botRole.trim(), description: botDescription.trim() || 'Help the user with their task.', color: 'violet' }
    saveBots([...bots, bot]); setSelectedBot(bot.id); setBotName(''); setBotRole(''); setBotDescription(''); notify('Autobot created')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={21}/></div><div><div className="brand-name">nova<span>•</span></div><div className="brand-caption">PERSONAL INTELLIGENCE</div></div></div>
      <button className="new-chat" onClick={newChat}><Plus size={17}/> New conversation <span>Ctrl K</span></button>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${view==='chat'?'active':''}`} onClick={()=>setView('chat')}><MessageSquare size={17}/> AI Assistant</button>
      <button className={`nav-item ${view==='project'?'active':''}`} onClick={()=>setView('project')}><FolderOpen size={17}/> Project Explorer</button>
      <button className={`nav-item ${view==='agents'?'active':''}`} onClick={()=>setView('agents')}><Users size={17}/> Agent Command Center</button>
      <button className={`nav-item ${view==='notes'?'active':''}`} onClick={()=>setView('notes')}><FileText size={17}/> Notes <span className="nav-count">{notes.length}</span></button>
      <button className={`nav-item ${view==='documents'?'active':''}`} onClick={()=>setView('documents')}><FolderOpen size={17}/> Knowledge files <span className="nav-count">{documents.length}</span></button>
      <button className={`nav-item ${view==='autobots'?'active':''}`} onClick={()=>setView('autobots')}><Bot size={17}/> AI Autobots <span className="nav-count">{bots.length}</span></button>
      <div className="history-head"><span>RECENT CONVERSATIONS</span><Search size={13}/></div>
      <div className="history-list">
        {conversations.map(c=><button key={c.id} className={`history-item ${conversationId===c.id?'selected':''}`} onClick={()=>openConversation(c.id)}><span className="history-dot"/><span>{c.title}</span></button>)}
        {!conversations.length && <div className="empty-history">Your conversations will appear here.</div>}
      </div>
      <div className="sidebar-bottom">
        <div className="privacy-card"><div className="privacy-icon"><Zap size={16}/></div><div><strong>Local-first by design</strong><p>Your chats and notes stay in your local database.</p></div></div>
        <button className="profile-row" onClick={()=>setShowSettings(true)}><div className="avatar">N</div><div className="profile-text"><strong>Nova Workspace</strong><small>Personal edition</small></div><Settings2 size={17}/></button>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{view==='chat'?'AI Assistant':view==='project'?'Project Explorer':view==='agents'?'Agent Command Center':view==='notes'?'Notes':view==='documents'?'Knowledge files':'AI Autobots'}</strong></div>
        <div className="top-actions"><div className={`connection ${online?'connected':''}`}>{online?<Wifi size={14}/>:<WifiOff size={14}/>} {online?'API connected':'API disconnected'}</div><div className="ai-runtime-pill" title={activeAI || 'No AI response yet'}><span className={aiOnline===false?'offline-dot':aiMode==='local-only'?'local-dot':'cloud-dot'}/>{aiOnline===false?'AI offline':activeAI || (aiMode==='local-only'?'Local-only':'AI ready')}</div><button className="icon-button" title="Settings" onClick={()=>setShowSettings(true)}><Settings2 size={17}/></button></div>
      </header>
      {view==='chat' && <section className="chat-view">
        {messages.length===0 ? <div className="welcome">
          <div className="orb-wrap"><div className="orb"><div className="orb-core"/><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/></div><div className="orb-spark spark-a">✦</div><div className="orb-spark spark-b">✧</div></div>
          <div className="eyebrow"><span/> YOUR PRIVATE AI WORKSPACE</div><h1>Think beyond<br/><span>the ordinary.</span></h1>
          <p className="welcome-copy">A calm space to explore ideas, build knowledge, and turn your next thought into meaningful progress.</p>
          <div className="prompt-grid">{starterPrompts.map(p=><button key={p.title} className="prompt-card" onClick={()=>void sendMessage(p.text)}><div className="prompt-icon">{p.icon}</div><strong>{p.title}</strong><span>{p.text}</span><ArrowUp size={15} className="prompt-arrow"/></button>)}</div>
        </div> : <div className="message-feed">
          <div className="feed-heading"><div><div className="eyebrow"><span/> NOVA SESSION</div><h2>Your thinking space</h2></div><button className="subtle-button" onClick={newChat}><Plus size={15}/> New chat</button></div>
          {messages.map((m,i)=><div className={`message-row ${m.role}`} key={i}><div className="message-avatar">{m.role==='assistant'?<Sparkles size={16}/>:<span>Y</span>}</div><div className="message-body"><div className="message-author">{m.role==='assistant'?'Nova':'You'}</div><div className="message-content">{m.content}</div>{m.role==='assistant'&&<div className="message-actions"><button className="subtle-button" onClick={()=>void copyReply(m.content)}><Copy size={13}/> Copy</button><button className="subtle-button" onClick={()=>void saveReplyAsNote(m.content)}><Save size={13}/> Save to Notes</button></div>}</div></div>)}
          {busy && <div className="message-row assistant"><div className="message-avatar"><Sparkles size={16}/></div><div className="typing"><i/><i/><i/> Streaming response from {activeAI || 'selected provider'}</div></div>}
          <div className="feed-bottom"/>
        </div>}
        <div className="composer-wrap">{projectContext&&<div className="project-context-chip"><FolderOpen size={14}/><span><strong>{projectContext.name}</strong> · {projectContext.paths.length} files selected · relevant retrieval</span><button title="Remove project context" onClick={()=>setProjectContext(null)}><X size={14}/></button></div>}<div className="composer"><button className="composer-plus" title="Import a document" onClick={()=>document.getElementById('chat-file')?.click()}><Plus size={18}/></button><button className="composer-plus" title="Choose local project" onClick={()=>void chooseProject()}><FolderOpen size={17}/></button><input id="chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage()}}} placeholder="Ask Nova anything..." /><input id="chat-file" type="file" accept=".txt,.pdf,.docx" hidden onChange={e=>void importDocument(e.target.files?.[0])}/><span className="composer-mode" title={activeAI || aiMode}><span className={aiMode==='local-only'?'local-dot':'cloud-dot'}/>{aiMode==='local-only'?'Local-only':aiMode==='local-first'?'Local-first':'Cloud-first'}<ChevronDown size={13}/></span><button className="send-button" disabled={!input.trim()||busy} onClick={()=>void sendMessage()}><Send size={16}/></button></div><div className="composer-foot"><span><span className="tiny-lock">◇</span> {projectContext?'Project context stays local':'Local-only mode blocks all cloud AI requests'}</span><span>Enter to send <kbd>↵</kbd></span></div></div>
      </section>}
      {view==='project'&&<ProjectWorkspace project={projectSelection} selectedPaths={selectedProjectPaths} onChooseProject={()=>void chooseProject()} onAttachToChat={attachProject} onRefresh={refreshProject} onTogglePath={toggleProjectPath}/>}
      {view==='agents'&&<AgentCommandCenter project={projectSelection} selectedPaths={selectedProjectPaths} onChooseProject={()=>void chooseProject()} onOpenProject={()=>setView('project')} onRefreshProject={refreshProject}/>}
      {view==='notes' && <section className="content-view"><div className="page-intro"><div className="eyebrow"><span/> YOUR KNOWLEDGE BASE</div><h1>Notes that move<br/><span>ideas forward.</span></h1><p>Capture the small things that become big breakthroughs.</p></div><div className="notes-layout"><div className="note-editor panel"><div className="panel-title"><FileText size={17}/><strong>{editingNote?'Edit note':'Create a note'}</strong></div><input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="A title for this thought..." maxLength={200}/><textarea value={noteContent} onChange={e=>setNoteContent(e.target.value)} placeholder="Write your notes here..." rows={9}/><div className="editor-actions"><button className="subtle-button" onClick={()=>{setEditingNote(null);setNoteTitle('');setNoteContent('')}}>Clear</button><button className="primary-button" onClick={()=>void saveNote()}><Check size={15}/> Save note</button></div></div><div className="notes-list"><div className="list-toolbar"><div><strong>Saved notes</strong><span>{notes.length} total</span></div><div className="search-box"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes"/></div></div>{filteredNotes.map(n=><article className="note-card" key={n.id}><div className="note-card-top"><span className="note-symbol">✳</span><div className="note-controls"><button title="Edit" onClick={()=>editNote(n)}><Settings2 size={14}/></button><button title="Delete" onClick={()=>void deleteNote(n.id)}><Trash2 size={14}/></button></div></div><h3>{n.title}</h3><p>{n.content||'No content yet.'}</p><small>Updated {new Date(n.updated_at).toLocaleDateString()}</small></article>)}{!filteredNotes.length&&<div className="empty-panel">No notes yet. Create your first one.</div>}</div></div></section>}
      {view==='documents' && <section className="content-view"><div className="page-intro"><div className="eyebrow"><span/> LOCAL KNOWLEDGE</div><h1>Your files.<br/><span>Your knowledge.</span></h1><p>Import PDF, DOCX, and TXT files for private, cited answers in Writer.</p></div><div className="document-layout"><div className="panel import-panel"><div className="panel-title"><FolderOpen size={17}/><strong>Import a document</strong></div><label className="drop-zone"><input type="file" accept=".txt,.pdf,.docx" onChange={e=>void importDocument(e.target.files?.[0])}/><div className="upload-icon"><Plus size={22}/></div><strong>Choose a PDF, DOCX, or TXT file</strong><span>Up to 10 MB · embeddings stay on local Ollama</span></label><div className="or-divider"><span>OR PASTE TEXT</span></div><input value={docName} onChange={e=>setDocName(e.target.value)} placeholder="Filename, e.g. project-notes.txt"/><textarea value={docContent} onChange={e=>setDocContent(e.target.value)} rows={7} placeholder="Paste document content here..."/><button className="primary-button full-button" onClick={()=>void savePastedDocument()}>Save to knowledge files <ArrowUp size={15}/></button></div><div className="document-list"><div className="list-toolbar"><div><strong>Imported files</strong><span>{documents.length} files</span></div></div>{documents.map(d=><article className="document-card" key={d.id}><div className="doc-icon"><FileText size={18}/></div><div><strong>{d.filename}</strong><span>{d.content?.length||0} characters · {d.indexed?'semantic index ready':'saved; waiting for Ollama embeddings'}</span></div>{d.indexed?<Check size={16} className="doc-check"/>:<Activity size={16} className="doc-check"/>}</article>)}{!documents.length&&<div className="empty-panel">Imported files will appear here.</div>}<div className="info-banner"><Activity size={17}/><div><strong>Private retrieval</strong><p>Text and Ollama embeddings stay in Nova’s SQLite database. Cloud AI only receives retrieved excerpts when you explicitly choose a cloud mode.</p></div></div></div></div></section>}
      {view==='autobots' && <section className="content-view autobots-view"><div className="page-intro"><div className="eyebrow"><span/> YOUR PERSONAL AI TEAM</div><h1>Meet your<br/><span>AI Autobots.</span></h1><p>Choose a specialist, give it a task, and get a focused result from your Nova assistant.</p></div><div className="bot-layout"><div className="bot-roster"><div className="list-toolbar"><div><strong>Your Autobots</strong><span>{bots.length} agents</span></div></div><div className="bot-cards">{bots.map(bot=><button key={bot.id} className={`bot-card ${selectedBot===bot.id?'chosen':''}`} onClick={()=>setSelectedBot(bot.id)}><div className={`bot-avatar ${bot.color}`}><Bot size={19}/></div><div className="bot-card-copy"><strong>{bot.name}</strong><span>{bot.role}</span><p>{bot.description}</p></div><span className="bot-select-mark">{selectedBot===bot.id?<Check size={14}/>:<ArrowUp size={14}/>}</span></button>)}</div><div className="panel bot-create"><div className="panel-title"><WandSparkles size={17}/><strong>Create an Autobot</strong></div><input value={botName} onChange={e=>setBotName(e.target.value)} placeholder="Bot name, e.g. Study coach" maxLength={50}/><input value={botRole} onChange={e=>setBotRole(e.target.value)} placeholder="What role should it play?" maxLength={100}/><textarea value={botDescription} onChange={e=>setBotDescription(e.target.value)} rows={3} placeholder="Describe how it should help..." maxLength={400}/><button className="primary-button full-button" onClick={createBot}><Plus size={14}/> Create bot</button></div></div><div className="bot-workspace"><div className="panel bot-runner"><div className="panel-title"><Play size={16}/><strong>Give your Autobot a task</strong></div><div className="active-bot-line"><div className={`bot-avatar small ${bots.find(b=>b.id===selectedBot)?.color||'cyan'}`}><Bot size={15}/></div><div><strong>{bots.find(b=>b.id===selectedBot)?.name}</strong><span>{bots.find(b=>b.id===selectedBot)?.role}</span></div></div>{selectedBot==='writer'&&<div className="writer-options"><label>Writing action<select value={writerAction} onChange={e=>setWriterAction(e.target.value as typeof writerAction)}><option value="generate">Generate content</option><option value="rewrite">Rewrite / improve</option><option value="grammar">Correct grammar</option><option value="summarize">Summarize</option><option value="expand">Expand content</option><option value="tone">Change tone</option><option value="document-qa">Ask about documents</option></select></label>{writerAction==='tone'&&<label>Tone<input value={writerTone} onChange={e=>setWriterTone(e.target.value)} maxLength={80}/></label>}{writerAction==='document-qa'&&<label>Documents (leave empty for all)<select multiple value={writerDocumentIds.map(String)} onChange={e=>setWriterDocumentIds(Array.from(e.target.selectedOptions,option=>Number(option.value)))}>{documents.map(document=><option key={document.id} value={document.id}>{document.filename}</option>)}</select></label>}</div>}<textarea value={botTask} onChange={e=>setBotTask(e.target.value)} rows={6} placeholder={selectedBot==='writer'&&writerAction==='document-qa'?'Ask a question about your imported documents...':selectedBot==='writer'&&writerAction==='generate'?'Describe what you want to write...':'Describe what you want this bot to do...'} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')void runBot()}}/><button className="primary-button full-button" disabled={!botTask.trim()||botBusy} onClick={()=>void runBot()}>{botBusy?<><Activity size={15}/> Streaming…</>:<><Play size={14}/> Run Autobot</>}</button><p className="bot-runner-hint">Runs through your connected Nova API · Ctrl + Enter to run</p></div>{aiConnection&&<div className="bot-note"><Activity size={15}/><span>{aiConnection}</span></div>}{botResult&&<div className="panel bot-result"><div className="result-heading"><div><div className="eyebrow"><span/> TASK RESULT</div><h3>{bots.find(b=>b.id===selectedBot)?.name} responded</h3></div><button className="subtle-button" onClick={()=>void copyReply(botResult)}><Copy size={13}/> Copy</button></div><div className="message-content">{botResult}</div>{writerSources.length>0&&<div className="writer-source-list"><strong>Sources</strong>{writerSources.map(source=><span key={`${source.filename}:${source.chunk}`}><FileText size={13}/>{source.filename} · chunk {source.chunk}</span>)}</div>}</div>}<div className="bot-note"><Zap size={15}/><span>Autobots generate answers on request. They don’t run in the background or take external actions.</span></div></div></div></section>}
      <footer className="statusbar"><div><span className="status-dot"/>{online?'API connected':'Waiting for API'} <span className="status-divider">·</span>{aiOnline===false?'AI offline':aiMode==='local-only'?'Local-only':'Cloud routing enabled'}<span className="status-divider">·</span> Nova v1.0</div><div title={apiUrl}><span>{apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><span className="status-divider">·</span><Globe2 size={13}/> Web + Desktop</div></footer>
    </main>
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
    {showSettings && <div className="modal-backdrop" onClick={()=>setShowSettings(false)}><div className="settings-modal" onClick={e=>e.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow"><span/> PREFERENCES</div><h2>Workspace settings</h2></div><button className="icon-button" onClick={()=>setShowSettings(false)}><X size={17}/></button></div><div className="setting-row connection-setting"><div className="setting-icon"><Wifi size={17}/></div><div className="connection-fields"><strong>Nova API server URL</strong><p>Enter your deployed Nova API address. This desktop saves it for future launches.</p><input aria-label="Nova API server URL" type="url" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void checkConnection()}} placeholder="https://your-nova-api.example.com" /></div><span className={`mini-status ${online?'good':''}`}>{online?'Connected':'Offline'}</span></div><div className="connection-actions"><button className="subtle-button" disabled={checkingConnection} onClick={()=>void checkConnection()}>{checkingConnection?'Checking…':'Test connection'}</button><button className="primary-button" disabled={checkingConnection} onClick={()=>void saveConnection()}>{checkingConnection?'Saving…':'Save server'}</button></div>    <div className="setting-row"><div className="setting-icon"><Bot size={17}/></div><div><strong>AI engine routing</strong><p>Local-only blocks all cloud AI. Cloud modes transmit prompts and selected document excerpts to the configured provider.</p></div></div><div className="ai-settings-grid"><label>Privacy and routing mode<select value={aiMode} onChange={e=>{const next=e.target.value as AIMode;setAiMode(next);if(next==='local-only'&&aiProvider!=='automatic'&&aiProvider!=='ollama')setAiProvider('automatic')}}><option value="local-only">Local-only · never use cloud</option><option value="local-first">Local-first · cloud fallback allowed</option><option value="cloud-first">Cloud-first · local fallback allowed</option></select></label>    <label>Provider<select value={aiProvider} onChange={e=>changeAIProvider(e.target.value)}><option value="automatic">Automatic routing</option>{aiProviders.map(item=><option key={item.provider} value={item.provider} disabled={aiMode==='local-only'&&!item.local}>{item.provider[0].toUpperCase()+item.provider.slice(1)}{item.configured?'':' · not configured'}</option>)}</select></label><label>Model<input list="nova-models" value={aiModel} onChange={e=>setAiModel(e.target.value)} disabled={aiProvider==='automatic'} placeholder={aiProvider==='automatic'?'Automatic routing uses provider defaults':'Provider default model'}/><datalist id="nova-models">{aiProviders.filter(item=>item.provider===aiProvider).map(item=>item.model&&<option key={item.provider} value={item.model}/>)}</datalist></label><div className="ai-test-row"><button className="subtle-button" disabled={checkingAI} onClick={()=>void testAIConnection()}>{checkingAI?'Testing…':'Test AI connection'}</button><span className={aiConnection?'ai-test-message':''}>{aiConnection||`${aiProviders.filter(item=>item.configured).length} provider(s) configured`}</span></div><p className="ai-key-note">API keys are read only from environment variables on the Nova API host; they are never sent to or stored in this UI.</p></div><div className="setting-row"><div className="setting-icon"><FileText size={17}/></div><div><strong>Storage</strong><p>Chats, notes, and imported text are stored by the connected API server.</p></div></div></div></div>}
  </div>
}
