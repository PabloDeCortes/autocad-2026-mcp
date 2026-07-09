import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , toolName, argsJson] = Bun.argv;

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", `${import.meta.dir}/../src/main.ts`],
});

const client = new Client({ name: "mcp-test-client", version: "0.0.1" });
await client.connect(transport);

if (toolName === undefined || toolName === "list") {
  const { tools } = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
} else {
  const args =
    argsJson === undefined
      ? {}
      : argsJson.startsWith("@")
        ? JSON.parse(await Bun.file(argsJson.slice(1)).text())
        : JSON.parse(argsJson);
  const result = await client.callTool({ name: toolName, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  await Promise.all(
    content.map((item, index) => {
      if (item.type !== "image" || typeof item.data !== "string") {
        return Promise.resolve();
      }
      const path = `${import.meta.dir}/mcp-call-image-${index}.png`;
      const bytes = Buffer.from(item.data, "base64");
      item.data = `<written to ${path}>`;
      return Bun.write(path, bytes);
    }),
  );
  console.log(JSON.stringify(result, null, 2));
}

await client.close();
process.exit(0);
