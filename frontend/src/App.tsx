import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUp, Bot, Check, ChevronDown, FileText, FolderOpen, Globe2, MessageSquare, Plus, Search, Send, Settings2, Sparkles, Trash2, Wifi, WifiOff, X, Zap } from 'lucide-react'
import { api, getApiBaseUrl, persistApiBaseUrl, testApiBaseUrl } from './api'

type Note = { id: number; title: string; content: string; updated_at: string }
type Conversation = { id: number; title: string; created_at: string; messages?: { role: string; content: string }[] }
type Message = { role: 'user' | 'assistant'; content: string }

const starterPrompts = [
  { icon: '✦', title: 'Plan a project', text: 'Help me plan a small project with milestones and risks.' },
  { icon: '⌘', title: 'Explain a concept', text: 'Explain how Retrieval-Augmented Generation works in simple terms.' },
  { icon: '↗', title: 'Write something', text: 'Help me draft a clear, professional project description.' },
]

export default function App() {
  const [view, setView] = useState<'chat' | 'notes' | 'documents'>('chat')
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
  const [documents, setDocuments] = useState<{id:number;filename:string;content:string}[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:8765')
  const [checkingConnection, setCheckingConnection] = useState(false)

  useEffect(() => { void getApiBaseUrl().then(setApiUrl) }, [])

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

  async function sendMessage(text = input) {
    const value = text.trim()
    if (!value || busy) return
    setInput(''); setBusy(true)
    setMessages(prev => [...prev, { role: 'user', content: value }])
    try {
      const result = await api<{conversation_id:number;reply:string;model:string}>('/api/chat', {
        method: 'POST', body: JSON.stringify({ message: value, conversation_id: conversationId })
      })
      setConversationId(result.conversation_id)
      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }])
      await refresh()
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `I couldn't reach the Nova API. Check your connection URL and make sure the server is online.\n\nDetails: ${e instanceof Error ? e.message : 'Unknown error'}` }])
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
    if (!/\.(txt|md)$/i.test(file.name)) { notify('Choose a .txt or .md file'); return }
    const content = await file.text()
    try {
      await api('/api/documents', { method: 'POST', body: JSON.stringify({ filename: file.name, content }) })
      setDocName(file.name); setDocContent(content); await refresh(); notify('Document imported locally')
    } catch { notify('Import failed — check backend') }
  }
  async function savePastedDocument() {
    if (!docName.trim() || !docContent.trim()) { notify('Enter a filename and some text'); return }
    try { await api('/api/documents', { method: 'POST', body: JSON.stringify({ filename: docName, content: docContent }) }); await refresh(); setDocName(''); setDocContent(''); notify('Document saved') } catch { notify('Could not save document') }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={21}/></div><div><div className="brand-name">nova<span>•</span></div><div className="brand-caption">PERSONAL INTELLIGENCE</div></div></div>
      <button className="new-chat" onClick={newChat}><Plus size={17}/> New conversation <span>Ctrl K</span></button>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${view==='chat'?'active':''}`} onClick={()=>setView('chat')}><MessageSquare size={17}/> AI Assistant</button>
      <button className={`nav-item ${view==='notes'?'active':''}`} onClick={()=>setView('notes')}><FileText size={17}/> Notes <span className="nav-count">{notes.length}</span></button>
      <button className={`nav-item ${view==='documents'?'active':''}`} onClick={()=>setView('documents')}><FolderOpen size={17}/> Knowledge files <span className="nav-count">{documents.length}</span></button>
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
        <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{view==='chat'?'AI Assistant':view==='notes'?'Notes':'Knowledge files'}</strong></div>
        <div className="top-actions"><div className={`connection ${online?'connected':''}`}>{online?<Wifi size={14}/>:<WifiOff size={14}/>} {online?'API connected':'API disconnected'}</div><button className="icon-button" title="Settings" onClick={()=>setShowSettings(true)}><Settings2 size={17}/></button></div>
      </header>
      {view==='chat' && <section className="chat-view">
        {messages.length===0 ? <div className="welcome">
          <div className="orb-wrap"><div className="orb"><div className="orb-core"/><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/></div><div className="orb-spark spark-a">✦</div><div className="orb-spark spark-b">✧</div></div>
          <div className="eyebrow"><span/> YOUR PRIVATE AI WORKSPACE</div><h1>Think beyond<br/><span>the ordinary.</span></h1>
          <p className="welcome-copy">A calm space to explore ideas, build knowledge, and turn your next thought into meaningful progress.</p>
          <div className="prompt-grid">{starterPrompts.map(p=><button key={p.title} className="prompt-card" onClick={()=>void sendMessage(p.text)}><div className="prompt-icon">{p.icon}</div><strong>{p.title}</strong><span>{p.text}</span><ArrowUp size={15} className="prompt-arrow"/></button>)}</div>
        </div> : <div className="message-feed">
          <div className="feed-heading"><div><div className="eyebrow"><span/> NOVA SESSION</div><h2>Your thinking space</h2></div><button className="subtle-button" onClick={newChat}><Plus size={15}/> New chat</button></div>
          {messages.map((m,i)=><div className={`message-row ${m.role}`} key={i}><div className="message-avatar">{m.role==='assistant'?<Sparkles size={16}/>:<span>Y</span>}</div><div className="message-body"><div className="message-author">{m.role==='assistant'?'Nova':'You'}</div><div className="message-content">{m.content}</div></div></div>)}
          {busy && <div className="message-row assistant"><div className="message-avatar"><Sparkles size={16}/></div><div className="typing"><i/><i/><i/> Nova is thinking</div></div>}
          <div className="feed-bottom"/>
        </div>}
        <div className="composer-wrap"><div className="composer"><button className="composer-plus" title="Add a text file" onClick={()=>document.getElementById('chat-file')?.click()}><Plus size={18}/></button><input id="chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage()}}} placeholder="Ask Nova anything..." /><input id="chat-file" type="file" accept=".txt,.md" hidden onChange={e=>void importDocument(e.target.files?.[0])}/><span className="composer-mode"><span/> Local mode <ChevronDown size={13}/></span><button className="send-button" disabled={!input.trim()||busy} onClick={()=>void sendMessage()}><Send size={16}/></button></div><div className="composer-foot"><span><span className="tiny-lock">◇</span> Private workspace · Local database</span><span>Enter to send <kbd>↵</kbd></span></div></div>
      </section>}
      {view==='notes' && <section className="content-view"><div className="page-intro"><div className="eyebrow"><span/> YOUR KNOWLEDGE BASE</div><h1>Notes that move<br/><span>ideas forward.</span></h1><p>Capture the small things that become big breakthroughs.</p></div><div className="notes-layout"><div className="note-editor panel"><div className="panel-title"><FileText size={17}/><strong>{editingNote?'Edit note':'Create a note'}</strong></div><input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="A title for this thought..." maxLength={200}/><textarea value={noteContent} onChange={e=>setNoteContent(e.target.value)} placeholder="Write your notes here..." rows={9}/><div className="editor-actions"><button className="subtle-button" onClick={()=>{setEditingNote(null);setNoteTitle('');setNoteContent('')}}>Clear</button><button className="primary-button" onClick={()=>void saveNote()}><Check size={15}/> Save note</button></div></div><div className="notes-list"><div className="list-toolbar"><div><strong>Saved notes</strong><span>{notes.length} total</span></div><div className="search-box"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes"/></div></div>{filteredNotes.map(n=><article className="note-card" key={n.id}><div className="note-card-top"><span className="note-symbol">✳</span><div className="note-controls"><button title="Edit" onClick={()=>editNote(n)}><Settings2 size={14}/></button><button title="Delete" onClick={()=>void deleteNote(n.id)}><Trash2 size={14}/></button></div></div><h3>{n.title}</h3><p>{n.content||'No content yet.'}</p><small>Updated {new Date(n.updated_at).toLocaleDateString()}</small></article>)}{!filteredNotes.length&&<div className="empty-panel">No notes yet. Create your first one.</div>}</div></div></section>}
      {view==='documents' && <section className="content-view"><div className="page-intro"><div className="eyebrow"><span/> LOCAL KNOWLEDGE</div><h1>Your files.<br/><span>Your knowledge.</span></h1><p>Keep text and Markdown references available in your private workspace.</p></div><div className="document-layout"><div className="panel import-panel"><div className="panel-title"><FolderOpen size={17}/><strong>Import a document</strong></div><label className="drop-zone"><input type="file" accept=".txt,.md" onChange={e=>void importDocument(e.target.files?.[0])}/><div className="upload-icon"><Plus size={22}/></div><strong>Choose a text or Markdown file</strong><span>TXT or MD · up to 2 MB</span></label><div className="or-divider"><span>OR PASTE TEXT</span></div><input value={docName} onChange={e=>setDocName(e.target.value)} placeholder="Filename, e.g. project-notes.md"/><textarea value={docContent} onChange={e=>setDocContent(e.target.value)} rows={7} placeholder="Paste document content here..."/><button className="primary-button full-button" onClick={()=>void savePastedDocument()}>Save to knowledge files <ArrowUp size={15}/></button></div><div className="document-list"><div className="list-toolbar"><div><strong>Imported files</strong><span>{documents.length} files</span></div></div>{documents.map(d=><article className="document-card" key={d.id}><div className="doc-icon"><FileText size={18}/></div><div><strong>{d.filename}</strong><span>{d.content?.length||0} characters saved locally</span></div><Check size={16} className="doc-check"/></article>)}{!documents.length&&<div className="empty-panel">Imported files will appear here.</div>}<div className="info-banner"><Activity size={17}/><div><strong>Starter knowledge storage</strong><p>Files are saved in SQLite. Semantic search, OCR, and retrieval-augmented answers can be added in a future version.</p></div></div></div></div></section>}
      <footer className="statusbar"><div><span className="status-dot"/>{online?'API connected':'Waiting for API'} <span className="status-divider">·</span> Nova v1.0</div><div title={apiUrl}><span>{apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><span className="status-divider">·</span><Globe2 size={13}/> Web + Desktop</div></footer>
    </main>
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
    {showSettings && <div className="modal-backdrop" onClick={()=>setShowSettings(false)}><div className="settings-modal" onClick={e=>e.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow"><span/> PREFERENCES</div><h2>Workspace settings</h2></div><button className="icon-button" onClick={()=>setShowSettings(false)}><X size={17}/></button></div><div className="setting-row connection-setting"><div className="setting-icon"><Wifi size={17}/></div><div className="connection-fields"><strong>Nova API server URL</strong><p>Enter your deployed Nova API address. This desktop saves it for future launches.</p><input aria-label="Nova API server URL" type="url" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void checkConnection()}} placeholder="https://your-nova-api.example.com" /></div><span className={`mini-status ${online?'good':''}`}>{online?'Connected':'Offline'}</span></div><div className="connection-actions"><button className="subtle-button" disabled={checkingConnection} onClick={()=>void checkConnection()}>{checkingConnection?'Checking…':'Test connection'}</button><button className="primary-button" disabled={checkingConnection} onClick={()=>void saveConnection()}>{checkingConnection?'Saving…':'Save server'}</button></div><div className="setting-row"><div className="setting-icon"><Bot size={17}/></div><div><strong>Assistant engine</strong><p>Local server fallback is built in. Configure Ollama on your API host for hosted model answers.</p></div></div><div className="setting-row"><div className="setting-icon"><FileText size={17}/></div><div><strong>Storage</strong><p>Chats, notes, and imported text are stored by the connected API server.</p></div></div></div></div>}
  </div>
}
