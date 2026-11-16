// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Heading,
  IconButton,
  Input,
  List,
  ListItem,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { Project, Task } from './protocol'

type Config = { serverUrl: string; hasToken: boolean; keyPrefix: string }

const config = atom<Config | null>(null)
const tasks = atom<Task[]>([])
const fetchedAt = atom<number | null>(null)
const projects = atom<Project[]>([])
const selectedKey = atom<string | null>(null)
/** Remembered across panel runs. */
const projectId = atom('projectId', '', { persist: 'plugin' })
const busy = atom<string | null>(null)
const notice = atom<{ tone: 'danger' | 'success'; text: string } | null>(null)
const editing = atom(false)
const urlDraft = atom('')
const tokenDraft = atom('')

async function loadTasks(): Promise<void> {
  set(busy, 'Loading tasks')
  set(notice, null)
  const answer = await plugin.request('tasks.list')
  set(busy, null)
  if (!answer.ok) return void set(notice, { tone: 'danger', text: answer.error })
  set(tasks, answer.tasks)
  set(fetchedAt, answer.fetchedAt)
}

async function loadAll(): Promise<void> {
  const current = await plugin.request('config.get')
  set(config, current)
  set(urlDraft, current.serverUrl)
  const found = await plugin.request('projects.list')
  if (found.ok) {
    set(projects, found.projects)
    if (!found.projects.some((p) => p.id === read(projectId))) set(projectId, found.projects[0]?.id ?? '')
  }
  if (current.serverUrl && current.hasToken) await loadTasks()
  else set(editing, true)
}

async function save(): Promise<void> {
  const answer = await plugin.request('config.save', { serverUrl: read(urlDraft), token: read(tokenDraft) })
  if (!answer.ok) return void set(notice, { tone: 'danger', text: answer.error })
  set(tokenDraft, '') // the token never stays in the panel
  set(editing, false)
  await loadAll()
}

async function start(task: Task): Promise<void> {
  set(busy, `Starting ${task.key}`)
  set(notice, null)
  const answer = await plugin.request('task.start', { task, projectId: read(projectId) })
  set(busy, null)
  set(notice, answer.ok ? { tone: 'success', text: `Started ${task.key} in a new workspace.` } : { tone: 'danger', text: answer.error })
}

/** Runs once before the first render; what it pushes to `subscriptions` ends with the panel. */
export function setup(_ctx: PanelContext): void {
  void loadAll()
}

function Setup() {
  const missing = read(config)
  return (
    <Stack gap="md">
      <Callout tone="accent" title="Connect to Helpin">
        The token is kept in Orca's secret store and sent only to the URL below.
      </Callout>
      <Field label="Helpin MCP URL" description="https only; http works for localhost.">
        <Input label="Helpin MCP URL" labelHidden value={read(urlDraft)} placeholder="https://…/mcp" onChange={(v) => set(urlDraft, v)} />
      </Field>
      <Field label="API token" description={missing?.hasToken ? 'A token is saved. Leave empty to keep it.' : undefined}>
        <Input label="API token" labelHidden type="password" value={read(tokenDraft)} onChange={(v) => set(tokenDraft, v)} />
      </Field>
      <Row gap="xs">
        <Button onPress={save}>Save</Button>
        {missing?.serverUrl && missing.hasToken ? (
          <Button variant="ghost" onPress={() => set(editing, false)}>
            Cancel
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

export default function Panel() {
  const state = read(busy)
  const list = read(tasks)
  const chosen = read(selectedKey)
  const picked = list.find((t) => t.key === chosen)
  const message = read(notice)
  const at = read(fetchedAt)

  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Helpin Tasks</Heading>
        <Row gap="xs">
          <IconButton icon="refresh" label="Refresh tasks" disabled={state !== null} onPress={loadAll} />
          <IconButton icon="settings" label="Connection settings" onPress={() => set(editing, !read(editing))} />
        </Row>
      </Row>

      {read(editing) ? <Setup /> : null}
      {message ? <Callout tone={message.tone}>{message.text}</Callout> : null}

      {!read(editing) ? (
        <Select
          label="Project"
          value={read(projectId)}
          placeholder="Choose a project"
          options={read(projects).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set(projectId, v)}
        />
      ) : null}

      {state ? <Spinner label={state} /> : null}

      {!read(editing) && !state && list.length === 0 && !message ? (
        <EmptyState title="No open tasks" description="Nothing matches the key prefix, or Helpin has no open tasks." />
      ) : null}

      {!read(editing) && list.length > 0 ? (
        <List label="Open tasks">
          {list.map((task) => (
            <ListItem
              key={task.key}
              title={`${task.key}  ${task.name}`}
              description={`${task.state || 'No state'} · ${task.priority}`}
              current={task.key === chosen}
              onPress={() => set(selectedKey, task.key)}
            />
          ))}
        </List>
      ) : null}

      {!read(editing) && list.length > 0 ? (
        <Row justify="between">
          <Button
            tone="accent"
            disabled={!picked || !read(projectId) || state !== null}
            tooltip="Creates a workspace on a new branch and starts the agent on this task"
            onPress={() => (picked ? start(picked) : undefined)}
          >
            {picked ? `Start ${picked.key}` : 'Pick a task'}
          </Button>
          {at ? (
            <Text muted size="xs">
              Updated <RelativeTime at={at} />
            </Text>
          ) : (
            <Badge>{list.length}</Badge>
          )}
        </Row>
      ) : null}
    </Stack>
  )
}
