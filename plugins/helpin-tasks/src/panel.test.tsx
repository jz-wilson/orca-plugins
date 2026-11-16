import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const TASKS = [
  { key: 'ABC-9', id: 'i9', name: 'Urgent thing', state: 'Todo', priority: 'urgent' },
  { key: 'ABC-2', id: 'i2', name: 'Later thing', state: 'In Progress', priority: 'low' }
]

test('an unconfigured panel asks for the URL and token and never shows a token', async () => {
  const host = mockHost({
    requests: {
      'config.get': { serverUrl: '', hasToken: false, keyPrefix: '' },
      'projects.list': { ok: true, projects: [] }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: /Connect to Helpin/ }) !== undefined, true)
  assert.equal(view.find({ text: 'Save' }) !== undefined, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('lists tasks, starts the picked one in the chosen project, and reports the result', async () => {
  const started: unknown[] = []
  const host = mockHost({
    requests: {
      'config.get': { serverUrl: 'https://helpin.example.com/mcp', hasToken: true, keyPrefix: 'ABC-' },
      'projects.list': { ok: true, projects: [{ id: 'p1', name: 'repo' }] },
      'tasks.list': { ok: true, tasks: TASKS, fetchedAt: Date.now() },
      'task.start': (input) => {
        started.push(input)
        return { ok: true, workspaceId: 'w1' }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: /ABC-9/ }) !== undefined, true)
  assert.equal(view.find({ text: /ABC-2/ }) !== undefined, true)

  // Nothing starts until a task is picked and Start is pressed.
  assert.deepEqual(started, [])
  await view.press({ text: /ABC-9/ })
  await view.press({ text: 'Start ABC-9' })
  assert.deepEqual(started, [{ task: TASKS[0], projectId: 'p1' }])
  assert.equal(view.find({ text: /Started ABC-9/ }) !== undefined, true)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('a failed load shows the worker message', async () => {
  const host = mockHost({
    requests: {
      'config.get': { serverUrl: 'https://helpin.example.com/mcp', hasToken: true, keyPrefix: '' },
      'projects.list': { ok: true, projects: [{ id: 'p1', name: 'repo' }] },
      'tasks.list': { ok: false, error: 'Helpin rejected the token' }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: /Helpin rejected the token/ }) !== undefined, true)
  await view.unmount()
})
