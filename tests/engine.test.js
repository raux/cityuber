import test from 'node:test'
import assert from 'node:assert/strict'

import { CityUberSimulation } from '../src/engine.js'
import { createStrategy } from '../src/strategy.js'

const scenario = {
  id: 'test', name: 'Test', width: 2, height: 1, duration: 5,
  roads: [[0,0],[1,0]],
  stops: [
    { id: 'a', name: 'A', position: [0,0] },
    { id: 'b', name: 'B', position: [1,0] },
  ],
  vehicles: [{ id: 'lift-a', name: 'Lift A', type: 'car', capacity: 2, accessible: true, energyPerStep: 1, startStop: 'a' }],
  requests: [{ at: 0, from: 'a', to: 'b', passengers: 2, type: 'commute' }],
  objectives: { transported: 2, maxWait: 2, energy: 4 },
}

test('passengers call, board, travel, and exit deterministically', () => {
  const game = new CityUberSimulation(scenario, createStrategy({ homeStop: 'a' }))
  const first = game.step()
  assert.equal(first.vehicles[0].position[0], 1)
  assert.equal(first.vehicles[0].passengers[0].count, 2)
  assert.equal(first.metrics.transported, 0)

  const second = game.step()
  assert.equal(second.metrics.transported, 2)
  assert.equal(second.metrics.completedRequests, 1)
  assert.equal(second.metrics.energy, 2)
  assert.equal(second.score.passed, true)
})

test('manual dispatch rejects an unknown stop', () => {
  const game = new CityUberSimulation(scenario, createStrategy())
  assert.equal(game.dispatch('lift-a', 'missing'), false)
  assert.equal(game.dispatch('lift-a', 'b'), true)
})

test('competitive mode isolates human and AI dispatch control', () => {
  const competitiveScenario = {
    id: 'competition-control-test', name: 'Competition control test', width: 2, height: 1, duration: 4,
    competition: { enabled: true },
    roads: [[0,0],[1,0]],
    stops: [
      { id: 'a', name: 'A', position: [0,0] },
      { id: 'b', name: 'B', position: [1,0] },
    ],
    vehicles: [
      { id: 'human', name: 'Human', operator: 'human', type: 'car', capacity: 2, accessible: true, energyPerStep: 1, startStop: 'a' },
      { id: 'ai', name: 'AI', operator: 'ai', type: 'car', capacity: 2, accessible: true, energyPerStep: 1, startStop: 'b' },
    ],
    requests: [{ at: 0, from: 'a', to: 'b', passengers: 2, type: 'priority', priority: true }],
    objectives: { transported: 2, maxWait: 4, energy: 8 },
  }
  const game = new CityUberSimulation(competitiveScenario, null)
  assert.equal(game.dispatch('ai', 'a'), false)

  const waitingForHuman = game.step()
  assert.deepEqual(waitingForHuman.vehicles.find((vehicle) => vehicle.id === 'human').position, [0,0])
  assert.equal(waitingForHuman.vehicles.find((vehicle) => vehicle.id === 'human').targetStopId, null)

  assert.equal(game.dispatch('human', 'b'), true)
  const moving = game.step()
  assert.deepEqual(moving.vehicles.find((vehicle) => vehicle.id === 'human').position, [1,0])
  const final = game.step()
  assert.equal(final.competition.metrics.human.transported, 2)
  assert.equal(final.competition.metrics.ai.transported, 0)
  assert.ok(final.competition.scores.human > 0)
})

test('vehicles reserve intersections instead of colliding', () => {
  const collisionScenario = {
    id: 'collision-test', name: 'Collision test', width: 3, height: 1, duration: 2,
    roads: [[0,0],[1,0],[2,0]],
    stops: [
      { id: 'left', name: 'Left', position: [0,0] },
      { id: 'center', name: 'Center', position: [1,0] },
      { id: 'right', name: 'Right', position: [2,0] },
    ],
    vehicles: [
      { id: 'car-a', name: 'Car A', type: 'car', capacity: 1, accessible: false, energyPerStep: 1, startStop: 'left' },
      { id: 'car-b', name: 'Car B', type: 'car', capacity: 1, accessible: false, energyPerStep: 1, startStop: 'right' },
    ],
    requests: [],
    objectives: { transported: 0, maxWait: 10, energy: 10 },
  }
  const game = new CityUberSimulation(collisionScenario, null)
  assert.equal(game.dispatch('car-a', 'center'), true)
  assert.equal(game.dispatch('car-b', 'center'), true)

  const state = game.step()
  const positions = state.vehicles.map((vehicle) => vehicle.position.join(','))
  assert.equal(new Set(positions).size, positions.length)
  assert.equal(state.events.some((event) => event.type === 'collision-wait'), true)
})

test('vehicles stop when their traffic-light axis is red', () => {
  const signalScenario = {
    id: 'signal-test', name: 'Signal test', width: 3, height: 3, duration: 8,
    roads: [[1,0],[0,1],[1,1],[2,1],[1,2]],
    stops: [
      { id: 'left', name: 'Left', position: [0,1] },
      { id: 'right', name: 'Right', position: [2,1] },
    ],
    vehicles: [{ id: 'car-a', name: 'Car A', type: 'car', capacity: 1, accessible: false, energyPerStep: 1, startStop: 'left' }],
    requests: [],
    trafficLightRules: { dynamic: false, phaseDuration: 4 },
    trafficLights: [{ id: 'center-signal', position: [1,1], phaseOffset: 4 }],
    objectives: { transported: 0, maxWait: 10, energy: 10 },
  }
  const game = new CityUberSimulation(signalScenario, null)
  assert.equal(game.dispatch('car-a', 'right'), true)

  const redState = game.step()
  assert.deepEqual(redState.vehicles[0].position, [0,1])
  assert.equal(redState.events.some((event) => event.type === 'traffic-light-wait'), true)

  let greenState = redState
  for (let index = 0; index < 4; index += 1) greenState = game.step()
  assert.deepEqual(greenState.vehicles[0].position, [1,1])
})

test('dynamic traffic lights are added and removed deterministically', () => {
  const dynamicScenario = {
    id: 'dynamic-signal-test', name: 'Dynamic signal test', width: 3, height: 2, duration: 6,
    roads: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
    stops: [], vehicles: [], requests: [],
    trafficLightRules: { dynamic: true, initialCount: 1, maxActive: 2, updateInterval: 2, phaseDuration: 2 },
    objectives: { transported: 0, maxWait: 10, energy: 10 },
  }
  const first = new CityUberSimulation(dynamicScenario, null)
  const second = new CityUberSimulation(dynamicScenario, null)

  let added = false
  let removed = false
  for (let index = 0; index < 5; index += 1) {
    const firstState = first.step()
    const secondState = second.step()
    assert.deepEqual(firstState.trafficLights, secondState.trafficLights)
    added ||= firstState.events.some((event) => event.type === 'traffic-light-added')
    removed ||= firstState.events.some((event) => event.type === 'traffic-light-removed')
  }
  assert.equal(added, true)
  assert.equal(removed, true)
})

test('ambient traffic cars move deterministically without overlapping', () => {
  const trafficScenario = {
    id: 'ambient-traffic-test', name: 'Ambient traffic test', width: 3, height: 2, duration: 8,
    roads: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
    stops: [], vehicles: [], requests: [],
    ambientTraffic: { count: 4 },
    objectives: { transported: 0, maxWait: 10, energy: 10 },
  }
  const first = new CityUberSimulation(trafficScenario, null)
  const second = new CityUberSimulation(trafficScenario, null)
  assert.equal(first.snapshot().trafficCars.length, 4)

  for (let index = 0; index < 6; index += 1) {
    const firstState = first.step()
    const secondState = second.step()
    assert.deepEqual(firstState.trafficCars, secondState.trafficCars)
    const positions = firstState.trafficCars.map((car) => car.position.join(','))
    assert.equal(new Set(positions).size, positions.length)
  }
})
