import { findRoute, roadConnections, roadKey, samePosition } from './routing.js'

export class CityUberSimulation {
  constructor(scenario, strategy) {
    this.scenario = structuredClone(scenario)
    this.strategy = strategy
    this.stopById = new Map(this.scenario.stops.map((stop) => [stop.id, stop]))
    this.reset()
  }

  reset() {
    this.time = 0
    this.events = []
    this.competitionEnabled = this.scenario.competition?.enabled === true
    this.traffic = {}
    this.trafficLightRules = {
      phaseDuration: 4,
      updateInterval: 12,
      initialCount: 0,
      maxActive: 4,
      dynamic: false,
      ...(this.scenario.trafficLightRules ?? {}),
    }
    this.trafficLightCandidates = this.scenario.roads
      .filter((position) => roadConnections(position, this.scenario.roads).length >= 3)
      .map((position) => [...position])
    this.trafficLights = {}
    this.#initializeTrafficLights()
    this.requests = this.scenario.requests.map((request, index) => ({
      id: `request-${index + 1}`,
      status: 'pending',
      remaining: request.passengers,
      delivered: 0,
      ...structuredClone(request),
      deliveredByOperator: {},
    }))
    this.pending = [...this.requests].sort((left, right) => left.at - right.at)
    this.waiting = []
    this.vehicles = this.scenario.vehicles.map((vehicle) => {
      const start = this.#stop(vehicle.startStop)
      return {
        ...structuredClone(vehicle),
        operator: vehicle.operator ?? (this.competitionEnabled ? 'human' : 'system'),
        position: [...start.position],
        currentStopId: start.id,
        targetStopId: null,
        route: [],
        passengers: [],
        outOfService: false,
      }
    })
    const operatorIds = this.competitionEnabled ? ['human', 'ai'] : [...new Set(this.vehicles.map((vehicle) => vehicle.operator))]
    this.operatorMetrics = Object.fromEntries(operatorIds.map((operator) => [operator, blankOperatorMetrics()]))
    this.trafficCars = this.#createTrafficCars()
    this.metrics = {
      transported: 0,
      completedRequests: 0,
      totalWait: 0,
      maxWait: 0,
      energy: 0,
      accessibleTransported: 0,
      accessibleRequested: this.scenario.requests
        .filter((request) => request.requiresAccessible)
        .reduce((total, request) => total + request.passengers, 0),
      stopWaits: {},
    }
  }

  setStrategy(strategy) {
    this.strategy = strategy
  }

  dispatch(vehicleId, stopId, source = 'human') {
    const vehicle = this.vehicles.find((candidate) => candidate.id === vehicleId)
    const stop = this.stopById.get(stopId)
    if (!vehicle || !stop || vehicle.outOfService) return false
    if (this.competitionEnabled && source === 'human' && vehicle.operator !== 'human') return false
    if (this.competitionEnabled && source === 'ai' && vehicle.operator !== 'ai') return false
    if (samePosition(vehicle.position, stop.position)) {
      vehicle.currentStopId = stop.id
      vehicle.targetStopId = null
      vehicle.route = []
      return true
    }
    const route = findRoute(vehicle.position, stop.position, this.scenario.roads, this.traffic, true)
    if (!route.length) return false
    vehicle.targetStopId = stop.id
    vehicle.route = route
    this.events.push({ type: 'dispatch', vehicleId, stopId, operator: vehicle.operator })
    return true
  }

  step() {
    this.events = []
    if (this.isFinished()) return this.snapshot()

    this.#expireTraffic()
    this.#updateTrafficLights()
    this.#spawnRequests()
    this.#startTrafficEvents()

    for (const vehicle of this.vehicles) this.#serviceCurrentStop(vehicle)

    const decisionState = this.snapshot()
    if (this.competitionEnabled) decisionState.vehicles = decisionState.vehicles.filter((vehicle) => vehicle.operator === 'ai')
    const decisions = this.strategy?.decide(decisionState) ?? {}
    for (const vehicle of this.vehicles) {
      if (this.competitionEnabled && vehicle.operator !== 'ai') continue
      if (!vehicle.route.length && !vehicle.targetStopId && decisions[vehicle.id]) {
        this.dispatch(vehicle.id, decisions[vehicle.id], this.competitionEnabled ? 'ai' : 'system')
      }
    }

    this.#planTrafficCars()
    this.#moveVehicles()
    this.time += 1
    return this.snapshot()
  }

  isFinished() {
    return this.time >= this.scenario.duration
  }

  score() {
    const objectives = this.scenario.objectives
    const averageWait = this.metrics.transported
      ? this.metrics.totalWait / this.metrics.transported
      : 0
    const stopAverages = Object.values(this.metrics.stopWaits)
      .filter((entry) => entry.count > 0)
      .map((entry) => entry.total / entry.count)
    const waitRange = stopAverages.length > 1 ? Math.max(...stopAverages) - Math.min(...stopAverages) : 0
    const accessibilityScore = this.metrics.accessibleRequested
      ? Math.min(1, this.metrics.accessibleTransported / this.metrics.accessibleRequested)
      : 1
    const componentScores = {
      throughput: Math.min(1, this.metrics.transported / Math.max(1, objectives.transported)),
      wait: this.metrics.maxWait <= objectives.maxWait ? 1 : objectives.maxWait / Math.max(1, this.metrics.maxWait),
      energy: this.metrics.energy <= objectives.energy ? 1 : objectives.energy / Math.max(1, this.metrics.energy),
      accessibility: accessibilityScore,
      fairness: 1 / (1 + waitRange / 10),
    }
    const weights = {
      throughput: 0.4,
      wait: 0.25,
      energy: 0.15,
      accessibility: 0.1,
      fairness: 0.1,
      ...(this.scenario.scoreWeights ?? {}),
    }
    const weightTotal = Object.values(weights).reduce((total, value) => total + value, 0)
    const weightedScore = 100 * Object.entries(weights)
      .reduce((total, [key, weight]) => total + componentScores[key] * weight, 0) / weightTotal

    return {
      transported: this.metrics.transported,
      completedRequests: this.metrics.completedRequests,
      averageWait,
      maxWait: this.metrics.maxWait,
      energy: this.metrics.energy,
      accessibleTransported: this.metrics.accessibleTransported,
      waitRange,
      componentScores,
      weightedScore,
      passed: this.metrics.transported >= objectives.transported
        && this.metrics.maxWait <= objectives.maxWait
        && this.metrics.energy <= objectives.energy,
    }
  }

  snapshot() {
    return structuredClone({
      scenario: this.scenario,
      time: this.time,
      vehicles: this.vehicles,
      trafficCars: this.trafficCars,
      requests: this.requests,
      waiting: this.waiting.map((request) => ({ ...request, waited: this.time - request.at })),
      traffic: this.traffic,
      trafficLights: Object.fromEntries(Object.entries(this.trafficLights).map(([key, light]) => [key, {
        ...light,
        phase: this.#trafficLightPhase(light),
      }])),
      events: this.events,
      metrics: this.metrics,
      score: this.score(),
      competition: this.#competitionSnapshot(),
      finished: this.isFinished(),
    })
  }

  #spawnRequests() {
    while (this.pending.length && this.pending[0].at <= this.time) {
      const request = this.pending.shift()
      request.status = 'waiting'
      this.waiting.push(request)
      this.events.push({ type: 'call', requestId: request.id, stopId: request.from, count: request.passengers })
    }
  }

  #serviceCurrentStop(vehicle) {
    if (vehicle.outOfService || vehicle.route.length || vehicle.targetStopId) return
    const stop = this.scenario.stops.find((candidate) => samePosition(candidate.position, vehicle.position))
    if (!stop) return
    vehicle.currentStopId = stop.id
    this.#unload(vehicle, stop.id)
    this.#board(vehicle, stop.id)
  }

  #unload(vehicle, stopId) {
    const staying = []
    const operatorMetrics = this.operatorMetrics[vehicle.operator]
    for (const group of vehicle.passengers) {
      if (group.to !== stopId) {
        staying.push(group)
        continue
      }
      const request = this.requests.find((candidate) => candidate.id === group.requestId)
      if (request) {
        request.delivered += group.count
        request.deliveredByOperator[vehicle.operator] = (request.deliveredByOperator[vehicle.operator] ?? 0) + group.count
        if (request.delivered >= request.passengers) {
          request.status = 'completed'
          this.metrics.completedRequests += 1
        }
      }
      this.metrics.transported += group.count
      operatorMetrics.transported += group.count
      if (group.type === 'priority') operatorMetrics.priorityTransported += group.count
      if (group.requiresAccessible) {
        this.metrics.accessibleTransported += group.count
        operatorMetrics.accessibleTransported += group.count
      }
      this.events.push({ type: 'exit', vehicleId: vehicle.id, operator: vehicle.operator, stopId, requestId: group.requestId, count: group.count })
    }
    vehicle.passengers = staying
  }

  #board(vehicle, stopId) {
    let available = vehicle.capacity - onboardCount(vehicle)
    const operatorMetrics = this.operatorMetrics[vehicle.operator]
    if (available <= 0) return

    const candidates = this.waiting
      .filter((request) => request.from === stopId && (!request.requiresAccessible || vehicle.accessible))
      .sort((left, right) => Number(right.priority) - Number(left.priority) || left.at - right.at)

    for (const request of candidates) {
      if (available <= 0) break
      const count = Math.min(available, request.remaining)
      const wait = this.time - request.at
      vehicle.passengers.push({
        requestId: request.id,
        to: request.to,
        count,
        type: request.type,
        requiresAccessible: request.requiresAccessible === true,
        operator: vehicle.operator,
        boardedAt: this.time,
      })
      request.remaining -= count
      request.status = request.remaining ? 'partly-boarded' : 'onboard'
      available -= count
      this.metrics.totalWait += wait * count
      this.metrics.maxWait = Math.max(this.metrics.maxWait, wait)
      operatorMetrics.boarded += count
      operatorMetrics.totalWait += wait * count
      operatorMetrics.maxWait = Math.max(operatorMetrics.maxWait, wait)
      const stopWait = this.metrics.stopWaits[stopId] ?? { total: 0, count: 0 }
      stopWait.total += wait * count
      stopWait.count += count
      this.metrics.stopWaits[stopId] = stopWait
      this.events.push({ type: 'board', vehicleId: vehicle.id, operator: vehicle.operator, stopId, requestId: request.id, count })
    }
    this.waiting = this.waiting.filter((request) => request.remaining > 0)
  }

  #createTrafficCars() {
    const requestedCount = Math.max(0, Math.floor(Number(this.scenario.ambientTraffic?.count) || 0))
    const fleetPositions = new Set(this.vehicles.map((vehicle) => roadKey(vehicle.position)))
    const available = this.scenario.roads.filter((position) => !fleetPositions.has(roadKey(position))).map((position) => [...position])
    const count = Math.min(requestedCount, available.length)
    const cars = []
    for (let index = 0; index < count; index += 1) {
      const selectedIndex = deterministicIndex(`${this.scenario.id}:traffic-car:${index}:start`, available.length)
      const [position] = available.splice(selectedIndex, 1)
      cars.push({
        id: `traffic-car-${index + 1}`,
        name: `Traffic car ${index + 1}`,
        position,
        destination: null,
        route: [],
        trip: 0,
        blockedTicks: 0,
        colorIndex: deterministicIndex(`${this.scenario.id}:traffic-car:${index}:color`, 6),
      })
    }
    return cars
  }

  #planTrafficCars() {
    for (const car of this.trafficCars) {
      if (car.route.length) continue
      const destinations = this.scenario.roads.filter((position) => !samePosition(position, car.position))
      if (!destinations.length) continue
      const startIndex = deterministicIndex(`${this.scenario.id}:${car.id}:trip:${car.trip}`, destinations.length)
      for (let offset = 0; offset < destinations.length; offset += 1) {
        const destination = destinations[(startIndex + offset) % destinations.length]
        const route = findRoute(car.position, destination, this.scenario.roads, this.traffic, true)
        if (!route.length) continue
        car.destination = [...destination]
        car.route = route
        car.trip += 1
        break
      }
    }
  }

  #moveVehicles() {
    const actors = [
      ...this.vehicles.map((actor) => ({ actor, kind: 'fleet' })),
      ...this.trafficCars.map((actor) => ({ actor, kind: 'traffic' })),
    ]
    const occupied = new Map(actors
      .filter(({ actor, kind }) => kind !== 'fleet' || !this.#isFleetOffRoad(actor))
      .map(({ actor }) => [roadKey(actor.position), actor.id]))
    const intents = new Map()

    for (const { actor, kind } of actors) {
      if (actor.outOfService || !actor.route.length) continue
      const next = actor.route[0]
      const nextKey = roadKey(next)
      const congestion = this.traffic[nextKey]
      if (congestion && this.time % (congestion.severity + 1) !== 0) {
        if (kind === 'fleet') this.events.push({ type: 'traffic-delay', vehicleId: actor.id, position: [...next] })
        continue
      }
      const light = this.trafficLights[nextKey]
      const movementAxis = next[0] !== actor.position[0] ? 'horizontal' : 'vertical'
      if (light && this.#trafficLightPhase(light) !== movementAxis) {
        if (kind === 'fleet') this.events.push({ type: 'traffic-light-wait', vehicleId: actor.id, position: [...next], phase: this.#trafficLightPhase(light) })
        continue
      }
      intents.set(actor.id, { actor, kind, next: [...next], nextKey })
    }

    const reservedDestinations = new Map()
    for (const [actorId, intent] of [...intents]) {
      const winner = reservedDestinations.get(intent.nextKey)
      if (winner) {
        intents.delete(actorId)
        this.#recordCollisionDelay(intent, winner)
      } else {
        reservedDestinations.set(intent.nextKey, actorId)
      }
    }

    let changed = true
    while (changed) {
      changed = false
      for (const [actorId, intent] of [...intents]) {
        const occupantId = occupied.get(intent.nextKey)
        if (!occupantId || occupantId === actorId || intents.has(occupantId)) continue
        intents.delete(actorId)
        this.#recordCollisionDelay(intent, occupantId)
        changed = true
      }
    }

    for (const { actor, kind, next } of intents.values()) {
      if (kind === 'fleet') this.#applyVehicleMove(actor, next)
      else this.#applyTrafficCarMove(actor, next)
    }
  }

  #recordCollisionDelay(intent, blockedBy) {
    if (intent.kind === 'fleet') {
      this.events.push({ type: 'collision-wait', vehicleId: intent.actor.id, blockedBy, position: [...intent.next] })
      return
    }
    intent.actor.blockedTicks += 1
    if (intent.actor.blockedTicks < 3) return
    intent.actor.route = []
    intent.actor.destination = null
    intent.actor.blockedTicks = 0
  }

  #isFleetOffRoad(vehicle) {
    return Boolean(vehicle.currentStopId)
      && !vehicle.targetStopId
      && !vehicle.route.length
  }

  #applyVehicleMove(vehicle, next) {
    vehicle.position = [...next]
    vehicle.currentStopId = null
    vehicle.route.shift()
    this.metrics.energy += vehicle.energyPerStep
    this.operatorMetrics[vehicle.operator].energy += vehicle.energyPerStep
    this.events.push({ type: 'move', vehicleId: vehicle.id, operator: vehicle.operator, position: [...vehicle.position] })

    if (!vehicle.route.length) {
      const arrivedStop = this.stopById.get(vehicle.targetStopId)
      if (arrivedStop && samePosition(vehicle.position, arrivedStop.position)) {
        vehicle.currentStopId = arrivedStop.id
        this.events.push({ type: 'arrive', vehicleId: vehicle.id, operator: vehicle.operator, stopId: arrivedStop.id })
      }
      vehicle.targetStopId = null
    }
  }

  #applyTrafficCarMove(car, next) {
    car.position = [...next]
    car.blockedTicks = 0
    car.route.shift()
    if (!car.route.length) car.destination = null
  }

  #competitionSnapshot() {
    if (!this.competitionEnabled) return { enabled: false }
    const scores = {
      human: operatorScore(this.operatorMetrics.human),
      ai: operatorScore(this.operatorMetrics.ai),
    }
    const leader = scores.human === scores.ai ? 'tie' : scores.human > scores.ai ? 'human' : 'ai'
    return {
      enabled: true,
      metrics: this.operatorMetrics,
      scores,
      leader,
      winner: this.isFinished() ? leader : null,
    }
  }

  #initializeTrafficLights() {
    for (const configured of this.scenario.trafficLights ?? []) {
      const key = roadKey(configured.position)
      if (!this.trafficLightCandidates.some((position) => roadKey(position) === key)) continue
      this.trafficLights[key] = {
        id: configured.id ?? `signal-${key}`,
        position: [...configured.position],
        phaseOffset: Number(configured.phaseOffset) || 0,
        createdAt: 0,
      }
    }
    while (Object.keys(this.trafficLights).length < this.trafficLightRules.initialCount) {
      if (!this.#addRandomTrafficLight(`initial-${Object.keys(this.trafficLights).length}`, false)) break
    }
  }

  #updateTrafficLights() {
    const interval = Number(this.trafficLightRules.updateInterval)
    if (!this.trafficLightRules.dynamic || interval <= 0 || this.time === 0 || this.time % interval !== 0) return
    const cycle = Math.floor(this.time / interval)
    const activeCount = Object.keys(this.trafficLights).length
    if (cycle % 2 === 1 && activeCount < this.trafficLightRules.maxActive) {
      this.#addRandomTrafficLight(`add-${this.time}`, true)
    } else if (activeCount > 0) {
      this.#removeRandomTrafficLight(`remove-${this.time}`)
    }
  }

  #addRandomTrafficLight(salt, emitEvent) {
    const available = this.trafficLightCandidates.filter((position) => !this.trafficLights[roadKey(position)])
    if (!available.length) return false
    const position = available[deterministicIndex(`${this.scenario.id}:${salt}:position`, available.length)]
    const key = roadKey(position)
    const cycleLength = Math.max(2, Number(this.trafficLightRules.phaseDuration) * 2)
    const light = {
      id: `signal-${key}`,
      position: [...position],
      phaseOffset: deterministicIndex(`${this.scenario.id}:${salt}:phase`, cycleLength),
      createdAt: this.time,
    }
    this.trafficLights[key] = light
    if (emitEvent) this.events.push({ type: 'traffic-light-added', lightId: light.id, position: [...position] })
    return true
  }

  #removeRandomTrafficLight(salt) {
    const active = Object.values(this.trafficLights).sort((left, right) => left.id.localeCompare(right.id))
    if (!active.length) return false
    const light = active[deterministicIndex(`${this.scenario.id}:${salt}`, active.length)]
    delete this.trafficLights[roadKey(light.position)]
    this.events.push({ type: 'traffic-light-removed', lightId: light.id, position: [...light.position] })
    return true
  }

  #trafficLightPhase(light) {
    const duration = Math.max(1, Number(this.trafficLightRules.phaseDuration) || 4)
    return Math.floor((this.time + light.phaseOffset) / duration) % 2 === 0 ? 'horizontal' : 'vertical'
  }

  #startTrafficEvents() {
    for (const event of this.scenario.trafficEvents ?? []) {
      if (event.at !== this.time) continue
      this.traffic[roadKey(event.position)] = {
        ...structuredClone(event),
        expiresAt: this.time + event.duration,
      }
      this.events.push({ type: 'traffic', label: event.label, position: [...event.position] })
    }
  }

  #expireTraffic() {
    for (const [key, event] of Object.entries(this.traffic)) {
      if (event.expiresAt <= this.time) delete this.traffic[key]
    }
  }

  #stop(id) {
    const stop = this.stopById.get(id)
    if (!stop) throw new Error(`Unknown stop: ${id}`)
    return stop
  }
}

function blankOperatorMetrics() {
  return {
    transported: 0,
    priorityTransported: 0,
    accessibleTransported: 0,
    boarded: 0,
    totalWait: 0,
    maxWait: 0,
    energy: 0,
  }
}

function operatorScore(metrics) {
  const averageWait = metrics.boarded ? metrics.totalWait / metrics.boarded : 0
  const points = metrics.transported * 4
    + metrics.priorityTransported * 1.5
    + metrics.accessibleTransported * 2
    - averageWait * 0.6
    - metrics.energy * 0.08
  return Math.round(Math.max(0, points) * 10) / 10
}

function deterministicIndex(seed, length) {
  if (length <= 0) return 0
  let hash = 2166136261
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
}

export function onboardCount(vehicle) {
  return vehicle.passengers.reduce((total, group) => total + group.count, 0)
}
