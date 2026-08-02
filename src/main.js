import { CityUberSimulation, onboardCount } from './engine.js'
import { roadKey } from './routing.js'
import { adaptiveStrategyProfile, createAdaptiveStrategy } from './strategy.js'

const scenarioUrl = new URL('../scenarios/morning-rush.json', import.meta.url)
const scenario = await fetch(scenarioUrl).then((response) => {
  if (!response.ok) throw new Error('Could not load the CityUber scenario.')
  return response.json()
})

let game = new CityUberSimulation(scenario, createAdaptiveStrategy())
let timer = null
let eventHistory = []
const animatedPassengerEvents = new Set()
let vehiclePoses = new Map()
let trafficCarPoses = new Map()

const elements = {
  map: document.querySelector('#city-map'),
  animationLayer: document.querySelector('#passenger-animation-layer'),
  time: document.querySelector('#time-value'),
  duration: document.querySelector('#duration-value'),
  transported: document.querySelector('#transported-metric'),
  transportedGoal: document.querySelector('#transported-goal'),
  wait: document.querySelector('#wait-metric'),
  energy: document.querySelector('#energy-metric'),
  energyGoal: document.querySelector('#energy-goal'),
  score: document.querySelector('#score-metric'),
  humanRivalScore: document.querySelector('#human-rival-score'),
  humanRivalTransported: document.querySelector('#human-rival-transported'),
  humanRivalWait: document.querySelector('#human-rival-wait'),
  aiRivalScore: document.querySelector('#ai-rival-score'),
  aiRivalTransported: document.querySelector('#ai-rival-transported'),
  aiRivalWait: document.querySelector('#ai-rival-wait'),
  rivalStatus: document.querySelector('#rival-status'),
  rivalResult: document.querySelector('#rival-result'),
  vehicleList: document.querySelector('#vehicle-list'),
  manualControls: document.querySelector('#manual-controls'),
  aiMode: document.querySelector('#ai-mode'),
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

const operatorColors = {
  human: ['#f0ad4f', '#76b4a3'],
  ai: ['#db765f', '#8a72ba'],
  system: ['#f0ad4f', '#76b4a3', '#c784be', '#7da3d8'],
}
const trafficColors = ['#5f7780', '#b76858', '#65799b', '#8b7658', '#557064', '#7f688d']
const mapViewBox = { width: 1000, height: 760 }
const fleetParkingStopId = scenario.fleetParking?.stopId ?? 'downtown'
const roadSet = new Set(scenario.roads.map(roadKey))

function point([x, y]) {
  return [95 + x * 105, 68 + y * 94]
}

function fleetParkingPose(index) {
  const parkingStop = scenario.stops.find((stop) => stop.id === fleetParkingStopId)
  const [roadX, roadY] = point(parkingStop.position)
  return { x: 58 + index * 52, y: 711, roadX, roadY, angle: -90, parked: true }
}

function isFleetParked(vehicle) {
  return vehicle.currentStopId === fleetParkingStopId && !vehicle.targetStopId && !vehicle.route.length
}

function vehicleColor(vehicle, index) {
  const palette = operatorColors[vehicle.operator] ?? operatorColors.system
  const operatorIndex = scenario.vehicles.slice(0, index).filter((candidate) => candidate.operator === vehicle.operator).length
  return palette[operatorIndex % palette.length]
}

function vehicleTeamLabel(vehicle, index) {
  const operatorIndex = scenario.vehicles.slice(0, index).filter((candidate) => candidate.operator === vehicle.operator).length + 1
  if (vehicle.operator === 'human') return `H${operatorIndex}`
  if (vehicle.operator === 'ai') return `A${operatorIndex}`
  return String.fromCharCode(65 + index)
}

function render() {
  const state = game.snapshot()
  renderMetrics(state)
  renderCompetition(state)
  renderMap(state)
  renderVehicles(state)
  renderManualControls(state)
  renderWaiting(state)
  renderEvents()
  elements.time.textContent = state.time
  elements.duration.textContent = `/ ${state.scenario.duration}`
  elements.accuracy.textContent = state.scenario.accuracyNote
  elements.start.textContent = state.finished ? 'Finished' : timer ? 'Running…' : '▶ Run'
  elements.start.disabled = state.finished || Boolean(timer)
  window.requestAnimationFrame(() => animatePassengerEvents(state))
}

function renderMetrics(state) {
  elements.transported.textContent = state.metrics.transported
  elements.transportedGoal.textContent = `goal ${state.scenario.objectives.transported}`
  elements.wait.textContent = state.score.averageWait.toFixed(1)
  elements.energy.textContent = state.metrics.energy.toFixed(1)
  elements.energyGoal.textContent = `budget ${state.scenario.objectives.energy}`
  elements.score.textContent = Math.round(state.score.weightedScore)
}

function renderCompetition(state) {
  if (!state.competition?.enabled) return
  elements.aiMode.textContent = `AI adaptive · ${adaptiveStrategyProfile(state).label}`
  const humanMetrics = state.competition.metrics.human
  const aiMetrics = state.competition.metrics.ai
  const averageWait = (metrics) => metrics.boarded ? metrics.totalWait / metrics.boarded : 0
  elements.humanRivalScore.textContent = state.competition.scores.human.toFixed(1)
  elements.humanRivalTransported.textContent = humanMetrics.transported
  elements.humanRivalWait.textContent = averageWait(humanMetrics).toFixed(1)
  elements.aiRivalScore.textContent = state.competition.scores.ai.toFixed(1)
  elements.aiRivalTransported.textContent = aiMetrics.transported
  elements.aiRivalWait.textContent = averageWait(aiMetrics).toFixed(1)
  elements.rivalResult.hidden = !state.competition.winner
  if (state.competition.winner === 'human') {
    elements.rivalStatus.textContent = 'You win!'
    elements.rivalResult.textContent = `You win ${state.competition.scores.human.toFixed(1)}–${state.competition.scores.ai.toFixed(1)} · Reset for a rematch`
  } else if (state.competition.winner === 'ai') {
    elements.rivalStatus.textContent = 'AI wins — rematch?'
    elements.rivalResult.textContent = `AI wins ${state.competition.scores.ai.toFixed(1)}–${state.competition.scores.human.toFixed(1)} · Reset and try another strategy`
  } else if (state.competition.winner === 'tie') {
    elements.rivalStatus.textContent = 'Draw game'
    elements.rivalResult.textContent = `Draw at ${state.competition.scores.human.toFixed(1)} points · Reset for a rematch`
  } else if (state.competition.leader === 'human') elements.rivalStatus.textContent = 'You are leading'
  else if (state.competition.leader === 'ai') elements.rivalStatus.textContent = 'AI is leading'
  else elements.rivalStatus.textContent = 'Scores tied'
}

function renderMap(state) {
  const roadEdges = []
  const roadSurfaces = []
  const roadMarkings = []
  for (const position of state.scenario.roads) {
    const [x, y] = position
    for (const neighbor of [[x + 1, y], [x, y + 1]]) {
      if (!roadSet.has(roadKey(neighbor))) continue
      const [x1, y1] = point(position)
      const [x2, y2] = point(neighbor)
      const geometry = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`
      roadEdges.push(`<line class="road-edge" ${geometry}/>`)
      roadSurfaces.push(`<line class="road" ${geometry}/>`)
      roadMarkings.push(`<line class="road-core" ${geometry}/>`)
    }
  }

  const routes = state.vehicles.map((vehicle, index) => {
    if (!vehicle.route.length) return ''
    const positions = [vehicle.position, ...vehicle.route].map((position) => point(position).join(',')).join(' ')
    return `<polyline class="route${timer ? ' route-moving' : ''}" points="${positions}" style="stroke:${vehicleColor(vehicle, index)}"/>`
  }).join('')

  const traffic = Object.values(state.traffic).map((event) => {
    const [x, y] = point(event.position)
    return `<g><circle class="traffic-marker" cx="${x}" cy="${y}" r="17"/><text class="stop-count" x="${x}" y="${y + 3}">!</text></g>`
  }).join('')

  const trafficLights = Object.values(state.trafficLights ?? {}).map((light) => {
    const [x, y] = point(light.position)
    const horizontalGreen = light.phase === 'horizontal'
    return `<g class="traffic-light" transform="translate(${x + 15} ${y - 15})"><title>${horizontalGreen ? 'Horizontal' : 'Vertical'} traffic has a green light</title><rect class="signal-housing" x="-13" y="-8" width="26" height="16" rx="5"/><circle class="signal-bulb ${horizontalGreen ? 'signal-go' : 'signal-stop'}" cx="-6" cy="0" r="3.3"/><circle class="signal-bulb ${horizontalGreen ? 'signal-stop' : 'signal-go'}" cx="6" cy="0" r="3.3"/><text class="signal-axis" x="-6" y="13">H</text><text class="signal-axis" x="6" y="13">V</text></g>`
  }).join('')

  const waitingAtStop = new Map(state.waiting.map((request) => [request.from, (state.waiting.filter((item) => item.from === request.from).reduce((total, item) => total + item.remaining, 0))]))
  const stops = state.scenario.stops.map((stop, index) => {
    const [x, y] = point(stop.position)
    const count = waitingAtStop.get(stop.id) ?? 0
    const labelAnchor = index % 2 ? 'end' : 'start'
    const labelX = index % 2 ? x - 15 : x + 15
    const visiblePeople = Math.min(count, 5)
    const queuePeople = Array.from({ length: visiblePeople }, (_, personIndex) => humanSvg(x - 14 + personIndex * 7, y + 23, '#376e62')).join('')
    const overflow = count > visiblePeople ? `<text class="human-overflow" x="${x + 24}" y="${y + 27}">+${count - visiblePeople}</text>` : ''
    return `<g data-stop="${escapeHtml(stop.id)}"><circle class="stop-halo" cx="${x}" cy="${y}" r="13"/><circle class="stop-core" cx="${x}" cy="${y}" r="8"/>${count ? `<circle cx="${x + 10}" cy="${y - 11}" r="9" fill="#db765f"/><text class="stop-count" x="${x + 10}" y="${y - 8}">${count}</text>` : ''}<text class="stop-label" x="${labelX}" y="${y - 15}" text-anchor="${labelAnchor}">${escapeHtml(stop.name)}</text>${queuePeople}${overflow}</g>`
  }).join('')

  const nextVehiclePoses = new Map()
  const vehicles = state.vehicles.map((vehicle, index) => {
    const previousPose = vehiclePoses.get(vehicle.id)
    const pose = calculateVehiclePose(vehicle, previousPose, index)
    nextVehiclePoses.set(vehicle.id, pose)
    return vehicleSvg(vehicle, index, pose, previousPose)
  }).join('')

  const nextTrafficCarPoses = new Map()
  const trafficCars = (state.trafficCars ?? []).map((car) => {
    const previousPose = trafficCarPoses.get(car.id)
    const pose = calculateRoadPose(car, previousPose)
    nextTrafficCarPoses.set(car.id, pose)
    return trafficCarSvg(car, pose, previousPose)
  }).join('')

  const corridors = (state.scenario.map?.corridors ?? []).map((corridor) => {
    const [x, y] = point(corridor.position)
    return `<text class="corridor-label" x="${x}" y="${y}">${escapeHtml(corridor.name)}</text>`
  }).join('')
  const parkingLot = renderFleetParking(state)
  const coastPath = 'M 0 520 C 110 470, 185 510, 260 600 C 310 665, 335 720, 360 760 L 0 760 Z'

  elements.map.innerHTML = `
    <rect width="${mapViewBox.width}" height="${mapViewBox.height}" rx="18" fill="#f8f8f2"/>
    <path class="coast" d="${escapeHtml(coastPath)}"/>
    <text x="30" y="718" fill="#6f9d9b" font-size="12" font-style="italic">Gulf of Papua</text>
    ${parkingLot}
    <g class="road-edge-layer">${roadEdges.join('')}</g>
    <g class="road-surface-layer">${roadSurfaces.join('')}</g>
    <g class="road-marking-layer">${roadMarkings.join('')}</g>
    <g>${corridors}</g>
    <g>${routes}</g>
    <g>${traffic}</g>
    <g>${trafficLights}</g>
    <g>${stops}</g>
    <g>${trafficCars}</g>
    <g>${vehicles}</g>`
  vehiclePoses = nextVehiclePoses
  trafficCarPoses = nextTrafficCarPoses
}

function renderFleetParking(state) {
  const parkedIds = new Set(state.vehicles.filter(isFleetParked).map((vehicle) => vehicle.id))
  const bays = state.vehicles.map((vehicle, index) => {
    const pose = fleetParkingPose(index)
    const occupied = parkedIds.has(vehicle.id)
    const label = vehicleTeamLabel(vehicle, index)
    return `<g class="parking-bay operator-${escapeHtml(vehicle.operator)}${occupied ? ' occupied' : ''}"><rect x="${pose.x - 21}" y="680" width="42" height="62" rx="5"/><text x="${pose.x}" y="737">${label}</text></g>`
  }).join('')
  const parkingStopName = state.scenario.stops.find((stop) => stop.id === fleetParkingStopId)?.name ?? 'Fleet'
  return `<g class="fleet-parking"><path class="parking-driveway-edge" d="M95 668 V632"/><path class="parking-driveway" d="M95 668 V632"/><rect class="parking-lot-edge" x="30" y="664" width="222" height="88" rx="14"/><rect class="parking-lot" x="34" y="668" width="214" height="80" rx="11"/><text class="parking-title" x="38" y="659">${escapeHtml(parkingStopName)} · CityLift depot</text>${bays}</g>`
}

function humanSvg(x, y, color) {
  return `<g class="map-human" transform="translate(${x} ${y})" style="--human-color:${color}"><circle class="map-human-head" cx="0" cy="-5" r="2.7"/><path class="map-human-body" d="M0 -2 V5 M-3 1 L0 -1 L3 1 M-2 9 L0 5 L2 9"/></g>`
}

function calculateVehiclePose(vehicle, previousPose, index) {
  if (isFleetParked(vehicle)) return fleetParkingPose(index)
  return calculateRoadPose(vehicle, previousPose)
}

function calculateRoadPose(vehicle, previousPose) {
  const [roadX, roadY] = point(vehicle.position)
  const previousRoadX = previousPose?.roadX ?? previousPose?.x
  const previousRoadY = previousPose?.roadY ?? previousPose?.y
  let angle = previousPose?.angle ?? 0
  const movedX = previousPose ? roadX - previousRoadX : 0
  const movedY = previousPose ? roadY - previousRoadY : 0
  if (movedX || movedY) {
    angle = directionAngle(movedX, movedY)
  } else if (vehicle.route[0]) {
    const [nextX, nextY] = point(vehicle.route[0])
    angle = directionAngle(nextX - roadX, nextY - roadY)
  }
  angle = shortestTurn(previousPose?.angle, angle)
  const laneOffset = 9.5
  const radians = angle * Math.PI / 180
  const x = roadX + Math.sin(radians) * laneOffset
  const y = roadY - Math.cos(radians) * laneOffset
  return { x, y, roadX, roadY, angle }
}

function directionAngle(deltaX, deltaY) {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? 0 : 180
  return deltaY >= 0 ? 90 : -90
}

function shortestTurn(previousAngle, targetAngle) {
  if (previousAngle === undefined) return targetAngle
  let adjusted = targetAngle
  while (adjusted - previousAngle > 180) adjusted -= 360
  while (adjusted - previousAngle < -180) adjusted += 360
  return adjusted
}

function vehicleSvg(vehicle, index, pose, previousPose) {
  const { x, y, angle } = pose
  const count = onboardCount(vehicle)
  const dimensions = vehicle.type === 'minibus'
    ? { length: 40, width: 17, cabinStart: -12, cabinEnd: 11 }
    : vehicle.type === 'shuttle'
      ? { length: 35, width: 15, cabinStart: -10, cabinEnd: 9 }
      : { length: 29, width: 13, cabinStart: -7, cabinEnd: 7 }
  const { length, width, cabinStart, cabinEnd } = dimensions
  const color = vehicleColor(vehicle, index)
  const visiblePeople = Math.min(count, vehicle.type === 'minibus' ? 4 : 3)
  const people = Array.from({ length: visiblePeople }, (_, personIndex) => {
    const personX = cabinStart + 5 + personIndex * ((cabinEnd - cabinStart - 10) / Math.max(visiblePeople - 1, 1))
    return `<circle class="car-passenger" cx="${personX}" cy="0" r="1.7"/>`
  }).join('')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const tickDuration = Number(elements.speed.value)
  const duration = Math.max(100, tickDuration - 8)
  const turnDuration = Math.max(100, Math.min(320, duration * 0.7))
  const moved = previousPose && (previousPose.x !== x || previousPose.y !== y)
  const turned = previousPose && previousPose.angle !== angle
  const movementAnimation = moved && !reduceMotion
    ? `<animateTransform attributeName="transform" type="translate" from="${previousPose.x} ${previousPose.y}" to="${x} ${y}" dur="${duration}ms" calcMode="linear" fill="freeze"/>`
    : ''
  const turnAnimation = turned && !reduceMotion
    ? `<animateTransform attributeName="transform" type="rotate" from="${previousPose.angle}" to="${angle}" dur="${turnDuration}ms" calcMode="spline" keyTimes="0;1" keySplines="0.22 0.61 0.36 1" fill="freeze"/>`
    : ''
  const bodyPath = `M ${-length / 2 + 5} ${-width / 2} H ${length / 2 - 6} Q ${length / 2} ${-width / 2} ${length / 2} ${-width / 2 + 6} V ${width / 2 - 6} Q ${length / 2} ${width / 2} ${length / 2 - 6} ${width / 2} H ${-length / 2 + 5} Q ${-length / 2} ${width / 2} ${-length / 2} ${width / 2 - 5} V ${-width / 2 + 5} Q ${-length / 2} ${-width / 2} ${-length / 2 + 5} ${-width / 2} Z`
  const wheels = [-length / 2 + 7, length / 2 - 8].map((wheelX) => `<rect class="car-wheel" x="${wheelX - 3}" y="${-width / 2 - 1.5}" width="6" height="3" rx="1"/><rect class="car-wheel" x="${wheelX - 3}" y="${width / 2 - 1.5}" width="6" height="3" rx="1"/>`).join('')
  return `<g class="vehicle-motion" transform="translate(${x} ${y})" data-vehicle-marker="${escapeHtml(vehicle.id)}">${movementAnimation}<title>${escapeHtml(vehicle.name)}: ${vehicle.type}, ${count} onboard</title><g class="vehicle-car vehicle-${escapeHtml(vehicle.type)}${moved ? ' is-moving' : ''}" transform="rotate(${angle})">${turnAnimation}<ellipse class="car-shadow" cx="-1" cy="2" rx="${length / 2 + 2}" ry="${width / 2 + 2}"/>${wheels}<path class="car-body" d="${bodyPath}" fill="${color}"/><rect class="car-roof" x="${cabinStart}" y="${-width / 2 + 3.5}" width="${cabinEnd - cabinStart}" height="${width - 7}" rx="3"/><path class="car-window car-window-front" d="M ${cabinEnd - 5} ${-width / 2 + 4.5} L ${cabinEnd} ${-width / 2 + 6} V ${width / 2 - 6} L ${cabinEnd - 5} ${width / 2 - 4.5} Z"/><path class="car-window car-window-rear" d="M ${cabinStart + 4} ${-width / 2 + 4.5} L ${cabinStart} ${-width / 2 + 6} V ${width / 2 - 6} L ${cabinStart + 4} ${width / 2 - 4.5} Z"/><path class="car-roof-line" d="M ${cabinStart + 6} 0 H ${cabinEnd - 6}"/>${people}<circle class="car-headlight" cx="${length / 2 - 1.8}" cy="${-width / 4}" r="1.2"/><circle class="car-headlight" cx="${length / 2 - 1.8}" cy="${width / 4}" r="1.2"/><circle class="car-tail-light" cx="${-length / 2 + 1.5}" cy="${-width / 4}" r="1"/><circle class="car-tail-light" cx="${-length / 2 + 1.5}" cy="${width / 4}" r="1"/>${vehicle.accessible ? `<circle class="accessible-marker" cx="${cabinStart + 5}" cy="0" r="3"/><path class="accessible-mark" d="M ${cabinStart + 5} -1.5 V 1.5 M ${cabinStart + 3.5} 0 H ${cabinStart + 6.5}"/>` : ''}${count > visiblePeople ? `<text class="car-overflow" x="${length / 2 - 2}" y="${-width / 2 - 3}">+${count - visiblePeople}</text>` : ''}</g><text class="vehicle-label" x="0" y="${width / 2 + 14}">${vehicleTeamLabel(vehicle, index)}</text></g>`
}

function trafficCarSvg(car, pose, previousPose) {
  const { x, y, angle } = pose
  const length = 24
  const width = 10
  const color = trafficColors[car.colorIndex % trafficColors.length]
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const duration = Math.max(100, Number(elements.speed.value) - 8)
  const turnDuration = Math.max(100, Math.min(280, duration * 0.65))
  const moved = previousPose && (previousPose.x !== x || previousPose.y !== y)
  const turned = previousPose && previousPose.angle !== angle
  const movementAnimation = moved && !reduceMotion
    ? `<animateTransform attributeName="transform" type="translate" from="${previousPose.x} ${previousPose.y}" to="${x} ${y}" dur="${duration}ms" calcMode="linear" fill="freeze"/>`
    : ''
  const turnAnimation = turned && !reduceMotion
    ? `<animateTransform attributeName="transform" type="rotate" from="${previousPose.angle}" to="${angle}" dur="${turnDuration}ms" calcMode="spline" keyTimes="0;1" keySplines="0.22 0.61 0.36 1" fill="freeze"/>`
    : ''
  return `<g class="traffic-car-motion" transform="translate(${x} ${y})" data-traffic-car="${escapeHtml(car.id)}">${movementAnimation}<title>${escapeHtml(car.name)}</title><g class="traffic-car${moved ? ' is-moving' : ''}" transform="rotate(${angle})">${turnAnimation}<ellipse class="traffic-car-shadow" cx="-1" cy="2" rx="14" ry="7"/><rect class="traffic-car-wheel" x="-8" y="-6" width="5" height="2.5" rx="1"/><rect class="traffic-car-wheel" x="4" y="-6" width="5" height="2.5" rx="1"/><rect class="traffic-car-wheel" x="-8" y="3.5" width="5" height="2.5" rx="1"/><rect class="traffic-car-wheel" x="4" y="3.5" width="5" height="2.5" rx="1"/><rect class="traffic-car-body" x="${-length / 2}" y="${-width / 2}" width="${length}" height="${width}" rx="4" fill="${color}"/><rect class="traffic-car-roof" x="-5" y="-3.5" width="11" height="7" rx="2"/><path class="traffic-car-window" d="M2 -3 L6 -2 V2 L2 3 Z M-2 -3 L-5 -2 V2 L-2 3 Z"/><circle class="traffic-car-headlight" cx="10.8" cy="-2.3" r=".9"/><circle class="traffic-car-headlight" cx="10.8" cy="2.3" r=".9"/><circle class="traffic-car-tail" cx="-10.8" cy="-2.3" r=".75"/><circle class="traffic-car-tail" cx="-10.8" cy="2.3" r=".75"/></g></g>`
}

function vehicleGlyph(type) {
  const height = type === 'minibus' ? 28 : type === 'shuttle' ? 25 : 22
  const width = type === 'minibus' ? 15 : type === 'shuttle' ? 14 : 13
  const x = (24 - width) / 2
  const y = (32 - height) / 2
  return `<svg class="vehicle-symbol-art" viewBox="0 0 24 32" aria-hidden="true"><rect class="symbol-wheel" x="${x - 1.5}" y="${y + 5}" width="2" height="6" rx="1"/><rect class="symbol-wheel" x="${x + width - 0.5}" y="${y + 5}" width="2" height="6" rx="1"/><rect class="symbol-wheel" x="${x - 1.5}" y="${y + height - 11}" width="2" height="6" rx="1"/><rect class="symbol-wheel" x="${x + width - 0.5}" y="${y + height - 11}" width="2" height="6" rx="1"/><rect class="symbol-body" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"/><rect class="symbol-window" x="${x + 2.5}" y="${y + 4}" width="${width - 5}" height="5" rx="1.5"/><path class="symbol-roof-line" d="M ${x + 3} ${y + 12} H ${x + width - 3}"/></svg>`
}

function renderVehicles(state) {
  elements.vehicleList.innerHTML = state.vehicles.map((vehicle, index) => {
    const target = state.scenario.stops.find((stop) => stop.id === vehicle.targetStopId)
    const current = state.scenario.stops.find((stop) => stop.id === vehicle.currentStopId)
    const location = target ? `to ${target.name}` : current ? `at ${current.name}` : 'moving'
    const destinations = [...new Set(vehicle.passengers.map((group) => state.scenario.stops.find((stop) => stop.id === group.to)?.name).filter(Boolean))]
    const riderSummary = destinations.length ? ` · riders → ${destinations.slice(0, 2).join(', ')}${destinations.length > 2 ? '…' : ''}` : ''
    const isHuman = vehicle.operator === 'human'
    return `<article class="vehicle-card operator-${escapeHtml(vehicle.operator)}"><span class="vehicle-symbol" style="background:${vehicleColor(vehicle, index)}">${vehicleGlyph(vehicle.type)}</span><span><em class="operator-badge">${isHuman ? 'YOU' : 'AI'}</em><strong>${escapeHtml(vehicle.name)}</strong><small>${escapeHtml(vehicle.type)} · ${escapeHtml(location)}${vehicle.accessible ? ' · accessible' : ''}${escapeHtml(riderSummary)}</small></span><span class="capacity"><strong>${onboardCount(vehicle)}/${vehicle.capacity}</strong><small>onboard</small></span></article>`
  }).join('')
}

function renderManualControls(state) {
  const humanVehicles = state.vehicles.filter((vehicle) => vehicle.operator === 'human')

  if (!elements.manualControls.childElementCount) {
    const stopOptions = state.scenario.stops
      .map((stop) => `<option value="${escapeHtml(stop.id)}">${escapeHtml(stop.name)}</option>`)
      .join('')
    elements.manualControls.innerHTML = humanVehicles.map((vehicle) => `
      <article class="manual-control" data-manual-vehicle="${escapeHtml(vehicle.id)}">
        <span><strong>${escapeHtml(vehicle.name)}</strong><small data-manual-status>Awaiting dispatch</small></span>
        <select data-dispatch-destination aria-label="Destination for ${escapeHtml(vehicle.name)}">${stopOptions}</select>
        <button type="button" data-dispatch-button>Dispatch</button>
      </article>
    `).join('')

    elements.manualControls.querySelectorAll('[data-dispatch-button]').forEach((button) => {
      button.addEventListener('click', () => {
        const control = button.closest('[data-manual-vehicle]')
        const vehicleId = control.dataset.manualVehicle
        const destination = control.querySelector('[data-dispatch-destination]').value
        if (game.dispatch(vehicleId, destination, 'human')) render()
      })
    })
  }

  elements.manualControls.querySelectorAll('[data-manual-vehicle]').forEach((control) => {
    const vehicle = state.vehicles.find((candidate) => candidate.id === control.dataset.manualVehicle)
    const target = state.scenario.stops.find((stop) => stop.id === vehicle?.targetStopId)
    const current = state.scenario.stops.find((stop) => stop.id === vehicle?.currentStopId)
    const status = target ? `Travelling to ${target.name}` : current ? `Waiting at ${current.name}` : 'In transit'
    control.querySelector('[data-manual-status]').textContent = status
    control.querySelector('[data-dispatch-button]').disabled = !vehicle || vehicle.outOfService
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

function animatePassengerEvents(state) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const events = state.events.filter((event) => event.type === 'board' || event.type === 'exit')
  if (!events.length) return

  const mapRect = elements.map.getBoundingClientRect()
  const layerRect = elements.animationLayer.getBoundingClientRect()
  const toLayerPoint = (mapPoint) => ({
    x: mapRect.left - layerRect.left + mapPoint[0] * mapRect.width / mapViewBox.width,
    y: mapRect.top - layerRect.top + mapPoint[1] * mapRect.height / mapViewBox.height,
  })

  events.forEach((event, eventIndex) => {
    const key = `${state.time}:${event.type}:${event.vehicleId}:${event.requestId}:${event.count}`
    if (animatedPassengerEvents.has(key)) return
    animatedPassengerEvents.add(key)
    const stop = state.scenario.stops.find((candidate) => candidate.id === event.stopId)
    const vehicle = state.vehicles.find((candidate) => candidate.id === event.vehicleId)
    const request = state.requests.find((candidate) => candidate.id === event.requestId)
    if (!stop || !vehicle) return

    const queueMapPoint = point(stop.position)
    queueMapPoint[0] += 26
    queueMapPoint[1] += 21
    const carMapPoint = point(vehicle.position)
    const from = toLayerPoint(event.type === 'board' ? queueMapPoint : carMapPoint)
    const to = toLayerPoint(event.type === 'board' ? carMapPoint : queueMapPoint)
    const visibleCount = Math.min(event.count, 5)

    for (let index = 0; index < visibleCount; index += 1) {
      const avatar = document.createElement('span')
      avatar.className = `person-avatar moving-${event.type}`
      if (request?.priority) avatar.classList.add('priority')
      if (request?.requiresAccessible) avatar.classList.add('accessible')
      avatar.style.left = `${from.x + index * 4}px`
      avatar.style.top = `${from.y}px`
      elements.animationLayer.append(avatar)
      const animation = avatar.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95 },
        {
          transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(${event.type === 'board' ? 0.7 : 1.08})`,
          opacity: event.type === 'board' ? 0.35 : 0,
        },
      ], {
        duration: 700,
        delay: eventIndex * 80 + index * 65,
        easing: event.type === 'board' ? 'cubic-bezier(.4, 0, .2, 1)' : 'cubic-bezier(.2, .8, .2, 1)',
        fill: 'forwards',
      })
      animation.finished.catch(() => {}).finally(() => avatar.remove())
    }
  })

  if (animatedPassengerEvents.size > 500) animatedPassengerEvents.clear()
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
  if (event.type === 'traffic-light-wait') return `${vehicle?.name ?? event.vehicleId} waiting at a red signal`
  if (event.type === 'collision-wait') return `${vehicle?.name ?? event.vehicleId} yielding to avoid a collision`
  if (event.type === 'traffic-light-added') return `Traffic signal added at ${event.position.join(', ')}`
  if (event.type === 'traffic-light-removed') return `Traffic signal removed at ${event.position.join(', ')}`
  return event.type
}

function stopRunLoop() {
  if (timer) window.cancelAnimationFrame(timer)
  timer = null
}

function tick() {
  const state = game.step()
  recordEvents(state)
  if (state.finished) stopRunLoop()
  render()
}

function runFrame(now) {
  if (!timer) return
  if (now >= runFrame.nextTickAt) {
    tick()
    runFrame.nextTickAt = now + Number(elements.speed.value)
  }
  if (timer) timer = window.requestAnimationFrame(runFrame)
}

function run() {
  if (timer || game.isFinished()) return
  runFrame.nextTickAt = performance.now() + Number(elements.speed.value)
  timer = window.requestAnimationFrame(runFrame)
  render()
}

function pause() {
  stopRunLoop()
  render()
}

function reset() {
  pause()
  game.reset()
  eventHistory = []
  animatedPassengerEvents.clear()
  vehiclePoses.clear()
  trafficCarPoses.clear()
  elements.animationLayer.replaceChildren()
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
