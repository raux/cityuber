# CityUber

CityUber is an elevator-inspired public-transport simulation on a stylized Port Moresby map. Named city stops act like floors, passenger requests act like floor calls, and buses or shuttles act like elevator cars moving through a horizontal road “shaft.”

> Status: working deterministic MVP. The map is designed for simulation and is not geographically precise or suitable for navigation.

## MVP features

- Eight named Port Moresby-inspired stops
- Connected road network and traffic-aware shortest paths
- Two human CityLifts controlled by selectable algorithms and a conversational Pi fleet agent
- Passenger calls, waiting, partial boarding, travel, and exiting
- Animated human figures for new queues, boarding, and exiting
- SVG car, shuttle, and minibus silhouettes with visible onboard passengers
- Direction-aware vehicle motion with smooth horizontal/vertical turns
- Collision-safe intersection reservations so vehicles yield instead of overlapping
- Phase-based traffic lights that stop horizontal or vertical traffic on red
- Deterministic dynamic traffic lights that are added and removed during a run
- Ten seeded ambient cars that circulate continuously and create realistic congestion
- Rival Operators scoring with separate delivery, waiting, accessibility, and energy results
- Tool-free server-side Pi chat for conversation, dispatch instructions, and algorithm changes
- Nearest-call, oldest-call, accessibility-priority, and energy-saving human fleet controls
- Easy, Medium, and Hard deterministic rival AI strategy presets
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

The Pi fleet chat prefers the lightweight local LM Studio model `google/gemma-4-e2b` when available, then falls back to another configured Pi model. Override selection with a full provider/model key:

```bash
CITYUBER_PI_MODEL=lmstudio/google/gemma-4-e2b npm start
```

## Test

```bash
npm test
```

## Architecture

The deterministic simulation lives in `src/engine.js`. Routing is isolated in `src/routing.js`, and the bounded dispatcher lives in `src/strategy.js`. Scenario data remains declarative under `scenarios/`.

Human vehicles run selected deterministic algorithms, while the server-side Pi fleet agent can discuss the game and submit validated dispatch or algorithm-change actions. The engine retains control of road routing, traffic delays, boarding, capacity, and metrics.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the next Pi-assisted phase.

## Privacy and AI boundary

Pi credentials remain server-side and are never exposed to the browser. The embedded chat session has no shell, filesystem, or coding tools; its output is restricted to conversational text plus validated human-fleet dispatch and algorithm actions. Deterministic engine evaluation remains separate from model conversation.

## Attribution

CityUber combines architectural ideas explored in Raul’s `tower-agents` and `dispatch-rivals` prototypes. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT
