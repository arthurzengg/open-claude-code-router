# open-claude-code-router

A transparent local proxy that wraps `@anthropic-ai/claude-code` and automatically routes requests across Anthropic models (Haiku / Sonnet / Opus) based on task complexity. Install once and keep using the `claude` command exactly as before — simple tasks go to cheap models, planning and deep reasoning go to the flagship.

## How it works

```
User types: claude "refactor this file"
                  |
         bin/claude.js (wrapper)
                  |
      starts local proxy if not running
                  |
    spawns real claude-code with
    ANTHROPIC_BASE_URL=http://127.0.0.1:3456
                  |
          localhost:3456 (proxy)
                  |
      classifies task complexity
      (heuristics + fast Haiku call)
                  |
         rewrites the model field:
         simple   -> claude-haiku-4-5
         default  -> claude-sonnet-4-6
         complex  -> claude-opus-4-8
                  |
         forwards to api.anthropic.com
                  |
         streams the response back
```

## Install

```bash
npm install -g @arthurzengg/open-claude-code-router
```

The package bundles `@anthropic-ai/claude-code` as a dependency and replaces the `claude` command with a thin wrapper. On uninstall, the original `claude` binary is restored automatically if it was previously installed.

## Requirements

- Node.js 18 or newer
- An Anthropic API key in the `ANTHROPIC_API_KEY` environment variable (same as Claude Code). Subscription-only (OAuth) setups are passed through but routing requires a key for the classifier call.

## Usage

Use `claude` exactly as before:

```bash
claude "help me refactor this module"
```

The proxy auto-starts in the background on first run. Each request is classified and routed to the appropriate model; you see no difference in the interface.

### Router commands

```bash
claude --router-status   # proxy health, routing rules, last decision
claude --router-log      # recent routing decisions
```

## Routing rules

| Complexity | Examples                                            | Model               |
| ---------- | --------------------------------------------------- | ------------------- |
| simple     | file read, grep, rename, trivial 1-2 line edit      | `claude-haiku-4-5`  |
| default    | multi-file edit, bug fix, tests, explanation        | `claude-sonnet-4-6` |
| complex    | architecture design, planning, deep reasoning       | `claude-opus-4-8`   |

Classification uses fast heuristics first; ambiguous cases fall back to a tiny Haiku API call (~50 input tokens, negligible cost). Requests that already target a Haiku model (Claude Code internal background calls) are passed through unchanged.

## Configuration and state

Runtime state lives in `~/.claude-router/`:

| File          | Purpose                                  |
| ------------- | ---------------------------------------- |
| `proxy.pid`   | PID of the background proxy process      |
| `port`        | Port the proxy bound to (3456-3466 scan) |
| `router.log`  | Routing decision history                 |
| `meta.json`   | Install-state metadata for clean removal |
| `config.json` | Optional routing rule overrides          |

### config.json

All fields are optional and merge over the defaults shown below. Edits apply on the next request — no proxy restart needed.

```json
{
  "models": {
    "simple": "claude-haiku-4-5",
    "default": "claude-sonnet-4-6",
    "complex": "claude-opus-4-8"
  },
  "maxOutput": { "simple": 64000, "default": 64000, "complex": 128000 },
  "haikuMaxTokens": 60000,
  "classifier": "auto"
}
```

- `models` — the model used for each complexity tier. Overriding a tier's model resets its `maxOutput` to a conservative 64000 unless you also set it explicitly.
- `maxOutput` — per-tier `max_tokens` ceiling; requests above it are clamped.
- `haikuMaxTokens` — estimated-input-token threshold above which a conversation is floored at the default tier (long conversations should not run on the small model).
- `classifier` — `auto` (heuristics, then a small Haiku call for ambiguous cases) or `heuristics-only` (never make classification API calls; ambiguous requests use the default tier).

### Routing behavior

Routing is decided once per conversation and cached in the proxy: follow-up calls in the same session (tool round-trips, later turns) reuse the decision, and mid-session changes are one-way upgrades only. This keeps Anthropic's model-scoped prompt cache warm — flipping models mid-conversation would invalidate it. When a request is rewritten to a smaller model, parameters the target does not support (adaptive thinking, `output_config.effort`) are stripped and `max_tokens` is clamped, so rewrites never produce invalid requests.

## Uninstall

```bash
npm uninstall -g @arthurzengg/open-claude-code-router
```

This kills the background proxy and reinstalls the original `@anthropic-ai/claude-code` if it was present before.

## Limitations

- Only `api.anthropic.com` is supported as upstream (no Bedrock / Vertex).
- POSIX only (macOS / Linux); Windows is not supported in v1.
- The classifier adds one small Haiku call per routed request unless a heuristic fast-path matches.

## License

MIT
