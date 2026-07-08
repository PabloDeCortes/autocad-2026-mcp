import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Runtime } from "effect";
import process from "node:process";
import packageJson from "../package.json";
import { AutocadBridge } from "./bridge";
import { toolFailureMessage } from "./errors";
import { tools } from "./tools";

const toolList = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

const textResult = (text: string, isError: boolean) => ({
  content: [{ type: "text" as const, text }],
  isError,
});

const handleToolCall = (name: string, args: unknown) => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return Effect.succeed(textResult(`Unknown tool: ${name}`, true));
  }
  return tool.run(args).pipe(
    Effect.map((result) => textResult(JSON.stringify(result, null, 2), false)),
    Effect.catchAll((error) => Effect.succeed(textResult(toolFailureMessage(error), true))),
  );
};

export class AutocadMcp extends Effect.Service<AutocadMcp>()("AutocadMcp", {
  scoped: Effect.gen(function* () {
    const runtime = yield* Effect.runtime<AutocadBridge>();
    const runPromise = Runtime.runPromise(runtime);
    const server = new Server(
      { name: packageJson.name, version: packageJson.version },
      {
        capabilities: { tools: {} },
        instructions:
          "Tools operate on the drawing currently open in a running AutoCAD 2026 instance on this machine. Start AutoCAD and open a drawing before calling them; use autocad_status to verify the connection.",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolList }));
    server.setRequestHandler(CallToolRequestSchema, (request) =>
      runPromise(handleToolCall(request.params.name, request.params.arguments ?? {})),
    );
    server.onclose = () => process.exit(0);
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(new StdioServerTransport())),
      () => Effect.promise(() => server.close()),
    );
    return { server } as const;
  }),
}) {}
