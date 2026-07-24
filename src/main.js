import { CityUberSimulation, onboardCount } from './engine.js'
import { roadKey } from './routing.js'
import { createStrategy, defaultStrategyConfig } from './strategy.js'

const scenario = await fetch('/scenarios/morning-rush.json').then((response) => {
  if (!response.ok) throw new Error('Could not load the CityUber scenario.')
  return response.json()
})

let game = new CityUberSimulation(scenario, createStrategy(defaultStrategyConfig))
let selectedVehicleId = scenario.vehicles[0].id
let timer = null
let eventHistory = []

const elements = {
  map: document.querySelector('#city-map'),
  time: document.querySelector('#time-value'),
  duration: document.querySelector('#duration-value'),
  transported: document.querySelector('#transported-metric'),
  transportedGoal: document.querySelector('#transported-goal'),
  wait: document.querySelector('#wait-metric'),
  energy: document.querySelector('#energy-metric'),
  energyGoal: document.querySelector('#energy-goal'),
  score: document.querySelector('#score-metric'),
  vehicleList: document.querySelector('#vehicle-list'),
  stopPanel: document.querySelector('#stop-panel'),
  waitingList: document.querySelector('#waiting-list'),
  waitingCount: document.querySelector('#waiting-count'),
  eventLog: document.querySelector('#event-log'),
  accuracy: document.querySelector('#accuracy-note'),
  start: document.querySelector('#start-button'),
  pause: document.querySelector('#pause-button'),
  step: document.querySelector('#step-button'),
  reset: document.querySelector('#reset-button'),
  speed: document.querySelector('#speed-select'),
}

const colors = ['#f0ad4f', '#76b4a3', '#c784be', '#7da3d8']
const roadSet = new Set(scenario.roads.map(roadKey))

function point([x, y]) {
  return [70 + x * 88, 56 + y * 78]
}

function render() {
  const state = game.snapshot()
  renderMetrics(state)
  renderMap(state)
  renderVehicles(state)
  renderStops(state)
  renderWaiting(state)
  renderEvents()
  elements.time.textContent = state.time
  elements.duration.textContent = `/ ${state.scenario.duration}`
  elements.accuracy.textContent = state.scenario.accuracyNote
  elements.start.textContent = state.finished ? 'Finished' : timer ? 'Running…' : '▶ Run'
  elements.start.disabled = state.finished || Boolean(timer)
}

function renderMetrics(state) {
  elements.transported.textContent = state.metrics.transported
  elements.transportedGoal.textContent = `goal ${state.scenario.objectives.transported}`
  elements.wait.textContent = state.score.averageWait.toFixed(1)
  elements.energy.textContent = state.metrics.energy.toFixed(1)
  elements.energyGoal.textContent = `budget ${state.scenario.objectives.energy}`
  elements.score.textContent = Math.round(state.score.weightedScore)
}

function renderMap(state) {
  const roadLines = []
  for (const position of state.scenario.roads) {
    const [x, y] = position
    for (const neighbor of [[x + 1, y], [x, y + 1]]) {
      if (!roadSet.has(roadKey(neighbor))) continue
      const [x1, y1] = point(position)
      const [x2, y2] = point(neighbor)
      roadLines.push(`<line class="road" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="road-core" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
    }
  }

  const routes = state.vehicles.map((vehicle, index) => {
    if (!vehicle.route.length) return ''
    const positions = [vehicle.position, ...vehicle.route].map((position) => point(position).join(',')).join(' ')
    return `<polyline class="route" points="${positions}" style="stroke:${colors[index % colors.length]}"/>`
  }).join('')

  const traffic = Object.values(state.traffic).map((event) => {
    const [x, y] = point(event.position)
    return `<g><circle class="traffic-marker" cx="${x}" cy="${y}" r="17"/><text class="stop-count" x="${x}" y="${y + 3}">!</text></g>`
  }).join('')

  const waitingAtStop = new Map(state.waiting.map((request) => [request.from, (state.waiting.filter((item) => item.from === request.from).reduce((total, item) => total + item.remaining, 0))]))
  const stops = state.scenario.stops.map((stop, index) => {
    const [x, y] = point(stop.position)
    const count = waitingAtStop.get(stop.id) ?? 0
    const labelAnchor = index % 2 ? 'end' : 'start'
    const labelX = index % 2 ? x - 15 : x + 15
    return `<g data-stop="${escapeHtml(stop.id)}"><circle class="stop-halo" cx="${x}" cy="${y}" r="13"/><circle class="stop-core" cx="${x}" cy="${y}" r="8"/>${count ? `<circle cx="${x + 10}" cy="${y - 11}" r="9" fill="#db765f"/><text class="stop-count" x="${x + 10}" y="${y - 8}">${count}</text>` : ''}<text class="stop-label" x="${labelX}" y="${y - 15}" text-anchor="${labelAnchor}">${escapeHtml(stop.name)}</text></g>`
  }).join('')

  const vehicles = state.vehicles.map((vehicle, index) => {
    const [x, y] = point(vehicle.position)
    const count = onboardCount(vehicle)
    return `<g><circle class="vehicle-marker" cx="${x}" cy="${y}" r="12" fill="${colors[index % colors.length]}"/><text class="stop-count" x="${x}" y="${y + 3}">${count}</text><text class="vehicle-label" x="${x}" y="${y + 28}">${String.fromCharCode(65 + index)}</text></g>`
  }).join('')

  const corridors = (state.scenario.map?.corridors ?? []).map((corridor) => {
    const [x, y] = point(corridor.position)
    return `<text class="corridor-label" x="${x}" y="${y}">${escapeHtml(corridor.name)}</text>`
  }).join('')

  elements.map.innerHTML = `
    <rect width="850" height="600" rx="18" fill="#f8f8f2"/>
    <path class="coast" d="M0 390 C95 350 170 390 225 480 C260 535 300 575 360 600 H0 Z"/>
    <text x="28" y="555" fill="#6f9d9b" font-size="11" font-style="italic">Gulf of Papua</text>
    <g>${roadLines.join('')}</g>
    <g>${corridors}</g>
    <g>${routes}</g>
    <g>${traffic}</g>
    <g>${stops}</g>
    <g>${vehicles}</g>`
}

function renderVehicles(state) {
  elements.vehicleList.innerHTML = state.vehicles.map((vehicle, index) => {
    const target = state.scenario.stops.find((stop) => stop.id === vehicle.targetStopId)
    const current = state.scenario.stops.find((stop) => stop.id === vehicle.currentStopId)
    const location = target ? `to ${target.name}` : current ? `at ${current.name}` : 'moving'
    return `<button class="vehicle-card ${selectedVehicleId === vehicle.id ? 'selected' : ''}" data-vehicle="${escapeHtml(vehicle.id)}"><span class="vehicle-symbol" style="background:${colors[index % colors.length]}">↟</span><span><strong>${escapeHtml(vehicle.name)}</strong><small>${escapeHtml(vehicle.type)} · ${escapeHtml(location)}${vehicle.accessible ? ' · accessible' : ''}</small></span><span class="capacity"><strong>${onboardCount(vehicle)}/${vehicle.capacity}</strong><small>onboard</small></span></button>`
  }).join('')
  elements.vehicleList.querySelectorAll('[data-vehicle]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedVehicleId = button.dataset.vehicle
      render()
    })
  })
}

function renderStops(state) {
  const waitingCounts = Object.fromEntries(state.scenario.stops.map((stop) => [
    stop.id,
    state.waiting.filter((request) => request.from === stop.id).reduce((total, request) => total + request.remaining, 0),
  ]))
  elements.stopPanel.innerHTML = state.scenario.stops.map((stop) => `<button class="stop-button" data-dispatch="${escapeHtml(stop.id)}">${escapeHtml(stop.name)}<span>${waitingCounts[stop.id]}</span></button>`).join('')
  elements.stopPanel.querySelectorAll('[data-dispatch]').forEach((button) => {
    button.addEventListener('click', () => {
      const vehicle = state.vehicles.find((candidate) => candidate.id === selectedVehicleId)
      const stop = state.scenario.stops.find((candidate) => candidate.id === button.dataset.dispatch)
      if (game.dispatch(selectedVehicleId, button.dataset.dispatch)) {
        eventHistory.unshift({ time: game.time, text: `${vehicle.name} manually called to ${stop.name}` })
      }
      render()
    })
  })
}

function renderWaiting(state) {
  const total = state.waiting.reduce((sum, request) => sum + request.remaining, 0)
  elements.waitingCount.textContent = total
  if (!state.waiting.length) {
    elements.waitingList.innerHTML = '<div class="empty">No active floor calls.</div>'
    return
  }
  elements.waitingList.innerHTML = [...state.waiting]
    .sort((left, right) => right.waited - left.waited)
    .map((request) => {
      const from = state.scenario.stops.find((stop) => stop.id === request.from)?.name
      const to = state.scenario.stops.find((stop) => stop.id === request.to)?.name
      return `<article class="waiting-item"><span class="waiting-people">${request.remaining}</span><span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong><small>${escapeHtml(request.type)}${request.requiresAccessible ? ' · accessible' : ''}</small></span><span class="wait-time">${request.waited}t</span></article>`
    }).join('')
}

function recordEvents(state) {
  const newEvents = state.events.filter((event) => event.type !== 'move').map((event) => ({
    time: state.time,
    text: describeEvent(event, state),
  }))
  eventHistory = [...newEvents.reverse(), ...eventHistory].slice(0, 30)
}

function renderEvents() {
  elements.eventLog.innerHTML = eventHistory.length
    ? eventHistory.map((event) => `<span class="event-chip"><strong>${event.time}t</strong>${escapeHtml(event.text)}</span>`).join('')
    : '<span class="event-chip">Run or step the simulation to see activity.</span>'
}

function describeEvent(event, state) {
  const vehicle = state.vehicles.find((candidate) => candidate.id === event.vehicleId)
  const stop = state.scenario.stops.find((candidate) => candidate.id === event.stopId)
  if (event.type === 'call') return `${event.count} people called at ${stop?.name ?? event.stopId}`
  if (event.type === 'board') return `${event.count} boarded ${vehicle?.name ?? event.vehicleId} at ${stop?.name}`
  if (event.type === 'exit') return `${event.count} exited ${vehicle?.name ?? event.vehicleId} at ${stop?.name}`
  if (event.type === 'arrive') return `${vehicle?.name ?? event.vehicleId} arrived at ${stop?.name}`
  if (event.type === 'traffic') return event.label
  if (event.type === 'traffic-delay') return `${vehicle?.name ?? event.vehicleId} delayed by traffic`
  return event.type
}

function tick() {
  const state = game.step()
  recordEvents(state)
  if (state.finished) pause()
  render()
}

function run() {
  if (timer || game.isFinished()) return
  timer = window.setInterval(tick, Number(elements.speed.value))
  render()
}

function pause() {
  if (timer) window.clearInterval(timer)
  timer = null
  render()
}

function reset() {
  pause()
  game.reset()
  selectedVehicleId = scenario.vehicles[0].id
  eventHistory = []
  render()
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

elements.start.addEventListener('click', run)
elements.pause.addEventListener('click', pause)
elements.step.addEventListener('click', () => { if (!timer) tick() })
elements.reset.addEventListener('click', reset)
elements.speed.addEventListener('change', () => { if (timer) { pause(); run() } })

render()
