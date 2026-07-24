import { routeCost } from './routing.js'

export const defaultStrategyConfig = Object.freeze({
  strategyMode: 'optimized',
  priorityWeight: 12,
  queueAgeWeight: 2.5,
  distanceWeight: 3,
  occupancyWeight: 2,
  accessibilityWeight: 14,
  avoidTraffic: true,
  pooling: true,
  maxActiveVehicles: 3,
  homeStop: 'downtown',
  energySaving: false,
})

export function normalizeStrategyConfig(config = {}, limits = {}) {
  const stopIds = new Set(limits.stopIds ?? [])
  const maxVehicles = Math.max(1, limits.vehicleCount ?? 12)
  return {
    strategyMode: config.strategyMode === 'chaos' ? 'chaos' : 'optimized',
    priorityWeight: clamp(config.priorityWeight, 0, 50, defaultStrategyConfig.priorityWeight),
    queueAgeWeight: clamp(config.queueAgeWeight, 0, 10, defaultStrategyConfig.queueAgeWeight),
    distanceWeight: clamp(config.distanceWeight, 1, 10, defaultStrategyConfig.distanceWeight),
    occupancyWeight: clamp(config.occupancyWeight, 0, 10, defaultStrategyConfig.occupancyWeight),
    accessibilityWeight: clamp(config.accessibilityWeight, 0, 30, defaultStrategyConfig.accessibilityWeight),
    avoidTraffic: config.avoidTraffic !== false,
    pooling: config.pooling !== false,
    maxActiveVehicles: Math.round(clamp(config.maxActiveVehicles, 1, maxVehicles, Math.min(defaultStrategyConfig.maxActiveVehicles, maxVehicles))),
    homeStop: stopIds.has(config.homeStop) ? config.homeStop : (stopIds.has(defaultStrategyConfig.homeStop) ? defaultStrategyConfig.homeStop : [...stopIds][0]),
    energySaving: config.energySaving === true,
  }
}

export function createStrategy(rawConfig = defaultStrategyConfig) {
  return {
    name: 'City elevator dispatcher',

    decide(state) {
      const config = normalizeStrategyConfig(rawConfig, {
        vehicleCount: state.vehicles.length,
        stopIds: state.scenario.stops.map((stop) => stop.id),
      })
      if (config.strategyMode === 'chaos') return chaosDecisions(state)

      const decisions = {}
      const available = state.vehicles.filter((vehicle) => !vehicle.outOfService)
      const active = available.slice(0, config.maxActiveVehicles)
      const waiting = [...state.waiting]
      const reserved = new Set()

      for (const vehicle of active) {
        if (vehicle.route.length || vehicle.targetStopId) continue

        if (vehicle.passengers.length) {
          const destinations = [...new Set(vehicle.passengers.map((passenger) => passenger.to))]
          destinations.sort((left, right) => distanceToStop(vehicle, left, state, config) - distanceToStop(vehicle, right, state, config))
          decisions[vehicle.id] = destinations[0]
          continue
        }

        const candidates = waiting.filter((request) => {
          if (reserved.has(request.id)) return false
          if (request.requiresAccessible && !vehicle.accessible) return false
          return request.remaining > 0
        })
        candidates.sort((left, right) => requestCost(left, vehicle, state, config) - requestCost(right, vehicle, state, config))
        const chosen = candidates[0]
        if (chosen) {
          decisions[vehicle.id] = chosen.from
          reserved.add(chosen.id)
        } else if (!config.energySaving) {
          decisions[vehicle.id] = config.homeStop
        }
      }

      return decisions
    },
  }
}

function requestCost(request, vehicle, state, config) {
  const distance = distanceToStop(vehicle, request.from, state, config)
  const waited = state.time - request.at
  const priorityCredit = request.priority ? config.priorityWeight : 0
  const accessibilityCredit = request.requiresAccessible && vehicle.accessible ? config.accessibilityWeight : 0
  const capacityCredit = Math.min(vehicle.capacity, request.remaining) * config.occupancyWeight
  return distance * config.distanceWeight - waited * config.queueAgeWeight - priorityCredit - accessibilityCredit - capacityCredit
}

function distanceToStop(vehicle, stopId, state, config) {
  const stop = state.scenario.stops.find((candidate) => candidate.id === stopId)
  if (!stop) return Number.POSITIVE_INFINITY
  return routeCost(vehicle.position, stop.position, state.scenario.roads, state.traffic, config.avoidTraffic)
}

function chaosDecisions(state) {
  const decisions = {}
  const stops = state.scenario.stops
  state.vehicles.forEach((vehicle, index) => {
    if (!vehicle.outOfService && !vehicle.route.length && !vehicle.targetStopId) {
      decisions[vehicle.id] = stops[(state.time + index * 3) % stops.length].id
    }
  })
  return decisions
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}
