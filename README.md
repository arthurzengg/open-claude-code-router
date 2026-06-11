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

| File         | Purpose                                  |
| ------------ | ---------------------------------------- |
| `proxy.pid`  | PID of the background proxy process      |
| `port`       | Port the proxy bound to (3456-3466 scan) |
| `router.log` | Routing decision history                 |
| `meta.json`  | Install-state metadata for clean removal |

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
