# CityUber project guidance

- Keep `src/engine.js` deterministic and independent from UI or model providers.
- Keep road routing in `src/routing.js` and scenario content under `scenarios/`.
- Treat strategy configuration—not generated code—as the future AI-editable boundary.
- Never expose Pi credentials or provider headers to the browser.
- Require deterministic evaluation and explicit approval before activating AI proposals.
- Preserve the stylized-map accuracy notice; this application is not a navigation tool.
- Add tests for simulation, routing, strategy, scoring, and scenario changes.
- Run `npm test` before committing.
- Never commit credentials, private chat, runtime logs, or generated candidate state.
