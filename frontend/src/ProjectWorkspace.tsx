import { useEffect, useMemo, useState } from 'react'
import { Activity, Check, ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, Play, RefreshCw, Search, ShieldCheck, WandSparkles, X } from 'lucide-react'
import { apiAtBaseUrl, getApiBaseUrl, isLocalApiBaseUrl } from './api'

type Project = { id: string; name: string; files: string[] }
type ProjectFile = { path: string; content: string; containsSensitiveData?: boolean; truncated?: boolean }
type Proposal = { path: string; original_content: string; proposed_content: string; summary: string }
type TestCommand = { id: string; label: string }
type Props = {
  project: Project | null
  selectedPaths: string[]
  onChooseProject: () => void
  onAttachToChat: () => void
  onRefresh: () => Promise<void>
  onTogglePath: (path: string) => void
}
type TreeNode = { name: string; path: string; files: string[]; folders: Map<string, TreeNode> }

function makeTree(files: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', files: [], folders: new Map() }
  for (const file of files) {
    const segments = file.split('/')
    let node = root
    for (const folder of segments.slice(0, -1)) {
      if (!node.folders.has(folder)) node.folders.set(folder, {
        name: folder,
        path: node.path ? `${node.path}/${folder}` : folder,
        files: [],
        folders: new Map(),
      })
      node = node.folders.get(folder)!
    }
    node.files.push(segments[segments.length - 1])
  }
  return root
}

function ProjectTree({ node, depth, activePath, selectedPaths, onSelect, onTogglePath }: {
  node: TreeNode
  depth: number
  activePath: string
  selectedPaths: string[]
  onSelect: (path: string) => void
  onTogglePath: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  return <div>
    {node.path&&<button className="project-tree-folder" style={{paddingLeft: `${12 + depth * 14}px`}} onClick={()=>setExpanded(value=>!value)}>
      {expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<Folder size={14}/><span>{node.name}</span>
    </button>}
    {(expanded||!node.path)&&<>
      {[...node.folders.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(folder=><ProjectTree key={folder.path} node={folder} depth={depth+1} activePath={activePath} selectedPaths={selectedPaths} onSelect={onSelect} onTogglePath={onTogglePath}/>)}
      {node.files.sort().map(name=>{
        const path = node.path ? `${node.path}/${name}` : name
        return <div className={`project-tree-file ${activePath===path?'active':''}`} style={{paddingLeft: `${24 + depth * 14}px`}} key={path}>
          <input type="checkbox" checked={selectedPaths.includes(path)} onChange={()=>onTogglePath(path)} aria-label={`Select ${path} for AI context`}/>
          <button onClick={()=>onSelect(path)}><FileCode2 size={13}/><span>{name}</span></button>
        </div>
      })}
    </>}
  </div>
}

export default function ProjectWorkspace({ project, selectedPaths, onChooseProject, onAttachToChat, onRefresh, onTogglePath }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{path:string;score:number;snippet:string}[]>([])
  const [activePath, setActivePath] = useState('')
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null)
  const [task, setTask] = useState('')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [busy, setBusy] = useState(false)
  const [commands, setCommands] = useState<TestCommand[]>([])
  const [testResult, setTestResult] = useState('')
  const [testOutput, setTestOutput] = useState('')
  const [explanation, setExplanation] = useState('')
  const [error, setError] = useState('')
  const tree = useMemo(()=>makeTree(project?.files||[]),[project?.files])

  useEffect(()=>{
    setActivePath('')
    setActiveFile(null)
    setProposals([])
    setTestResult('')
    setTestOutput('')
    setExplanation('')
    if (!project || !window.novaDesktop?.listProjectTests) { setCommands([]); return }
    void window.novaDesktop.listProjectTests(project.id).then(setCommands).catch(e=>setError(e instanceof Error?e.message:'Could not inspect test commands'))
  },[project?.name, project?.files])

  useEffect(()=>{
    let cancelled = false
    if (!project || !query.trim() || !window.novaDesktop?.searchProjectFiles) { setResults([]); return }
    const timer = window.setTimeout(()=>{
      void window.novaDesktop!.searchProjectFiles(project.id,project.files,query).then(items=>{if(!cancelled)setResults(items)})
        .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Project search failed')})
    },180)
    return ()=>{cancelled=true;window.clearTimeout(timer)}
  },[project,query])

  async function openFile(path: string) {
    if (!window.novaDesktop) return
    setActivePath(path); setError('')
    try {
      const [file] = await window.novaDesktop.readProjectFiles(project!.id,[path])
      setActiveFile(file || null)
    } catch (e) { setError(e instanceof Error?e.message:'Could not read project file') }
  }

  async function proposeChanges() {
    if (!project || !task.trim() || busy || !window.novaDesktop) return
    setBusy(true);setError('');setProposals([])
    try {
      const base = await getApiBaseUrl()
      if (!isLocalApiBaseUrl(base)) throw new Error('Code proposals are restricted to a local Nova API.')
      const paths = selectedPaths.length ? selectedPaths.slice(0,8) : activePath ? [activePath] : []
      if (!paths.length) throw new Error('Select at least one source file for the proposal.')
      const files = await window.novaDesktop.readProjectFiles(project.id,paths)
      if (files.some(file=>file.containsSensitiveData)) throw new Error('Selected files contain redacted sensitive values. Remove them from the proposal context.')
      if (files.some(file=>file.truncated)) throw new Error('A selected file exceeds the safe proposal context limit. Select smaller files.')
      const response = await apiAtBaseUrl<{changes:Proposal[]}>(base,'/api/projects/proposals',{
        method:'POST',
        body:JSON.stringify({task:task.trim(),project_files:files.map(({path,content})=>({path,content}))}),
        redirect:'error',
      })
      setProposals(response.changes)
      if (!response.changes.length) setError('Nova did not propose any file changes.')
    } catch(e) { setError(e instanceof Error?e.message:'Could not create a code proposal') }
    finally { setBusy(false) }
  }

  async function applyProposal(proposal: Proposal) {
    if (!window.novaDesktop) return
    setError('');setBusy(true)
    try {
      const result = await window.novaDesktop.applyProjectChange(project!.id,{
        path:proposal.path,
        originalContent:proposal.original_content,
        proposedContent:proposal.proposed_content,
      },true)
      if (result.applied) {
        setProposals(current=>current.filter(item=>item!==proposal))
        await onRefresh()
        if (activePath===proposal.path) await openFile(proposal.path)
      }
    } catch(e) { setError(e instanceof Error?e.message:'Could not apply the approved change') }
    finally { setBusy(false) }
  }

  async function runTest(command: TestCommand) {
    if (!window.novaDesktop) return
    setBusy(true);setError('');setTestResult('Waiting for approval…');setExplanation('')
    try {
      const result = await window.novaDesktop.runProjectTest(project!.id,command.id,true)
      if (!result.approved) { setTestResult('Test execution cancelled.');return }
      setTestResult(`${result.command} · ${result.exitCode===0?'Passed':'Failed'} (exit ${result.exitCode ?? 'unknown'})`)
      setTestOutput(result.output)
    } catch(e) { setError(e instanceof Error?e.message:'Test command failed');setTestResult('Test could not be completed.') }
    finally { setBusy(false) }
  }

  async function explainFailure() {
    if (!testOutput || !window.novaDesktop || !project) return
    setBusy(true);setError('');setExplanation('')
    try {
      const base = await getApiBaseUrl()
      if (!isLocalApiBaseUrl(base)) throw new Error('Test explanations are restricted to a local Nova API.')
      const safeOutput = await window.novaDesktop.sanitizeProjectText(project.id,testOutput.slice(0,10000))
      const contextPaths = selectedPaths.length ? selectedPaths.slice(0,8) : activePath ? [activePath] : []
      const files = await window.novaDesktop.readProjectFiles(project.id,contextPaths)
      if (!files.length) throw new Error('Select at least one source file so Nova can explain the failure.')
      const safeFiles = files.filter(file=>!file.containsSensitiveData)
      if (!safeFiles.length) throw new Error('No safe source files are selected for the explanation.')
      const response = await apiAtBaseUrl<{reply:string}>(base,'/api/projects/explain-tests',{
        method:'POST',
        body:JSON.stringify({task:safeOutput,project_files:safeFiles.map(({path,content})=>({path,content}))}),
        redirect:'error',
      })
      setExplanation(response.reply)
    } catch(e) { setError(e instanceof Error?e.message:'Could not explain test output') }
    finally { setBusy(false) }
  }

  return <section className="content-view project-workspace">
    <div className="page-intro"><div className="eyebrow"><span/> LOCAL PROJECT INTELLIGENCE</div><h1>Explore your<br/><span>codebase.</span></h1><p>Browse, search, review AI proposals, and run tests only after you approve.</p></div>
    {!project?<div className="panel project-empty"><FolderOpen size={24}/><strong>No project selected</strong><span>Choose a folder to explore supported source files locally.</span><button className="primary-button" onClick={onChooseProject}>Choose project folder</button></div>:<>
      <div className="project-toolbar panel"><div><div className="panel-title"><FolderOpen size={17}/><strong>{project.name}</strong></div><span>{project.files.length} supported files · read-only by default</span></div><div><button className="subtle-button" onClick={()=>void onRefresh()}><RefreshCw size={13}/> Refresh</button><button className="primary-button" disabled={!selectedPaths.length} onClick={onAttachToChat}>Attach {selectedPaths.length} to chat</button></div></div>
      <div className="project-search panel"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search filenames and file contents..."/><span>{query?`${results.length} matches`:'Search stays on this device'}</span></div>
      <div className="project-explorer-layout">
        <div className="panel project-file-panel"><div className="panel-title"><FolderOpen size={16}/><strong>Project files</strong></div>{query.trim()?<div className="project-search-results">{results.map(result=><button key={result.path} onClick={()=>void openFile(result.path)}><strong>{result.path}</strong><span>{result.snippet}</span></button>)}{!results.length&&<div className="empty-panel">No matching files.</div>}</div>:<div className="project-tree"><ProjectTree node={tree} depth={0} activePath={activePath} selectedPaths={selectedPaths} onSelect={path=>void openFile(path)} onTogglePath={onTogglePath}/>{!project.files.length&&<div className="empty-panel">No supported source files found.</div>}</div>}<div className="project-security-note"><ShieldCheck size={14}/> Sensitive filenames and values are excluded or redacted.</div></div>
        <div className="project-tools-column">
          <div className="panel project-preview"><div className="panel-title"><FileCode2 size={16}/><strong>{activePath||'File preview'}</strong></div>{activeFile?.containsSensitiveData&&<div className="project-redaction">Sensitive values are redacted; this file cannot be used for code proposals.</div>}{activeFile?.truncated&&<div className="project-redaction">Preview truncated at the safe 10,000 character limit.</div>}<pre>{activeFile?.content||'Select a file to preview it locally.'}</pre></div>
          <div className="panel project-proposal"><div className="panel-title"><WandSparkles size={16}/><strong>AI code proposal</strong></div><textarea value={task} onChange={e=>setTask(e.target.value)} rows={3} maxLength={4000} placeholder="Describe a small change for the selected files..."/><button className="primary-button" disabled={busy||!task.trim()} onClick={()=>void proposeChanges()}>{busy?<><Activity size={14}/> Working…</>:<>Generate proposal</>}</button><p>Nova only proposes changes. Each file requires a separate approval and backup before writing.</p></div>
          {proposals.map(proposal=><article className="panel proposal-card" key={proposal.path}><div className="proposal-heading"><div><strong>{proposal.path}</strong><span>{proposal.summary}</span></div><button className="subtle-button" onClick={()=>setProposals(current=>current.filter(item=>item!==proposal))}><X size={13}/> Reject</button></div><div className="proposal-diff"><div><strong>Before</strong><pre>{proposal.original_content}</pre></div><div><strong>After</strong><pre>{proposal.proposed_content}</pre></div></div><button className="primary-button" onClick={()=>void applyProposal(proposal)}><Check size={14}/> Approve, back up & apply</button></article>)}
          <div className="panel project-tests"><div className="panel-title"><Play size={16}/><strong>Testing assistant</strong></div>{commands.length?commands.map(command=><div className="test-command" key={command.id}><code>{command.label}</code><button className="subtle-button" disabled={busy} onClick={()=>void runTest(command)}><Play size={12}/> Review & run</button></div>):<p>No recognised test runner or project test script found.</p>}<p>Running tests can execute code defined by the project. Nova always asks for approval first.</p>{testResult&&<strong className={`test-result ${testResult.includes('Passed')?'success':''}`}>{testResult}</strong>}{testOutput&&<><pre className="test-output">{testOutput}</pre><button className="subtle-button" disabled={busy} onClick={()=>void explainFailure()}>Ask Nova to explain failure</button></>}{explanation&&<div className="test-explanation">{explanation}</div>}</div>
        </div>
      </div>
    </>}
    {error&&<div className="project-error">{error}<button onClick={()=>setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
  </section>
}
