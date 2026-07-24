# CityUber

CityUber is an elevator-inspired public-transport simulation on a stylized Port Moresby map. Named city stops act like floors, passenger requests act like floor calls, and buses or shuttles act like elevator cars moving through a horizontal road “shaft.”

> Status: working deterministic MVP. The map is designed for simulation and is not geographically precise or suitable for navigation.

## MVP features

- Eight named Port Moresby-inspired stops
- Connected road network and traffic-aware shortest paths
- Three CityLift vehicles with different capacities and accessibility
- Passenger calls, waiting, partial boarding, travel, and exiting
- Multiple onboard destinations
- Automated elevator-style dispatch
- Manual floor-call panel for sending a selected vehicle to a stop
- Temporary traffic events
- Live throughput, waiting, energy, accessibility, fairness, and score metrics
- Deterministic Node tests

## Elevator metaphor

| Elevator system | CityUber |
|---|---|
| Floor | Named city stop |
| Elevator car | CityLift vehicle |
| Floor call | Passenger pickup request |
| Destination floor | Destination stop |
| Shaft | Connected road network |
| Doors opening | Boarding and exiting |
| Controller | Dispatch strategy |
| Shaft congestion | Road traffic |

## Run

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

The deterministic simulation lives in `src/engine.js`. Routing is isolated in `src/routing.js`, and the bounded dispatcher lives in `src/strategy.js`. Scenario data remains declarative under `scenarios/`.

The browser can manually dispatch a vehicle to a named stop, but the engine retains control of road routing, traffic delays, boarding, capacity, and metrics.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the next Pi-assisted phase.

## Privacy and AI boundary

The MVP does not call an AI provider. A future phase will adapt Tower Agents’ Pi workflow so models can propose only validated strategy configuration. Candidates will be evaluated deterministically and require human approval before activation.

## Attribution

CityUber combines architectural ideas explored in Raul’s `tower-agents` and `dispatch-rivals` prototypes. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT
