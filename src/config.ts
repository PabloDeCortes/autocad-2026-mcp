import { Config, Duration, Effect } from "effect";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export class BridgeConfig extends Effect.Service<BridgeConfig>()("BridgeConfig", {
  effect: Effect.gen(function* () {
    const exchangeDirectory = yield* Config.string("AUTOCAD_MCP_EXCHANGE_DIR").pipe(
      Config.withDefault(join(tmpdir(), "autocad-mcp")),
    );
    const pluginPath = yield* Config.string("AUTOCAD_MCP_PLUGIN_PATH").pipe(
      Config.withDefault(resolve(import.meta.dir, "..", "plugin", "autocad-mcp.lsp")),
    );
    const powershellPath = yield* Config.string("AUTOCAD_MCP_POWERSHELL_PATH").pipe(
      Config.withDefault("powershell.exe"),
    );
    const responseTimeout = yield* Config.duration("AUTOCAD_MCP_RESPONSE_TIMEOUT").pipe(
      Config.withDefault(Duration.seconds(60)),
    );
    const pollInterval = yield* Config.duration("AUTOCAD_MCP_POLL_INTERVAL").pipe(
      Config.withDefault(Duration.millis(100)),
    );
    const busyRetryInterval = yield* Config.duration("AUTOCAD_MCP_BUSY_RETRY_INTERVAL").pipe(
      Config.withDefault(Duration.millis(250)),
    );
    const busyRetryTimeout = yield* Config.duration("AUTOCAD_MCP_BUSY_RETRY_TIMEOUT").pipe(
      Config.withDefault(Duration.seconds(15)),
    );
    return {
      exchangeDirectory,
      pluginPath,
      powershellPath,
      responseTimeout,
      pollInterval,
      busyRetryInterval,
      busyRetryTimeout,
    } as const;
  }),
}) {}
