import { useEffect, useState } from 'react'
import { Activity, Bot, Check, CircleAlert, ClipboardList, FileCode2, FolderOpen, Play, RefreshCw, ShieldCheck, Sparkles, Terminal, X } from 'lucide-react'
import { apiAtBaseUrl, getApiBaseUrl, isLocalApiBaseUrl } from './api'
import './AgentCommandCenter.css'

type Project = { id: string; name: string; files: string[] }
type ProjectFile = { path: string; content: string; containsSensitiveData?: boolean; truncated?: boolean }
type Proposal = { path: string; original_content: string; proposed_content: string; summary: string }
type TestCommand = { id: string; label: string }
type AgentRole = 'architect' | 'developer' | 'qa' | 'security' | 'supervisor'
type AgentEvent = { agent: AgentRole; status: 'running' | 'completed' | 'failed' | 'approval'; message: string; created_at: string }
type AgentRun = { id: number; task: string; project_name: string; status: string; events: AgentEvent[]; created_at: string; updated_at: string }

const agents: { id: AgentRole; name: string; description: string; color: string }[] = [
  { id: 'architect', name: 'Architect', description: 'Plans scope, affected files, dependencies, and risks.', color: 'cyan' },
  { id: 'developer', name: 'Developer', description: 'Creates reviewable file proposals, never direct edits.', color: 'violet' },
  { id: 'qa', name: 'QA', description: 'Reviews validation strategy and approved test output.', color: 'mint' },
  { id: 'security', name: 'Security', description: 'Reviews source and proposed changes for concrete risks.', color: 'amber' },
]

type Props = {
  project: Project | null
  selectedPaths: string[]
  onChooseProject: () => void
  onOpenProject: () => void
  onRefreshProject: () => Promise<void>
}

export default function AgentCommandCenter({ project, selectedPaths, onChooseProject, onOpenProject, onRefreshProject }: Props) {
  const [task, setTask] = useState('')
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [commands, setCommands] = useState<TestCommand[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function localApi() {
    const base = await getApiBaseUrl()
    if (!isLocalApiBaseUrl(base)) throw new Error('Agent and project context are restricted to a local Nova API.')
    return base
  }

  async function loadRuns() {
    try {
      const base = await localApi()
      const history = await apiAtBaseUrl<AgentRun[]>(base, '/api/agents/runs')
      setRuns(history)
      if (!currentRun && history.length) setCurrentRun(history[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load local agent history.')
    }
  }

  useEffect(() => { void loadRuns() }, [])
  useEffect(() => {
    setProposals([])
    if (!project || !window.novaDesktop?.listProjectTests) { setCommands([]); return }
    void window.novaDesktop.listProjectTests(project.id).then(setCommands).catch(e =>
      setError(e instanceof Error ? e.message : 'Could not inspect approved test commands.')
    )
  }, [project?.id, project?.files])

  async function recordEvent(runId: number, agent: AgentRole, status: AgentEvent['status'], message: string) {
    const base = await localApi()
    const updated = await apiAtBaseUrl<AgentRun>(base, `/api/agents/runs/${runId}/events`, {
      method: 'POST',
      body: JSON.stringify({ agent, status, message }),
    })
    setCurrentRun(updated)
    setRuns(items => [updated, ...items.filter(item => item.id !== updated.id)])
    return updated
  }

  async function finishRun(runId: number, status: 'completed' | 'failed' | 'cancelled') {
    const base = await localApi()
    const updated = await apiAtBaseUrl<AgentRun>(base, `/api/agents/runs/${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    setCurrentRun(updated)
    setRuns(items => [updated, ...items.filter(item => item.id !== updated.id)])
  }

  async function executeAgent(base: string, agent: 'architect' | 'qa' | 'security', agentTask: string, files: ProjectFile[], agentContext = '') {
    const result = await apiAtBaseUrl<{ reply: string }>(base, '/api/agents/execute', {
      method: 'POST',
      body: JSON.stringify({
        agent,
        task: agentTask,
        project_files: files.map(({ path, content }) => ({ path, content })),
        agent_context: agentContext.slice(0, 20000),
      }),
    })
    return result.reply
  }

  async function runTeam() {
    if (!project || !task.trim() || busy || !window.novaDesktop) return
    setBusy(true)
    setError('')
    setProposals([])
    let runId: number | null = null
    try {
      const base = await localApi()
      const files = await window.novaDesktop.retrieveProjectContext(project.id, project.files, task.trim(), selectedPaths)
      if (!files.length) throw new Error('No relevant safe project files were found. Select files in Project Explorer or refine the task.')
      if (files.some(file => file.containsSensitiveData)) throw new Error('Retrieved context contains redacted sensitive values. Remove those files from the task context.')
      if (files.some(file => file.truncated)) throw new Error('Retrieved context includes an oversized file. Choose smaller files in Project Explorer.')

      const created = await apiAtBaseUrl<AgentRun>(base, '/api/agents/runs', {
        method: 'POST',
        body: JSON.stringify({ task: task.trim(), project_name: project.name }),
      })
      runId = created.id
      setCurrentRun(created)
      setRuns(items => [created, ...items.filter(item => item.id !== created.id)])

      await recordEvent(runId, 'architect', 'running', 'Reviewing the task and related project files.')
      const plan = await executeAgent(base, 'architect', task.trim(), files)
      await recordEvent(runId, 'architect', 'completed', plan)

      await recordEvent(runId, 'developer', 'running', 'Generating file changes for review; no files are being written.')
      const proposalResponse = await apiAtBaseUrl<{ changes: Proposal[] }>(base, '/api/projects/proposals', {
        method: 'POST',
        body: JSON.stringify({
          task: task.trim(),
          project_files: files.map(({ path, content }) => ({ path, content })),
          agent_context: plan,
        }),
      })
      setProposals(proposalResponse.changes)
      const proposalSummary = proposalResponse.changes.length
        ? proposalResponse.changes.map(change => `${change.path}: ${change.summary}`).join('\n')
        : 'No file changes were proposed.'
      await recordEvent(runId, 'developer', 'completed', proposalSummary)

      const sharedContext = `Architect plan:\n${plan}\n\nDeveloper proposal summary:\n${proposalSummary}`
      await recordEvent(runId, 'qa', 'running', 'Reviewing the plan and proposing validation steps. No commands will run automatically.')
      const qaReview = await executeAgent(
        base,
        'qa',
        `Create a verification checklist for this task. Do not claim tests have run; execution requires a separate user approval.\n\nTask: ${task.trim()}\n\nDetected approved test commands: ${commands.map(command => command.label).join(', ') || 'none found'}`,
        files,
        sharedContext,
      )
      await recordEvent(runId, 'qa', 'completed', qaReview)

      await recordEvent(runId, 'security', 'running', 'Reviewing project context and proposed-change summaries.')
      const proposedCode = proposalResponse.changes.map(change =>
        `--- ${change.path} ---\n${change.proposed_content}`
      ).join('\n\n')
      const boundedSharedContext = sharedContext.slice(0, 3500)
      const securityContext = proposedCode.length <= 14000
        ? `${boundedSharedContext}\n\nProposed file contents:\n${proposedCode || 'No code changes were proposed.'}`
        : `${boundedSharedContext}\n\nProposed changes:\n${proposalSummary}\nThe proposed code exceeded the security review context limit and was not included.`
      const securityReview = await executeAgent(
        base,
        'security',
        `Review the requested task and proposed changes for security risks. Clearly state any context limits.`,
        files,
        securityContext,
      )
      await recordEvent(runId, 'security', 'completed', securityReview)
      await finishRun(runId, 'completed')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The agent workflow failed.'
      setError(message)
      if (runId !== null) {
        try {
          await recordEvent(runId, 'supervisor', 'failed', message)
          await finishRun(runId, 'failed')
        } catch { /* Preserve the original task error if the local API is unavailable. */ }
      }
    } finally {
      setBusy(false)
    }
  }

  async function applyProposal(proposal: Proposal) {
    if (!project || !currentRun || !window.novaDesktop) return
    setBusy(true)
    setError('')
    try {
      const result = await window.novaDesktop.applyProjectChange(project.id, {
        path: proposal.path,
        originalContent: proposal.original_content,
        proposedContent: proposal.proposed_content,
      }, true)
      if (result.applied) {
        setProposals(items => items.filter(item => item !== proposal))
        await recordEvent(currentRun.id, 'developer', 'approval', `User approved and applied the backed-up change to ${proposal.path}.`)
        await onRefreshProject()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the approved file change.')
    } finally {
      setBusy(false)
    }
  }

  async function rejectProposal(proposal: Proposal) {
    setProposals(items => items.filter(item => item !== proposal))
    if (!currentRun) return
    try {
      await recordEvent(currentRun.id, 'developer', 'approval', `User rejected the proposed change to ${proposal.path}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the proposal decision.')
    }
  }

  async function runApprovedTest(command: TestCommand) {
    if (!project || !window.novaDesktop) return
    setBusy(true)
    setError('')
    let run = currentRun
    let createdRun = false
    try {
      const base = await localApi()
      if (!run) {
        run = await apiAtBaseUrl<AgentRun>(base, '/api/agents/runs', {
          method: 'POST',
          body: JSON.stringify({ task: `QA test run: ${command.label}`, project_name: project.name }),
        })
        setCurrentRun(run)
        createdRun = true
      }
      await recordEvent(run.id, 'qa', 'running', `Waiting for operating-system approval to run ${command.label}.`)
      const result = await window.novaDesktop.runProjectTest(project.id, command.id, true)
      if (!result.approved) {
        await recordEvent(run.id, 'qa', 'approval', `User cancelled ${command.label}.`)
        if (createdRun) await finishRun(run.id, 'cancelled')
        return
      }
      const safeOutput = await window.novaDesktop.sanitizeProjectText(project.id, result.output.slice(0, 10000))
      await recordEvent(run.id, 'qa', result.exitCode === 0 ? 'completed' : 'failed', `${result.command} · exit ${result.exitCode ?? 'unknown'}\n${safeOutput}`)
      const paths = selectedPaths.length ? selectedPaths.slice(0, 8) : project.files.slice(0, 8)
      const files = await window.novaDesktop.readProjectFiles(project.id, paths)
      const safeFiles = files.filter(file => !file.containsSensitiveData && !file.truncated)
      const evaluation = await executeAgent(
        base,
        'qa',
        `Evaluate this user-approved test run. Exit code: ${result.exitCode ?? 'unknown'}.\n\nSanitized output:\n${safeOutput}`,
        safeFiles,
        `Original task: ${run.task}`,
      )
      await recordEvent(run.id, 'qa', 'completed', evaluation)
      if (run.status === 'running') await finishRun(run.id, 'completed')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not run or evaluate the test.'
      setError(message)
      if (run) {
        try { await recordEvent(run.id, 'qa', 'failed', message) } catch { /* Keep the original QA failure visible. */ }
      }
    } finally {
      setBusy(false)
    }
  }

  async function selectRun(run: AgentRun) {
    setError('')
    setProposals([])
    try {
      const base = await localApi()
      const detail = await apiAtBaseUrl<AgentRun>(base, `/api/agents/runs/${run.id}`)
      setCurrentRun(detail)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this run.')
    }
  }

  const statusLabel = currentRun?.status === 'running' ? 'In progress' : currentRun?.status === 'failed' ? 'Needs attention' : currentRun?.status === 'cancelled' ? 'Cancelled' : 'Completed'

  return <section className="content-view agent-center">
    <div className="page-intro"><div className="eyebrow"><span/> SUPERVISED PROJECT AGENTS</div><h1>Your team,<br/><span>working together.</span></h1><p>Four specialists share one task context. Nova coordinates every step; file writes and test commands still require your approval.</p></div>
    {!project ? <div className="panel project-empty"><FolderOpen size={24}/><strong>Choose a project to start</strong><span>Agent context is retrieved from your selected project on this device.</span><button className="primary-button" onClick={onChooseProject}>Choose project folder</button><button className="subtle-button" onClick={onOpenProject}>Open Project Explorer</button></div> : <>
      <div className="agent-project-bar panel"><div><FolderOpen size={16}/><div><strong>{project.name}</strong><span>{project.files.length} supported files · {selectedPaths.length ? `${selectedPaths.length} pinned` : 'relevant files retrieved automatically'}</span></div></div><button className="subtle-button" onClick={onOpenProject}>Project Explorer</button></div>
      <div className="agent-roster">{agents.map(agent=><div className="agent-role-card" key={agent.id}><div className={`agent-role-icon ${agent.color}`}><Bot size={17}/></div><div><strong>{agent.name}</strong><span>{agent.description}</span></div></div>)}</div>
      <div className="agent-center-layout">
        <div className="agent-main-column">
          <div className="panel agent-task-panel">
            <div className="panel-title"><Sparkles size={16}/><strong>Assign a project task</strong></div>
            <textarea value={task} onChange={event => setTask(event.target.value)} rows={4} maxLength={4000} placeholder="Describe the outcome you want. Nova will plan, propose code, review QA strategy, and run a security review."/>
            <div className="agent-task-footer"><span>Only related, safe files are sent to the local API and local Ollama model.</span><button className="primary-button" disabled={busy || !task.trim()} onClick={() => void runTeam()}>{busy ? <><Activity size={14}/> Agents working…</> : <><Play size={14}/> Start supervised run</>}</button></div>
          </div>
          {currentRun && <div className="panel agent-run-panel">
            <div className="agent-run-heading"><div><div className="eyebrow"><span/> {statusLabel.toUpperCase()}</div><h2>{currentRun.task}</h2><span>{currentRun.project_name} · {new Date(currentRun.created_at).toLocaleString()}</span></div><button className="subtle-button" onClick={() => void loadRuns()}><RefreshCw size={13}/> Refresh</button></div>
            <div className="agent-timeline">{currentRun.events.map((event, index)=><article className={`agent-event ${event.status}`} key={`${event.created_at}-${index}`}><div className={`agent-event-icon ${event.agent}`}>{event.status === 'failed' ? <CircleAlert size={15}/> : event.agent === 'security' ? <ShieldCheck size={15}/> : event.agent === 'qa' ? <ClipboardList size={15}/> : event.agent === 'developer' ? <FileCode2 size={15}/> : <Bot size={15}/>}</div><div className="agent-event-content"><div><strong>{agents.find(agent => agent.id === event.agent)?.name || 'Nova Supervisor'}</strong><span>{event.status} · {new Date(event.created_at).toLocaleTimeString()}</span></div><pre>{event.message}</pre></div></article>)}</div>
            {!!commands.length && <div className="agent-test-approval"><div><Terminal size={15}/><div><strong>QA test execution</strong><span>Tests run only after OS-level approval.</span></div></div>{commands.map(command=><button className="subtle-button" key={command.id} disabled={busy} onClick={() => void runApprovedTest(command)}><Play size={12}/>{command.label}</button>)}</div>}
          </div>}
          {proposals.map(proposal=><article className="panel proposal-card agent-proposal" key={proposal.path}><div className="proposal-heading"><div><strong>{proposal.path}</strong><span>{proposal.summary}</span></div><button className="subtle-button" disabled={busy} onClick={() => void rejectProposal(proposal)}><X size={13}/> Reject</button></div><div className="proposal-diff"><div><strong>Before</strong><pre>{proposal.original_content}</pre></div><div><strong>After</strong><pre>{proposal.proposed_content}</pre></div></div><button className="primary-button" disabled={busy} onClick={() => void applyProposal(proposal)}><Check size={14}/> Approve, back up & apply</button></article>)}
        </div>
        <aside className="panel agent-history"><div className="panel-title"><RefreshCw size={15}/><strong>Task history</strong><span>{runs.length}</span></div>{runs.map(run=><button className={`agent-history-item ${currentRun?.id === run.id ? 'selected' : ''}`} key={run.id} onClick={() => void selectRun(run)}><span className={`agent-history-status ${run.status}`}/><span><strong>{run.task}</strong><small>{run.project_name} · {new Date(run.created_at).toLocaleDateString()}</small></span></button>)}{!runs.length&&<div className="empty-panel">Agent runs and event logs stay in the local Nova database.</div>}</aside>
      </div>
    </>}
    {error&&<div className="project-error">{error}<button onClick={()=>setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
  </section>
}
