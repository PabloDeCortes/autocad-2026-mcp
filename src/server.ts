import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";
import packageJson from "../package.json";

export class AutocadMcp extends Effect.Service<AutocadMcp>()("AutocadMcp", {
  scoped: Effect.gen(function* () {
    const server = new McpServer({
      name: packageJson.name,
      version: packageJson.version,
    });
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(new StdioServerTransport())),
      () => Effect.promise(() => server.close()),
    );
    return { server } as const;
  }),
}) {}
