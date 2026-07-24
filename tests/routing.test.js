import test from 'node:test'
import assert from 'node:assert/strict'

import { findRoute, routeCost } from '../src/routing.js'

const roads = [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]

test('findRoute follows connected road cells', () => {
  assert.deepEqual(findRoute([0,0], [2,0], roads), [[1,0],[2,0]])
})

test('traffic-aware routing chooses a longer clear path', () => {
  const traffic = { '1,0': { severity: 2 } }
  assert.deepEqual(findRoute([0,0], [2,0], roads, traffic, true), [[0,1],[1,1],[2,1],[2,0]])
  assert.deepEqual(findRoute([0,0], [2,0], roads, traffic, false), [[1,0],[2,0]])
  assert.equal(routeCost([0,0], [2,0], roads, traffic, true), 4)
})
