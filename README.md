# autocad-2026-mcp

MCP (Model Context Protocol) server for AutoCAD 2026 on Windows, built with [Effect](https://effect.website) and [Bun](https://bun.sh). It lets MCP clients (Claude Code, Claude Desktop, or any other MCP client) inspect and modify the drawing that is currently open in a running AutoCAD instance.

## How it works

The server talks to AutoCAD through its AutoLISP API using a small bridge plugin ([plugin/autocad-mcp.lsp](plugin/autocad-mcp.lsp)):

1. For each tool call the server writes an AutoLISP expression to a request file in the exchange directory.
2. It triggers AutoCAD over COM (`AutoCAD.Application` via Windows PowerShell) with a single `SendCommand` that loads the plugin when it is missing or outdated (the plugin declares an API version) and calls `(mcp:execute <request> <response>)`.
3. The plugin evaluates the expression with full error trapping, serializes the result to JSON (entity names become handle strings, dotted pairs become two-element arrays), and writes the response file atomically.
4. The server polls for the response, decodes it with `effect/Schema`, and returns it as the MCP tool result.

The trigger and the response polling run concurrently and the whole exchange is bounded by the response timeout, so a `SendCommand` blocked by a modal dialog or pending prompt can never hang the server. When AutoCAD rejects the COM call because it is busy (mid-command, script, or dialog), the trigger retries automatically until the busy-retry timeout elapses. Requests are serialized through a semaphore because AutoCAD is single-threaded. No manual plugin installation is needed: the trigger loads `plugin/autocad-mcp.lsp` automatically the first time a tool runs in an AutoCAD session.

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

| Tool                    | Description                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `autocad_status`        | Connection check: AutoCAD version, drawing name/directory, current layer, unsaved changes                                        |
| `drawing_overview`      | One-call drawing summary: entity counts by type and layer, extents, block definitions with entity and instance counts            |
| `evaluate_lisp`         | Evaluate raw AutoLISP code and return the last value as JSON (escape hatch for everything else)                                  |
| `save_drawing`          | Save the active drawing                                                                                                          |
| `zoom_extents`          | Zoom the active viewport to the drawing extents                                                                                  |
| `zoom_window`           | Zoom the active viewport to a rectangular window in world coordinates                                                            |
| `capture_view`          | Screenshot the AutoCAD window as a PNG (optionally zooming to a window first) for visual verification                            |
| `create_line`           | Line between two points                                                                                                          |
| `create_circle`         | Circle from center and radius                                                                                                    |
| `create_arc`            | Arc from center, radius, start/end angles in degrees                                                                             |
| `create_polyline`       | 2D lightweight polyline, optionally closed and with a constant width                                                             |
| `create_text`           | Single-line text with optional rotation and justification                                                                        |
| `create_entities`       | Batch-create up to 500 lines/circles/arcs/polylines/texts in one round-trip                                                      |
| `create_dimension`      | Aligned linear dimension with optional text override (for schematic, not-to-scale drawings)                                      |
| `list_entities`         | List entities (handle, type, layer, color, bounding box, text content) with optional DXF type, layer, and spatial window filters |
| `get_selected_entities` | Entities currently selected in the AutoCAD window (read without modifying the selection)                                         |
| `get_bounding_box`      | World-coordinate bounding box per entity plus the combined box                                                                   |
| `get_entity`            | Full DXF group data of one entity                                                                                                |
| `erase_entities`        | Erase entities by handle                                                                                                         |
| `copy_entities`         | Copy entities with an optional displacement; returns the new handles                                                             |
| `move_entities`         | Move entities by a displacement vector                                                                                           |
| `rotate_entities`       | Rotate entities around a base point (degrees)                                                                                    |
| `scale_entities`        | Scale entities uniformly around a base point                                                                                     |
| `list_layers`           | Layers with color index and off/frozen/locked state                                                                              |
| `create_layer`          | Create a layer, optionally with a color index                                                                                    |
| `set_current_layer`     | Make an existing layer current                                                                                                   |
| `list_blocks`           | Named block definitions in the drawing                                                                                           |
| `get_block_definition`  | Base point and summarized entities inside a block definition (anonymous blocks included)                                         |
| `insert_block`          | Insert a block reference into model space                                                                                        |

Creation tools return the handle of the new entity; handles are the stable ids used by all entity tools. Angles are always degrees at the MCP boundary and converted to radians internally. Every tool call is wrapped in an undo group inside AutoCAD, so one tool call is one undo step for the user regardless of how many entities it touched.

`list_entities` window filters compare against entity bounding boxes in world coordinates: `crossing` selects entities whose box overlaps the window, `inside` requires the box to be fully contained, and `center` requires the box center to fall inside (useful for partitioning a drawing into sheet regions).

`capture_view` screenshots the AutoCAD application window (restoring it first when minimized) and downscales to at most 1600px wide, returning an MCP image. The viewport must actually be showing the area of interest — pass `window` to zoom first.

Creating large amounts of geometry: prefer `create_entities` (one round-trip for up to 500 entities). For anything beyond its five entity types, `evaluate_lisp` is the escape hatch — `defun`s persist for the AutoCAD session, so define parameterized drawing helpers once and call them from subsequent requests.

## Configuration

All settings are environment variables with sensible defaults:

| Variable                          | Default                                 | Purpose                                     |
| --------------------------------- | --------------------------------------- | ------------------------------------------- |
| `AUTOCAD_MCP_EXCHANGE_DIR`        | `%TEMP%/autocad-mcp`                    | Directory for request/response files        |
| `AUTOCAD_MCP_PLUGIN_PATH`         | `plugin/autocad-mcp.lsp` (in this repo) | AutoLISP bridge plugin to load              |
| `AUTOCAD_MCP_POWERSHELL_PATH`     | `powershell.exe`                        | Windows PowerShell used for the COM trigger |
| `AUTOCAD_MCP_RESPONSE_TIMEOUT`    | `60 seconds`                            | How long to wait for AutoCAD to answer      |
| `AUTOCAD_MCP_POLL_INTERVAL`       | `100 millis`                            | Response file polling interval              |
| `AUTOCAD_MCP_BUSY_RETRY_INTERVAL` | `250 millis`                            | Delay between retries while AutoCAD is busy |
| `AUTOCAD_MCP_BUSY_RETRY_TIMEOUT`  | `15 seconds`                            | How long to keep retrying a busy AutoCAD    |

Windows PowerShell 5.1 (`powershell.exe`) is required for the trigger because `Marshal.GetActiveObject` is unavailable in PowerShell 7+.

## Caveats

- A busy AutoCAD (mid-command, script, or modal dialog) is retried automatically; if it stays busy past the retry timeout the tool call fails with a clear error instead of hanging.
- `evaluate_lisp` runs arbitrary code in the drawing; results that cannot be represented in JSON (VLA objects, symbols) are returned as their printed representation. Code that prompts for user input stalls AutoCAD until the response timeout.
- Non-ASCII text is escaped byte-wise when serialized from AutoLISP; round-tripping is best-effort.

## Development

```sh
bun run dev          # watch mode
bun run lint         # oxlint --type-aware --type-check (this is the typecheck)
bun run format       # oxfmt
bun test             # unit tests
```

`scripts/mcp-call.ts` is a minimal MCP client for exercising the server against a live AutoCAD without registering it with a client: `bun run scripts/mcp-call.ts list` prints the tool list, `bun run scripts/mcp-call.ts <tool> '<json>'` calls a tool, and `bun run scripts/mcp-call.ts <tool> @args.json` reads the arguments from a file (useful when shell quoting gets in the way).

`bun install` also clones the Effect source into `.repos/effect` (git-ignored) for local API research.
