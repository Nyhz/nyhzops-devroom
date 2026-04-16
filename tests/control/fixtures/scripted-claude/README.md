# scripted-claude

A deterministic stand-in for the `claude` CLI used by CONTROL tests. It reads a
scenario JSON file and replays pre-canned stream events to stdout with
configurable per-event delays, optional stderr, optional pre-event hang, and a
configurable exit code. No network, no LLM, fully reproducible.

## Scenario schema

See [`scenario.ts`](./scenario.ts) for the authoritative `Scenario` and
`ScenarioEvent` types. Scenario files live under
[`../scenarios/`](../scenarios/) (e.g. `happy-path-combat.json`).

## Manual run

```sh
SCRIPTED_CLAUDE_SCENARIO=tests/control/fixtures/scenarios/happy-path-combat.json \
  tsx tests/control/fixtures/scripted-claude/scripted-claude.ts
```

Each stdout line is a JSON-encoded `ScenarioEvent`. The process exits with
`scenario.exitCode` (default `0`); missing env var exits `2`.

## Intended callers

CONTROL unit and integration tests under `tests/control/` spawn this fixture in
place of the real `claude` binary to drive mission lifecycles deterministically.
It is not intended for production code.
