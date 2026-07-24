# Architecture

## Stable boundaries

```text
Browser UI
  ├── Port Moresby map
  ├── elevator-style fleet cards
  ├── named stop / floor-call panel
  └── metrics and event log
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
          └── bounded decisions (`src/strategy.js`)
```

The strategy returns only a map from vehicle IDs to stop IDs:

```json
{
  "lift-a": "waigani",
  "lift-b": "downtown"
}
```

It cannot mutate the map, passenger state, metrics, or vehicle positions.

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
