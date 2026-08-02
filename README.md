# CityUber

CityUber is an elevator-inspired public-transport simulation on a stylized Port Moresby map. Named city stops act like floors, passenger requests act like floor calls, and buses or shuttles act like elevator cars moving through a horizontal road “shaft.”

> The map is designed for simulation and is not geographically precise or suitable for navigation.

## Play online

Open [CityUber on GitHub Pages](https://raux.github.io/cityuber/).

## Features

- Eight Port Moresby-inspired stops on a connected road network
- Two human CityLifts controlled only through manual destination dispatch
- Adaptive rival AI that switches among energy-saving, balanced, traffic-aware, queue-surge, and catch-up behavior
- Passenger calls, waiting, partial boarding, travel, and exiting
- Traffic-aware routing, temporary congestion, traffic lights, and ambient cars
- Collision-safe intersection reservations
- Rival scoring for delivery, waiting, accessibility, and energy performance
- SVG fleet and passenger animation
- Responsive browser UI
- Deterministic Node tests
- Automated GitHub Pages deployment

## Human versus AI

The human player chooses every destination for H1 and H2 using the **Manual fleet dispatch** controls. Human vehicles never select stops automatically.

The rival fleet is fully automated. Its deterministic adaptive strategy observes queue pressure, maximum waiting time, active traffic events, and the current competition score, then changes operating mode without using a remote model or service.

## Elevator metaphor

| Elevator system | CityUber |
|---|---|
| Floor | Named city stop |
| Elevator car | CityLift vehicle |
| Floor call | Passenger pickup request |
| Destination floor | Destination stop |
| Shaft | Connected road network |
| Doors opening | Boarding and exiting |
| Controller | Human dispatch or adaptive rival strategy |
| Shaft congestion | Road traffic |

## Run locally

Node.js 22.19 or newer is recommended.

```bash
npm start
```

Open <http://127.0.0.1:4190/>.

## Test

```bash
npm test
```

## Architecture

The deterministic simulation lives in `src/engine.js`. Routing is isolated in `src/routing.js`, while bounded rival decisions and adaptive strategy selection live in `src/strategy.js`. Scenario data remains declarative under `scenarios/`.

The static browser application has no chat backend, credentials, model dependency, or remote AI API. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Attribution

CityUber combines architectural ideas explored in Raul’s `tower-agents` and `dispatch-rivals` prototypes. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT
