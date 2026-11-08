const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const access = require('../project-access.cjs')
const { assertProjectId, isTrustedRenderer } = require('../electron-security.cjs')

async function withProject(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-project-'))
  try {
    await run(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('rejects project path traversal using either path separator', async () => {
  await withProject(async root => {
    assert.throws(() => access.resolveProjectPath(root, '../outside.ts'), /traversal/)
    assert.throws(() => access.resolveProjectPath(root, '..\\outside.ts'), /traversal/)
    assert.throws(() => access.resolveProjectPath(root, path.join(root, 'outside.ts')), /Invalid/)
  })
})

test('project scan and reads exclude sensitive filenames and redact secret values', async () => {
  await withProject(async root => {
    await fs.mkdir(path.join(root, 'src'))
    await fs.mkdir(path.join(root, 'credentials'))
    await fs.writeFile(path.join(root, '.env'), 'TOKEN=hidden')
    await fs.writeFile(path.join(root, 'credentials', 'keys.ts'), 'export const token = "hidden-value"')
    await fs.writeFile(path.join(root, 'src', 'config.ts'), 'export const API_KEY = "private-value"\nexport const mode = "local"')
    const project = await access.scanProject(root)
    assert.deepEqual(project.files, ['src/config.ts'])
    const [file] = await access.readProjectFiles(root, project.files)
    assert.match(file.content, /\[REDACTED\]/)
    assert.doesNotMatch(file.content, /private-value/)
    assert.equal(file.containsSensitiveData, true)
  })
})

test('redacts environment values, bearer credentials, and private-key blocks from content', () => {
  const raw = [
    'PATH=C:\\Users\\person\\bin',
    'Authorization: Bearer abcdef123',
    '-----BEGIN PRIVATE KEY-----',
    'private-key-material',
    '-----END PRIVATE KEY-----',
    'AIza012345678901234567890123456789012',
  ].join('\n')
  const result = access.sanitizeContent(raw)
  assert.equal(result.containsSensitiveData, true)
  assert.doesNotMatch(result.content, /person|abcdef123|private-key-material|AIza/)
  const json = access.sanitizeContent('{"apiKey": "credential-value"}')
  assert.doesNotMatch(json.content, /credential-value/)
  assert.match(json.content, /\[REDACTED\]/)
})

test('refuses symlink reads when the platform permits creating a symlink', async t => {
  await withProject(async root => {
    const external = path.join(path.dirname(root), `nova-outside-${Date.now()}.ts`)
    const link = path.join(root, 'linked.ts')
    await fs.writeFile(external, 'outside project')
    try {
      await fs.symlink(external, link)
    } catch (error) {
      await fs.rm(external, { force: true })
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Symlink creation is not permitted.')
      throw error
    }
    try {
      await assert.rejects(access.readProjectFiles(root, ['linked.ts']), /Symbolic links/)
    } finally {
      await fs.rm(external, { force: true })
    }
  })
})

test('rejects symlinks and unauthorized file writes', async () => {
  await withProject(async root => {
    const sourcePath = path.join(root, 'source.ts')
    await fs.writeFile(sourcePath, 'const value = 1')
    const change = { path: 'source.ts', originalContent: 'const value = 1', proposedContent: 'const value = 2' }
    await assert.rejects(access.applyApprovedChange(root, path.join(root, 'backups'), change, false), /explicit approval/)
    assert.equal(await fs.readFile(sourcePath, 'utf8'), 'const value = 1')
    await assert.rejects(access.applyApprovedChange(root, path.join(root, 'backups'), {
      ...change, path: '../source.ts',
    }, true), /traversal/)
  })
})

test('approved changes create backups and refuse stale file contents', async () => {
  await withProject(async root => {
    const sourcePath = path.join(root, 'source.ts')
    const backupRoot = path.join(root, 'backups')
    await fs.writeFile(sourcePath, 'const value = 1')
    const result = await access.applyApprovedChange(root, backupRoot, {
      path: 'source.ts',
      originalContent: 'const value = 1',
      proposedContent: 'const value = 2',
    }, true)
    assert.equal(await fs.readFile(sourcePath, 'utf8'), 'const value = 2')
    assert.equal(await fs.readFile(result.backupPath, 'utf8'), 'const value = 1')
    await assert.rejects(access.applyApprovedChange(root, backupRoot, {
      path: 'source.ts',
      originalContent: 'const value = 1',
      proposedContent: 'const value = 3',
    }, true), /changed since the proposal/)
  })
})

test('proposed content containing credentials cannot be applied', async () => {
  await withProject(async root => {
    const sourcePath = path.join(root, 'source.ts')
    await fs.writeFile(sourcePath, 'const value = 1')
    await assert.rejects(access.applyApprovedChange(root, path.join(root, 'backups'), {
      path: 'source.ts',
      originalContent: 'const value = 1',
      proposedContent: 'export const API_KEY = "credential-value"',
    }, true), /sensitive values/)
  })
})

test('retrieves imported files as related project context', async () => {
  await withProject(async root => {
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, 'src', 'main.ts'), "import { run } from './helper'\nrun()")
    await fs.writeFile(path.join(root, 'src', 'helper.ts'), 'export function run() { return "ready" }')
    const project = await access.scanProject(root)
    const context = await access.retrieveRelevantFiles(root, project.files, 'main', [])
    assert.deepEqual(context.map(file=>file.path), ['src/main.ts', 'src/helper.ts'])
  })
})

test('resolves Python relative imports for related project context', () => {
  const related = access.relatedProjectPaths([
    { path: 'package/main.py', content: 'from .helper import run\nrun()' },
  ], 'package/main.py', ['package/main.py', 'package/helper.py'])
  assert.deepEqual(related, ['package/main.py', 'package/helper.py'])
})

test('test commands require approval and are selected from a fixed allowlist', async () => {
  await withProject(async root => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }))
    const commands = access.detectTestCommands(root, ['package.json'])
    assert.throws(() => access.approvedTestCommand(commands, 'npm-test', false), /explicit approval/)
    assert.throws(() => access.approvedTestCommand(commands, 'run-arbitrary-command', true), /Unknown/)
    assert.deepEqual(access.approvedTestCommand(commands, 'npm-test', true), {
      id: 'npm-test', label: 'npm test', executable: 'npm', args: ['test'],
    })
  })

  test('test processes inherit only a minimal non-secret environment allowlist', () => {
    const env = access.testEnvironment({
      PATH: 'C:\\Tools',
      SystemRoot: 'C:\\Windows',
      NOVA_DATABASE_URL: 'sqlite:///private.db',
      OLLAMA_API_KEY: 'secret',
      API_TOKEN: 'secret',
    })
    assert.equal(env.PATH, 'C:\\Tools')
    assert.equal(env.SystemRoot, 'C:\\Windows')
    assert.equal(env.NOVA_DATABASE_URL, undefined)
    assert.equal(env.OLLAMA_API_KEY, undefined)
    assert.equal(env.API_TOKEN, undefined)
  })
})

test('project IPC rejects an untrusted renderer and subframe', () => {
  const mainFrame = { url: 'http://127.0.0.1:5173/' }
  const sender = { mainFrame }
  const window = { webContents: sender }
  assert.equal(isTrustedRenderer(sender, mainFrame, window, true), true)
  assert.equal(isTrustedRenderer({ mainFrame }, mainFrame, window, true), false)
  assert.equal(isTrustedRenderer(sender, { url: 'http://127.0.0.1:5173/frame' }, window, true), false)
  assert.equal(isTrustedRenderer(sender, { ...mainFrame, url: 'https://evil.example' }, window, true), false)
  assert.throws(()=>assertProjectId('project-a','project-b'),/project changed/)
  assert.doesNotThrow(()=>assertProjectId('project-a','project-a'))
})
