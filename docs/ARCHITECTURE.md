# Architecture

## Stable boundaries

```text
Browser UI
  ├── Port Moresby map
  ├── elevator-style fleet cards
  ├── per-vehicle human algorithm controls
  ├── conversational Pi fleet-agent chat
  └── rival metrics and event log
          │
          ▼
Deterministic simulation (`src/engine.js`)
  ├── requests and stop queues
  ├── boarding and exiting
  ├── vehicle capacity
  ├── traffic delays
  └── scoring
          │
          ├── road routing (`src/routing.js`)
          ├── deterministic human algorithms (`src/engine.js`)
          └── bounded rival decisions (`src/strategy.js`)
```

The rival strategy returns only a map from vehicle IDs to stop IDs:

```json
{
  "lift-a": "waigani",
  "lift-b": "downtown"
}
```

It cannot mutate the map, passenger state, metrics, or vehicle positions.

## Pi fleet-agent boundary

`server.js` embeds Pi through the SDK using an in-memory, tool-free session. Credentials are resolved only on the Node server and never sent to the browser. Every response is reduced to conversational text and an allowlisted action schema:

```json
{
  "reply": "H1 is now prioritizing older calls.",
  "actions": [
    { "type": "set_algorithm", "vehicleId": "human-1", "algorithm": "oldest" }
  ]
}
```

The browser and engine validate vehicle IDs, stop IDs, operators, and algorithm names before applying an action. Pi cannot modify simulation state directly.

## Next phase: Pi strategy laboratory

Adapt the candidate lifecycle from `tower-agents`:

1. User asks to improve service, waiting, energy, accessibility, or fairness.
2. A tool-free Pi session proposes bounded strategy configuration.
3. Server normalization rejects unknown keys and clamps values.
4. Baseline and candidate run against deterministic scenarios.
5. UI shows a configuration diff and metric trade-offs.
6. Human approves or rejects the candidate.
7. Approved revisions can be rolled back.

Initial allowlisted configuration:

```json
{
  "strategyMode": "optimized",
  "priorityWeight": 12,
  "queueAgeWeight": 2.5,
  "distanceWeight": 3,
  "occupancyWeight": 2,
  "accessibilityWeight": 14,
  "avoidTraffic": true,
  "pooling": true,
  "maxActiveVehicles": 3,
  "homeStop": "downtown",
  "energySaving": false
}
```

AI must never generate or execute simulation code in the MVP workflow.

## Planned scenarios

- Waigani morning commute
- Jacksons Airport arrival surge
- Koki accessibility demand
- Boroko road disruption
- Energy-limited service
- Vehicle breakdown
