# Architecture

## Stable boundaries

```text
Static browser UI
  ├── Port Moresby map
  ├── elevator-style fleet cards
  ├── manual human destination controls
  ├── adaptive rival status
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
          └── bounded adaptive rival decisions (`src/strategy.js`)
```

The browser loads only static HTML, CSS, JavaScript, SVG, and scenario JSON. It does not require a chat backend, model provider, credentials, or a server-side runtime after deployment.

## Human control boundary

Human vehicles never receive automatic decisions from the simulation engine. The player selects a stop for each human vehicle and calls:

```js
game.dispatch(vehicleId, stopId, 'human')
```

The engine verifies that the selected vehicle belongs to the human operator, that the stop exists, and that a valid route can be found. Human dispatch may safely replace a vehicle's current route.

## Adaptive rival AI

The rival strategy returns only a map from AI vehicle IDs to stop IDs:

```json
{
  "ai-1": "waigani",
  "ai-2": "downtown"
}
```

`adaptiveStrategyProfile` selects one deterministic mode from current game state:

- **Energy saver** when no passenger queue exists
- **Balanced** during normal demand
- **Traffic-aware** when multiple road incidents are active
- **Queue surge** when passenger volume or waiting time is high
- **Catch-up** when the AI trails the human score

The selected bounded configuration is passed to the dispatcher. The AI cannot mutate the map, passengers, metrics, human vehicles, or vehicle positions directly.

## Determinism and testing

`src/engine.js`, `src/routing.js`, and `src/strategy.js` remain independent from the DOM and remote services. Tests cover manual operator isolation, routing, traffic, simulation outcomes, and adaptive mode selection.

## Static deployment

The GitHub Pages workflow runs the deterministic tests, copies only browser assets into a deployment artifact, and publishes the artifact. `server.js` is a small optional static server for local development.

## Planned scenarios

- Waigani morning commute
- Jacksons Airport arrival surge
- Koki accessibility demand
- Boroko road disruption
- Energy-limited service
- Vehicle breakdown
