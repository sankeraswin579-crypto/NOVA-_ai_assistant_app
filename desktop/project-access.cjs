const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const extensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java',
  '.ini', '.js', '.jsx', '.json', '.md', '.mod', '.mjs', '.py', '.rs', '.sh', '.sql', '.toml',
  '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml'
])
const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', '.venv', 'build', 'coverage', 'dist', 'node_modules',
  'out', 'target', 'vendor', '__pycache__'
])
const sensitiveName = /(secret|credential|token|password|private[._ -]?key|\.pem$|\.p12$|\.pfx$)/i
const sensitiveValuePatterns = [
  /-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END (?:(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g,
  /(^|[,{]\s*)(?:(?:export\s+)?(?:const|let|var)\s+)?(["']?(?:process\.env\.)?[A-Za-z0-9_.-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTHORIZATION)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,}]+)/gim,
  /^(\s*["']?(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|HOME|NOVA_[A-Z0-9_]+|OLLAMA_[A-Z0-9_]+)["']?\s*[:=]\s*)[^\r\n]+/gim,
  /\b(?:sk[-_](?:live|test)?[-_]?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
  /(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
]

function sanitizeContent(content) {
  let sanitized = content
  for (const pattern of sensitiveValuePatterns) sanitized = sanitized.replace(pattern, (...matches) => {
    const match = matches[0]
    if (pattern === sensitiveValuePatterns[1]) return `${matches[1]}${matches[2]}"[REDACTED]"`
    if (pattern === sensitiveValuePatterns[4]) return match.replace(/(Bearer\s+).+/i, '$1[REDACTED]')
    if (pattern === sensitiveValuePatterns[5]) return match.replace(/\/\/[^/]+@/, '//[REDACTED]@')
    return '[REDACTED]'
  })
  return { content: sanitized, containsSensitiveData: sanitized !== content }
}

function isAllowedDirectory(relativePath) {
  return relativePath.split(/[\\/]/).every(segment =>
    segment && !ignoredDirectories.has(segment.toLowerCase()) &&
    !segment.toLowerCase().startsWith('.env') && !sensitiveName.test(segment)
  )
}

function isAllowedFile(relativePath) {
  const segments = relativePath.split(/[\\/]/)
  const filename = path.posix.basename(relativePath.replace(/\\/g, '/')).toLowerCase()
  return (
    (segments.length === 1 || isAllowedDirectory(segments.slice(0, -1).join(path.sep))) &&
    !filename.startsWith('.env') &&
    !sensitiveName.test(filename) &&
    !/(^|[-.])(lock|lockfile)([-.]|$)/i.test(filename) &&
    extensions.has(path.extname(filename))
  )
}

function resolveProjectPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('Invalid project file path.')
  }
  const segments = relativePath.split(/[\\/]/)
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('Project file path traversal is not allowed.')
  }
  const absolutePath = path.resolve(root, ...segments)
  const relative = path.relative(root, absolutePath)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Project file must stay inside the selected folder.')
  }
  if (!isAllowedFile(relative)) throw new Error('Unsupported or sensitive project file.')
  return absolutePath
}

async function assertRegularProjectFile(root, relativePath) {
  const absolutePath = resolveProjectPath(root, relativePath)
  let current = root
  for (const segment of relativePath.split(/[\\/]/)) {
    current = path.join(current, segment)
    const component = await fs.promises.lstat(current)
    if (component.isSymbolicLink()) throw new Error('Symbolic links are not allowed in project files.')
  }
  const rootRealPath = await fs.promises.realpath(root)
  const fileRealPath = await fs.promises.realpath(absolutePath)
  const relativeRealPath = path.relative(rootRealPath, fileRealPath)
  if (!relativeRealPath || relativeRealPath.startsWith(`..${path.sep}`) || relativeRealPath === '..' || path.isAbsolute(relativeRealPath)) {
    throw new Error('Project file must stay inside the selected folder.')
  }
  const metadata = await fs.promises.lstat(absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 20000) {
    throw new Error('Project files must be regular files smaller than 20 KB.')
  }
  return { absolutePath, relativePath: relativeRealPath }
}

async function scanProject(root) {
  const files = []
  let directoriesVisited = 0
  async function collect(directory, depth) {
    if (depth > 10 || files.length >= 1000 || directoriesVisited >= 2000) return
    directoriesVisited += 1
    const entries = []
    const handle = await fs.promises.opendir(directory)
    for await (const entry of handle) {
      entries.push(entry)
      if (entries.length >= 5000) break
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.length >= 1000) break
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath)
      if (entry.isDirectory()) {
        if (isAllowedDirectory(relativePath)) await collect(absolutePath, depth + 1)
      } else if (entry.isFile() && isAllowedFile(relativePath)) {
        files.push(relativePath.split(path.sep).join('/'))
      }
    }
  }
  await collect(root, 0)
  return { name: path.basename(root), files }
}

async function readProjectFiles(root, paths, { maxFiles = 8, maxCharacters = 40000 } = {}) {
  if (!Array.isArray(paths) || paths.length > maxFiles) {
    throw new Error(`Select no more than ${maxFiles} project files.`)
  }
  const files = []
  let totalCharacters = 0
  for (const relativePath of paths) {
    const { absolutePath, relativePath: safePath } = await assertRegularProjectFile(root, relativePath)
    const rawContent = await fs.promises.readFile(absolutePath, 'utf8')
    const sanitized = sanitizeContent(rawContent)
    const truncated = sanitized.content.slice(0, Math.min(10000, maxCharacters - totalCharacters))
    totalCharacters += truncated.length
    if (totalCharacters > maxCharacters) throw new Error('Selected project files exceed the context limit.')
    files.push({
      path: safePath.split(path.sep).join('/'),
      content: truncated,
      containsSensitiveData: sanitized.containsSensitiveData,
      truncated: truncated.length < sanitized.content.length,
    })
  }
  return files
}

function searchScore(query, relativePath, content) {
  const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length > 1))]
  const filename = relativePath.toLowerCase()
  const body = content.toLowerCase()
  return terms.reduce((score, term) => {
    const fileHits = filename.split(term).length - 1
    const bodyHits = body.split(term).length - 1
    return score + fileHits * 5 + Math.min(bodyHits, 10)
  }, 0)
}

async function searchProjectFiles(root, files, query) {
  if (typeof query !== 'string' || !query.trim()) return []
  const matches = []
  for (const relativePath of files.slice(0, 1000)) {
    if (!isAllowedFile(relativePath)) continue
    try {
      const { absolutePath } = await assertRegularProjectFile(root, relativePath)
      const { content } = sanitizeContent(await fs.promises.readFile(absolutePath, 'utf8'))
      const score = searchScore(query, relativePath, content)
      if (score > 0) {
        const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length > 1)
        const lowerContent = content.toLowerCase()
        const positions = terms.map(term=>lowerContent.indexOf(term)).filter(index=>index>=0)
        const index = positions.length ? Math.min(...positions) : -1
        const start = index < 0 ? 0 : Math.max(0, index - 120)
        matches.push({
          path: relativePath,
          score,
          snippet: content.slice(start, start + 320).replace(/\s+/g, ' ').trim(),
        })
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 100)
}

function importPaths(content) {
  const imports = new Set()
  const patterns = [
    /(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g,
    /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+/gm,
    /^\s*from\s+(\.+[a-zA-Z_][\w.]*)\s+import\s+/gm,
    /^\s*import\s+([a-zA-Z_][\w.]*)/gm,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) imports.add(match[1])
  }
  return [...imports]
}

function relatedProjectPaths(files, selectedPath, availablePaths = files.map(file => file.path)) {
  const normalized = selectedPath.replace(/\\/g, '/')
  const directory = path.posix.dirname(normalized)
  const related = new Set([normalized])
  const selected = files.find(file => file.path.replace(/\\/g, '/') === normalized)
  if (!selected) return []
  const available = new Set(availablePaths.map(file => file.replace(/\\/g, '/')))
  for (const imported of importPaths(selected.content)) {
    let base
    if (imported.startsWith('.')) {
      const dots = imported.match(/^\.+/)[0].length
      const modulePath = imported.slice(dots).replace(/\./g, '/')
      base = path.posix.normalize(path.posix.join(directory, '../'.repeat(Math.max(0, dots - 1)), modulePath))
    } else {
      base = imported.replace(/\./g, '/')
    }
    for (const candidate of [base, ...['.ts', '.tsx', '.js', '.jsx', '.py', '.json'].map(ext => `${base}${ext}`), ...['index.ts', 'index.tsx', 'index.js', 'index.jsx', '__init__.py'].map(name => `${base}/${name}`)]) {
      if (available.has(candidate)) { related.add(candidate); break }
    }
  }
  return [...related]
}

async function retrieveRelevantFiles(root, paths, query, selectedPaths = []) {
  const queryMatches = await searchProjectFiles(root, paths, query)
  const selectedFiles = await readProjectFiles(root, selectedPaths.slice(0, 4), { maxFiles: 4, maxCharacters: 20000 })
  const matchingFiles = await readProjectFiles(root, queryMatches.slice(0, 8).map(match => match.path), { maxFiles: 8, maxCharacters: 30000 })
  const seeds = [...selectedFiles, ...matchingFiles]
  const selectedRelated = selectedFiles.flatMap(file => relatedProjectPaths(seeds, file.path, paths))
  const matchingRelated = matchingFiles.flatMap(file => relatedProjectPaths(seeds, file.path, paths))
  const chosen = [...new Set([
    ...selectedFiles.map(file => file.path),
    ...selectedRelated,
    ...matchingFiles.slice(0, 4).map(file => file.path),
    ...matchingRelated,
  ])].slice(0, 8)
  return readProjectFiles(root, chosen, { maxFiles: 8, maxCharacters: 40000 })
}

async function validateProposedChange(root, change) {
  if (!change || typeof change !== 'object' ||
      typeof change.path !== 'string' ||
      typeof change.originalContent !== 'string' ||
      change.originalContent.length > 20000 ||
      typeof change.proposedContent !== 'string' ||
      change.proposedContent.length > 200000) {
    throw new Error('Invalid proposed file change.')
  }
  if (sanitizeContent(change.proposedContent).containsSensitiveData) {
    throw new Error('Proposed content contains sensitive values.')
  }
  const { absolutePath, relativePath } = await assertRegularProjectFile(root, change.path)
  const currentContent = await fs.promises.readFile(absolutePath, 'utf8')
  if (sanitizeContent(currentContent).containsSensitiveData) {
    throw new Error('Files containing sensitive values cannot be modified by a proposal.')
  }
  if (currentContent !== change.originalContent) throw new Error('File changed since the proposal; refresh before applying.')
  return { absolutePath, relativePath }
}

async function ensureSafeBackupDirectory(backupRoot, targetDirectory) {
  const base = path.resolve(backupRoot)
  const destination = path.resolve(targetDirectory)
  const relative = path.relative(base, destination)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Backup path must stay inside the application backup folder.')
  }
  await fs.promises.mkdir(base, { recursive: true })
  const baseMetadata = await fs.promises.lstat(base)
  if (!baseMetadata.isDirectory() || baseMetadata.isSymbolicLink()) {
    throw new Error('Backup folder must be a regular directory.')
  }
  let current = base
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      await fs.promises.mkdir(current)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const metadata = await fs.promises.lstat(current)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Backup path cannot contain symbolic links.')
    }
  }
}

async function applyApprovedChange(root, backupRoot, change, approved) {
  if (approved !== true) throw new Error('File changes require explicit approval.')
  const { absolutePath, relativePath } = await validateProposedChange(root, change)
  const backupPath = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'), ...relativePath.split(path.sep))
  await ensureSafeBackupDirectory(backupRoot, path.dirname(backupPath))
  await fs.promises.copyFile(absolutePath, backupPath, fs.constants.COPYFILE_EXCL)
  if (await fs.promises.readFile(backupPath, 'utf8') !== change.originalContent) {
    throw new Error('File changed while its backup was being created; no changes were applied.')
  }
  const temporaryPath = `${absolutePath}.nova-${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(temporaryPath, change.proposedContent, { encoding: 'utf8', flag: 'wx' })
    await validateProposedChange(root, change)
    await fs.promises.rename(temporaryPath, absolutePath)
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true })
    throw error
  }
  return { path: relativePath.split(path.sep).join('/'), backupPath }
}

function detectTestCommands(root, projectFiles) {
  const basenames = new Set(projectFiles.map(file => path.posix.basename(file).toLowerCase()))
  const commands = []
  if (basenames.has('package.json') && fs.existsSync(path.join(root, 'package.json'))) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
      if (manifest.scripts && typeof manifest.scripts.test === 'string') {
        commands.push({ id: 'npm-test', label: 'npm test', executable: 'npm', args: ['test'] })
      }
    } catch {}
  }
  if (basenames.has('pyproject.toml') || basenames.has('pytest.ini') || projectFiles.some(file => /(^|\/)tests?\/.*\.py$/i.test(file))) {
    commands.push({ id: 'python-pytest', label: 'python -m pytest -q', executable: 'python', args: ['-m', 'pytest', '-q'] })
  }
  if (basenames.has('cargo.toml')) commands.push({ id: 'cargo-test', label: 'cargo test', executable: 'cargo', args: ['test'] })
  if (basenames.has('go.mod')) commands.push({ id: 'go-test', label: 'go test ./...', executable: 'go', args: ['test', './...'] })
  return commands
}

function approvedTestCommand(commands, commandId, approved) {
  if (approved !== true) throw new Error('Test execution requires explicit approval.')
  const command = commands.find(candidate => candidate.id === commandId)
  if (!command) throw new Error('Unknown or no longer available test command.')
  return command
}

function testEnvironment(environment) {
  const allowed = new Set([
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  ])
  return Object.fromEntries(Object.entries(environment).filter(([name]) =>
    allowed.has(name.toUpperCase()) && !/(SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i.test(name)
  ))
}

module.exports = {
  applyApprovedChange,
  approvedTestCommand,
  detectTestCommands,
  isAllowedFile,
  readProjectFiles,
  relatedProjectPaths,
  resolveProjectPath,
  scanProject,
  sanitizeContent,
  searchProjectFiles,
  testEnvironment,
  validateProposedChange,
  retrieveRelevantFiles,
}
