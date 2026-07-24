import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import { CityUberSimulation } from '../src/engine.js'
import { roadKey } from '../src/routing.js'
import { createStrategy } from '../src/strategy.js'

const scenario = JSON.parse(await readFile(new URL('../scenarios/morning-rush.json', import.meta.url), 'utf8'))

test('every named stop and vehicle depot is on the road network', () => {
  const roads = new Set(scenario.roads.map(roadKey))
  const stopById = new Map(scenario.stops.map((stop) => [stop.id, stop]))
  for (const stop of scenario.stops) assert.ok(roads.has(roadKey(stop.position)), `${stop.name} must be on a road`)
  for (const vehicle of scenario.vehicles) assert.ok(stopById.has(vehicle.startStop), `${vehicle.name} must start at a known stop`)
})

test('passenger requests use known, distinct stops', () => {
  const stopIds = new Set(scenario.stops.map((stop) => stop.id))
  for (const request of scenario.requests) {
    assert.ok(stopIds.has(request.from))
    assert.ok(stopIds.has(request.to))
    assert.notEqual(request.from, request.to)
    assert.ok(request.passengers > 0)
  }
})

test('the complete morning scenario is deterministic and meets its objectives', () => {
  const run = () => {
    const game = new CityUberSimulation(scenario, createStrategy())
    while (!game.isFinished()) game.step()
    return game.score()
  }
  const first = run()
  const second = run()
  assert.deepEqual(first, second)
  assert.equal(first.completedRequests, scenario.requests.length)
  assert.equal(first.transported, 59)
  assert.equal(first.passed, true)
})
