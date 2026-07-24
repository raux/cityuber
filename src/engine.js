import { findRoute, roadKey, samePosition } from './routing.js'

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
    this.traffic = {}
    this.requests = this.scenario.requests.map((request, index) => ({
      id: `request-${index + 1}`,
      status: 'pending',
      remaining: request.passengers,
      delivered: 0,
      ...structuredClone(request),
    }))
    this.pending = [...this.requests].sort((left, right) => left.at - right.at)
    this.waiting = []
    this.vehicles = this.scenario.vehicles.map((vehicle) => {
      const start = this.#stop(vehicle.startStop)
      return {
        ...structuredClone(vehicle),
        position: [...start.position],
        currentStopId: start.id,
        targetStopId: null,
        route: [],
        passengers: [],
        outOfService: false,
      }
    })
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

  dispatch(vehicleId, stopId) {
    const vehicle = this.vehicles.find((candidate) => candidate.id === vehicleId)
    const stop = this.stopById.get(stopId)
    if (!vehicle || !stop || vehicle.outOfService) return false
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
    this.events.push({ type: 'dispatch', vehicleId, stopId })
    return true
  }

  step() {
    this.events = []
    if (this.isFinished()) return this.snapshot()

    this.#expireTraffic()
    this.#spawnRequests()
    this.#startTrafficEvents()

    for (const vehicle of this.vehicles) this.#serviceCurrentStop(vehicle)

    const decisions = this.strategy?.decide(this.snapshot()) ?? {}
    for (const vehicle of this.vehicles) {
      if (!vehicle.route.length && !vehicle.targetStopId && decisions[vehicle.id]) {
        this.dispatch(vehicle.id, decisions[vehicle.id])
      }
    }

    for (const vehicle of this.vehicles) this.#moveVehicle(vehicle)
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
      requests: this.requests,
      waiting: this.waiting.map((request) => ({ ...request, waited: this.time - request.at })),
      traffic: this.traffic,
      events: this.events,
      metrics: this.metrics,
      score: this.score(),
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
    for (const group of vehicle.passengers) {
      if (group.to !== stopId) {
        staying.push(group)
        continue
      }
      const request = this.requests.find((candidate) => candidate.id === group.requestId)
      if (request) {
        request.delivered += group.count
        if (request.delivered >= request.passengers) {
          request.status = 'completed'
          this.metrics.completedRequests += 1
        }
      }
      this.metrics.transported += group.count
      if (group.requiresAccessible) this.metrics.accessibleTransported += group.count
      this.events.push({ type: 'exit', vehicleId: vehicle.id, stopId, requestId: group.requestId, count: group.count })
    }
    vehicle.passengers = staying
  }

  #board(vehicle, stopId) {
    let available = vehicle.capacity - onboardCount(vehicle)
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
        boardedAt: this.time,
      })
      request.remaining -= count
      request.status = request.remaining ? 'partly-boarded' : 'onboard'
      available -= count
      this.metrics.totalWait += wait * count
      this.metrics.maxWait = Math.max(this.metrics.maxWait, wait)
      const stopWait = this.metrics.stopWaits[stopId] ?? { total: 0, count: 0 }
      stopWait.total += wait * count
      stopWait.count += count
      this.metrics.stopWaits[stopId] = stopWait
      this.events.push({ type: 'board', vehicleId: vehicle.id, stopId, requestId: request.id, count })
    }
    this.waiting = this.waiting.filter((request) => request.remaining > 0)
  }

  #moveVehicle(vehicle) {
    if (vehicle.outOfService || !vehicle.route.length) return
    const next = vehicle.route[0]
    const congestion = this.traffic[roadKey(next)]
    if (congestion && this.time % (congestion.severity + 1) !== 0) {
      this.events.push({ type: 'traffic-delay', vehicleId: vehicle.id, position: [...next] })
      return
    }

    vehicle.position = [...next]
    vehicle.currentStopId = null
    vehicle.route.shift()
    this.metrics.energy += vehicle.energyPerStep
    this.events.push({ type: 'move', vehicleId: vehicle.id, position: [...vehicle.position] })

    if (!vehicle.route.length) {
      const arrivedStop = this.stopById.get(vehicle.targetStopId)
      if (arrivedStop && samePosition(vehicle.position, arrivedStop.position)) {
        vehicle.currentStopId = arrivedStop.id
        this.events.push({ type: 'arrive', vehicleId: vehicle.id, stopId: arrivedStop.id })
      }
      vehicle.targetStopId = null
    }
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

export function onboardCount(vehicle) {
  return vehicle.passengers.reduce((total, group) => total + group.count, 0)
}
