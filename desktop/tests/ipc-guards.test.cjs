const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Every IPC handler in main.cjs must prove the caller is the Nova renderer before it does
// anything. `nova:get-api-url` and `nova:set-api-url` used to skip that check, which let a
// compromised renderer repoint the app at an attacker-controlled API. This test keeps the
// rule enforced for handlers added later.
const MAIN_PATH = path.join(__dirname, '..', 'main.cjs')
const GUARDS = ['assertTrustedRenderer(', 'guardProjectAction(']

function registeredHandlers(source) {
  const handlers = []
  const marker = 'ipcMain.handle('
  let index = source.indexOf(marker)
  while (index !== -1) {
    const next = source.indexOf(marker, index + marker.length)
    const block = source.slice(index, next === -1 ? source.length : next)
    const channel = block.slice(marker.length).match(/^['"]([^'"]+)['"]/)
    handlers.push({ channel: channel ? channel[1] : '<unparsed>', block })
    index = next
  }
  return handlers
}

test('every IPC handler asserts a trusted renderer', () => {
  const source = fs.readFileSync(MAIN_PATH, 'utf8')
  const handlers = registeredHandlers(source)
  assert.ok(handlers.length >= 10, `expected the IPC surface to be discovered, found ${handlers.length}`)
  const unguarded = handlers
    .filter(handler => !GUARDS.some(guard => handler.block.includes(guard)))
    .map(handler => handler.channel)
  assert.deepEqual(unguarded, [], `IPC handlers missing a trusted-renderer guard: ${unguarded.join(', ')}`)
})

test('the API URL handlers are registered and guarded', () => {
  const source = fs.readFileSync(MAIN_PATH, 'utf8')
  const handlers = registeredHandlers(source)
  for (const channel of ['nova:get-api-url', 'nova:set-api-url']) {
    const handler = handlers.find(candidate => candidate.channel === channel)
    assert.ok(handler, `${channel} is not registered`)
    assert.ok(
      handler.block.includes('assertTrustedRenderer('),
      `${channel} must call assertTrustedRenderer`,
    )
  }
})
