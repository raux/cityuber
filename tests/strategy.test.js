import test from 'node:test'
import assert from 'node:assert/strict'

import { createStrategy } from '../src/strategy.js'

const scenario = {
  roads: [[0,0],[1,0],[2,0]],
  stops: [
    { id: 'a', position: [0,0] },
    { id: 'b', position: [2,0] },
  ],
}

function state(overrides = {}) {
  return {
    scenario,
    time: 5,
    traffic: {},
    waiting: [],
    vehicles: [{
      id: 'lift-a', position: [0,0], capacity: 4, accessible: true,
      route: [], targetStopId: null, passengers: [], outOfService: false,
    }],
    ...overrides,
  }
}

test('dispatcher sends an empty vehicle to a waiting origin', () => {
  const waiting = [{ id: 'r1', at: 0, from: 'b', to: 'a', remaining: 2, priority: false }]
  assert.deepEqual(createStrategy().decide(state({ waiting })), { 'lift-a': 'b' })
})

test('onboard passenger destination takes precedence', () => {
  const vehicles = [{
    ...state().vehicles[0],
    passengers: [{ requestId: 'r1', to: 'b', count: 1 }],
  }]
  assert.deepEqual(createStrategy().decide(state({ vehicles })), { 'lift-a': 'b' })
})
