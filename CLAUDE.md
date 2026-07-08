# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP (Model Context Protocol) server for AutoCAD 2026, built with [Effect](https://effect.website/docs) as the main framework and Bun as the package manager and runtime.

## Commands

Bun is the package manager and runtime — never use npm, npx, yarn, or node.

- `bun install` — install dependencies
- `bun run dev` — run the server in watch mode
- `bun run start` — run the server
- `bun run lint` — oxlint with `--type-aware --type-check`; this IS the typecheck, never run `tsc` separately
- `bun run lint:fix` — lint with autofix
- `bun run format` / `bun run format:check` — format with oxfmt
- `bun test` — run all tests
- `bun test <path>` — run a single test file

Linting and formatting are oxlint + oxfmt (configs: `.oxlintrc.json`, `.oxfmtrc.json`). TypeScript 7 powers type-aware linting through `oxlint-tsgolint`; type errors surface via `bun run lint`, so there is no separate typecheck step or script.

## Architecture

The server exposes AutoCAD 2026 operations as MCP tools. The MCP protocol layer is the official `@modelcontextprotocol/sdk` (stdio transport), owned entirely by the `AutocadMcp` service in `src/server.ts`; `src/main.ts` is the only place layers are composed and launched, via `BunRuntime.runMain(Layer.launch(...))`. Everything is built on Effect:

- **Services and Layers**: every external dependency (AutoCAD connection, MCP transport, configuration) is an Effect service defined with `Effect.Service` or `Context.Tag` and provided via a `Layer`. Composition happens in a single place at the entry point — nothing constructs its own dependencies.
- **Errors**: all failures are typed tagged errors (`Data.TaggedError`). No thrown exceptions, no untyped `catch`. Errors flow through the Effect error channel and are handled or mapped at the boundary where they become MCP error responses.
- **Validation**: all data crossing a boundary (MCP tool inputs, AutoCAD responses) is decoded with `effect/Schema`. Types are derived from schemas, not duplicated by hand.
- **Effect style**: use `Effect.gen` for sequential logic and `pipe` for transformation chains. No `async/await` or raw Promises in domain code — wrap external Promise APIs with `Effect.tryPromise` at the edge, once, in the service that owns them.

## Code rules

These are strict requirements, not suggestions:

- **Never add comments of any kind.** No TODOs, no FIXMEs, no explanatory comments, no JSDoc, no commented-out code. Code must be self-explanatory through naming and structure. If something needs explaining, restructure or rename it until it doesn't.
- **No duplication.** Before writing anything, search for existing code that already does it — a schema, an error type, a helper, a service. Extend or reuse it. If two call sites need the same logic, it lives in exactly one shared place; never copy-paste and tweak.
- **Clear allocation — one home per concern.** Each module has a single responsibility, and each piece of logic has exactly one obvious file it belongs to. Tool definitions, schemas, services, and errors each live in their designated module; nothing is defined inline in an unrelated file because it was convenient. If a file accumulates a second responsibility, split it.
- **Small, composed functions.** Build behavior by composing small Effect pipelines rather than long procedural blocks. Dead code and unused exports are deleted, not kept "just in case".
- **Types come from schemas.** Never hand-write a type that a `Schema` can derive. Never use `any`; unknown data is `unknown` until decoded.
