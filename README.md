# autocad-2026-mcp

MCP (Model Context Protocol) server for AutoCAD 2026 on Windows, built with [Effect](https://effect.website) and [Bun](https://bun.sh). It lets MCP clients (Claude Code, Claude Desktop, or any other MCP client) inspect and modify the drawing that is currently open in a running AutoCAD instance.

## How it works

The server talks to AutoCAD through its AutoLISP API using a small bridge plugin ([plugin/autocad-mcp.lsp](plugin/autocad-mcp.lsp)):

1. For each tool call the server writes an AutoLISP expression to a request file in the exchange directory.
2. It triggers AutoCAD over COM (`AutoCAD.Application` via Windows PowerShell) with a single `SendCommand` that loads the plugin on first use and calls `(mcp:execute <request> <response>)`.
3. The plugin evaluates the expression with full error trapping, serializes the result to JSON (entity names become handle strings, dotted pairs become two-element arrays), and writes the response file atomically.
4. The server polls for the response, decodes it with `effect/Schema`, and returns it as the MCP tool result.

Requests are serialized through a semaphore because AutoCAD is single-threaded. No manual plugin installation is needed: the trigger loads `plugin/autocad-mcp.lsp` automatically the first time a tool runs in an AutoCAD session.

## Requirements

- Windows with AutoCAD 2026 running and a drawing open
- [Bun](https://bun.sh)

## Setup

```sh
bun install
```

Register the server with your MCP client. For Claude Code:

```sh
claude mcp add autocad -- bun run C:/path/to/autocad-2026-mcp/src/main.ts
```

Or in a `.mcp.json` / MCP client config:

```json
{
  "mcpServers": {
    "autocad": {
      "command": "bun",
      "args": ["run", "C:/path/to/autocad-2026-mcp/src/main.ts"]
    }
  }
}
```

Start AutoCAD 2026, open a drawing, and call `autocad_status` to verify the connection.

## Tools

| Tool                | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `autocad_status`    | Connection check: AutoCAD version, drawing name/directory, current layer, unsaved changes       |
| `evaluate_lisp`     | Evaluate raw AutoLISP code and return the last value as JSON (escape hatch for everything else) |
| `save_drawing`      | Save the active drawing                                                                         |
| `zoom_extents`      | Zoom the active viewport to the drawing extents                                                 |
| `create_line`       | Line between two points                                                                         |
| `create_circle`     | Circle from center and radius                                                                   |
| `create_arc`        | Arc from center, radius, start/end angles in degrees                                            |
| `create_polyline`   | 2D lightweight polyline, optionally closed                                                      |
| `create_text`       | Single-line text                                                                                |
| `list_entities`     | List entities (handle, type, layer) with optional DXF type filter and limit                     |
| `get_entity`        | Full DXF group data of one entity                                                               |
| `erase_entities`    | Erase entities by handle                                                                        |
| `move_entities`     | Move entities by a displacement vector                                                          |
| `rotate_entities`   | Rotate entities around a base point (degrees)                                                   |
| `scale_entities`    | Scale entities uniformly around a base point                                                    |
| `list_layers`       | Layers with color index and off/frozen/locked state                                             |
| `create_layer`      | Create a layer, optionally with a color index                                                   |
| `set_current_layer` | Make an existing layer current                                                                  |
| `list_blocks`       | Named block definitions in the drawing                                                          |
| `insert_block`      | Insert a block reference into model space                                                       |

Creation tools return the handle of the new entity; handles are the stable ids used by all entity tools. Angles are always degrees at the MCP boundary and converted to radians internally.

## Configuration

All settings are environment variables with sensible defaults:

| Variable                       | Default                                 | Purpose                                     |
| ------------------------------ | --------------------------------------- | ------------------------------------------- |
| `AUTOCAD_MCP_EXCHANGE_DIR`     | `%TEMP%/autocad-mcp`                    | Directory for request/response files        |
| `AUTOCAD_MCP_PLUGIN_PATH`      | `plugin/autocad-mcp.lsp` (in this repo) | AutoLISP bridge plugin to load              |
| `AUTOCAD_MCP_POWERSHELL_PATH`  | `powershell.exe`                        | Windows PowerShell used for the COM trigger |
| `AUTOCAD_MCP_RESPONSE_TIMEOUT` | `60 seconds`                            | How long to wait for AutoCAD to answer      |
| `AUTOCAD_MCP_POLL_INTERVAL`    | `100 millis`                            | Response file polling interval              |

Windows PowerShell 5.1 (`powershell.exe`) is required for the trigger because `Marshal.GetActiveObject` is unavailable in PowerShell 7+.

## Caveats

- AutoCAD must be idle: a command prompt in mid-command or an open modal dialog delays or rejects `SendCommand`, which surfaces as a timeout or send error.
- `evaluate_lisp` runs arbitrary code in the drawing; results that cannot be represented in JSON (VLA objects, symbols) are returned as their printed representation.
- Non-ASCII text is escaped byte-wise when serialized from AutoLISP; round-tripping is best-effort.

## Development

```sh
bun run dev          # watch mode
bun run lint         # oxlint --type-aware --type-check (this is the typecheck)
bun run format       # oxfmt
bun test             # unit tests
```

`bun install` also clones the Effect source into `.repos/effect` (git-ignored) for local API research.
