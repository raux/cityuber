import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 4190)
const host = process.env.HOST || '127.0.0.1'
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const algorithms = new Set(['nearest', 'oldest', 'accessibility', 'energy'])
const chatSessions = new Map()
const modelRuntime = await ModelRuntime.create()
const availableModels = await modelRuntime.getAvailable()
const requestedModel = process.env.CITYUBER_PI_MODEL
const chatModel = availableModels.find((model) => `${model.provider}/${model.id}` === requestedModel)
  ?? availableModels.find((model) => model.provider === 'lmstudio' && model.id === 'google/gemma-4-e2b')
  ?? availableModels.find((model) => model.provider === 'lmstudio' && model.id.includes('gemma'))
  ?? availableModels.find((model) => model.provider === 'lmstudio')
  ?? availableModels.find((model) => model.provider === 'openai-codex')
  ?? availableModels.find((model) => model.provider === 'github-copilot')
  ?? availableModels[0]
if (!chatModel) throw new Error('No authenticated Pi model is available for CityUber chat.')
const chatSystemPrompt = `You are the CityUber Pi fleet agent inside a competitive transport game.
You can hold normal, friendly conversations and explain game state, strategy, traffic, scoring, and the human fleet.
You may also control only human vehicles through validated actions.

Allowed actions:
- {"type":"dispatch","vehicleId":"human vehicle id","stopId":"stop id"}
- {"type":"set_algorithm","vehicleId":"human vehicle id","algorithm":"nearest|oldest|accessibility|energy"}

Algorithm meanings:
- nearest: serve the closest suitable passenger call
- oldest: prioritize the longest-waiting call
- accessibility: prioritize accessibility and priority calls
- energy: prefer high passenger yield per travel step

Always respond as one strict JSON object with no Markdown fences:
{"reply":"natural conversational response","actions":[]}
Use zero or more actions only when the player clearly asks for a control change. Never control AI vehicles. Never invent vehicle or stop ids. Keep replies concise.`

const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => chatSystemPrompt,
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 })
  }
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? '')
  return /^[a-zA-Z0-9-]{8,80}$/.test(sessionId) ? sessionId : null
}

async function createChatSession() {
  const { session } = await createAgentSession({
    cwd: root,
    model: chatModel,
    thinkingLevel: 'off',
    modelRuntime,
    resourceLoader,
    noTools: 'all',
    sessionManager: SessionManager.inMemory(root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
  })
  return { session, busy: false, lastUsed: Date.now() }
}

async function getChatSession(sessionId) {
  let entry = chatSessions.get(sessionId)
  if (entry) return entry
  if (chatSessions.size >= 12) {
    const oldest = [...chatSessions.entries()]
      .filter(([, candidate]) => !candidate.busy)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
    if (oldest) {
      oldest[1].session.dispose()
      chatSessions.delete(oldest[0])
    }
  }
  entry = await createChatSession()
  chatSessions.set(sessionId, entry)
  return entry
}

function gamePrompt(message, state) {
  return `CURRENT GAME STATE (authoritative for this turn):\n${JSON.stringify(state)}\n\nPLAYER MESSAGE:\n${message}`
}

function assistantText(messages) {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'assistant')
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('')
  }
  return ''
}

function parseAgentJson(text) {
  const trimmed = String(text ?? '').trim()
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const candidates = [withoutFence]
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(withoutFence.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }
  return { reply: trimmed || 'I could not form a response.', actions: [] }
}

function validateActions(rawActions, state) {
  if (!Array.isArray(rawActions)) return []
  const humans = Array.isArray(state?.humanVehicles) ? state.humanVehicles : []
  const stops = Array.isArray(state?.stops) ? state.stops : []
  const vehicleLookup = new Map()
  for (const vehicle of humans) {
    for (const key of [vehicle.id, vehicle.label, vehicle.name]) {
      if (key) vehicleLookup.set(String(key).toLowerCase(), vehicle.id)
    }
  }
  const stopLookup = new Map()
  for (const stop of stops) {
    for (const key of [stop.id, stop.name]) {
      if (key) stopLookup.set(String(key).toLowerCase(), stop.id)
    }
  }

  const actions = []
  for (const raw of rawActions.slice(0, 4)) {
    if (!raw || typeof raw !== 'object') continue
    const vehicleId = vehicleLookup.get(String(raw.vehicleId ?? '').toLowerCase())
    if (!vehicleId) continue
    if (raw.type === 'set_algorithm' && algorithms.has(raw.algorithm)) {
      actions.push({ type: 'set_algorithm', vehicleId, algorithm: raw.algorithm })
    }
    if (raw.type === 'dispatch') {
      const stopId = stopLookup.get(String(raw.stopId ?? '').toLowerCase())
      if (stopId) actions.push({ type: 'dispatch', vehicleId, stopId })
    }
  }
  return actions
}

async function handleChat(request, response) {
  try {
    const body = await readJson(request)
    const sessionId = normalizeSessionId(body.sessionId)
    const message = String(body.message ?? '').trim()
    const state = body.state && typeof body.state === 'object' ? body.state : {}
    if (!sessionId) return jsonResponse(response, 400, { error: 'Invalid chat session id.' })
    if (!message || message.length > 1200) return jsonResponse(response, 400, { error: 'Message must contain 1–1200 characters.' })

    const entry = await getChatSession(sessionId)
    if (entry.busy) return jsonResponse(response, 409, { error: 'Pi is still answering the previous message.' })
    entry.busy = true
    entry.lastUsed = Date.now()
    let output = ''
    const unsubscribe = entry.session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        output += event.assistantMessageEvent.delta
      }
    })
    try {
      await entry.session.prompt(gamePrompt(message, state))
    } finally {
      unsubscribe()
      entry.busy = false
      entry.lastUsed = Date.now()
    }

    const lastAssistant = [...entry.session.messages].reverse().find((message) => message.role === 'assistant')
    if (lastAssistant?.stopReason === 'error') throw new Error(lastAssistant.errorMessage || 'The Pi model request failed.')
    if (!output) output = assistantText(entry.session.messages)
    const parsed = parseAgentJson(output)
    const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 4000) : output.slice(0, 4000)
    const actions = validateActions(parsed.actions, state)
    return jsonResponse(response, 200, { reply: reply || 'Done.', actions })
  } catch (error) {
    console.error('CityUber Pi chat error:', error.message)
    return jsonResponse(response, error.statusCode ?? 503, {
      error: error.statusCode ? error.message : 'Pi chat is unavailable. Check the server-side Pi model authentication.',
    })
  }
}

const server = createServer(async (request, response) => {
  if (request.url === '/api/chat') {
    if (request.method !== 'POST') return jsonResponse(response, 405, { error: 'Method not allowed.' })
    await handleChat(request, response)
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }

  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname)
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '')
  const candidate = join(root, relative)
  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(candidate)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(candidate).pipe(response)
})

server.listen(port, host, () => {
  console.log(`CityUber is running at http://${host}:${port}/`)
  console.log(`CityUber Pi chat model: ${chatModel.provider}/${chatModel.id}`)
})

function shutdown() {
  for (const { session } of chatSessions.values()) session.dispose()
  server.close()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
