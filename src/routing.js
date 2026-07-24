export function roadKey(position) {
  return `${position[0]},${position[1]}`
}

export function samePosition(left, right) {
  return left[0] === right[0] && left[1] === right[1]
}

export function findRoute(from, to, roads, traffic = {}, avoidTraffic = true) {
  const roadSet = roads instanceof Set ? roads : new Set(roads.map(roadKey))
  const start = roadKey(from)
  const destination = roadKey(to)
  if (!roadSet.has(start) || !roadSet.has(destination)) return []
  if (start === destination) return []

  const costs = new Map([[start, 0]])
  const previous = new Map()
  const queue = [{ position: [...from], cost: 0 }]

  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost || roadKey(left.position).localeCompare(roadKey(right.position)))
    const current = queue.shift()
    const currentKey = roadKey(current.position)
    if (current.cost !== costs.get(currentKey)) continue
    if (currentKey === destination) break

    for (const neighbor of neighbors(current.position)) {
      const neighborKey = roadKey(neighbor)
      if (!roadSet.has(neighborKey)) continue
      const congestion = avoidTraffic ? (traffic[neighborKey]?.severity ?? 0) * 4 : 0
      const nextCost = current.cost + 1 + congestion
      if (nextCost >= (costs.get(neighborKey) ?? Infinity)) continue
      costs.set(neighborKey, nextCost)
      previous.set(neighborKey, currentKey)
      queue.push({ position: neighbor, cost: nextCost })
    }
  }

  if (!costs.has(destination)) return []
  const route = []
  let cursor = destination
  while (cursor !== start) {
    route.push(cursor.split(',').map(Number))
    cursor = previous.get(cursor)
  }
  return route.reverse()
}

export function routeCost(from, to, roads, traffic = {}, avoidTraffic = true) {
  if (samePosition(from, to)) return 0
  const route = findRoute(from, to, roads, traffic, avoidTraffic)
  if (!route.length) return Number.POSITIVE_INFINITY
  return route.reduce((total, position) => {
    const congestion = avoidTraffic ? (traffic[roadKey(position)]?.severity ?? 0) * 4 : 0
    return total + 1 + congestion
  }, 0)
}

export function roadConnections(position, roads) {
  const roadSet = roads instanceof Set ? roads : new Set(roads.map(roadKey))
  const directions = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']]
  return directions
    .filter(([dx, dy]) => roadSet.has(roadKey([position[0] + dx, position[1] + dy])))
    .map(([, , direction]) => direction)
}

function neighbors([x, y]) {
  return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]
}
