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
