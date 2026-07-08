import { Effect, JSONSchema, Schema } from "effect";
import type { AutocadBridge } from "../bridge";
import { ToolInputError } from "../errors";
import type { BridgeError } from "../errors";

export interface ToolInputJsonSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown> | undefined;
  readonly required?: ReadonlyArray<string> | undefined;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputJsonSchema;
  readonly run: (
    args: unknown,
  ) => Effect.Effect<unknown, ToolInputError | BridgeError, AutocadBridge>;
}

const toInputJsonSchema = <A, I>(schema: Schema.Schema<A, I>): ToolInputJsonSchema => {
  const json = JSONSchema.make(schema);
  return "type" in json && json.type === "object"
    ? { type: "object", properties: json.properties, required: json.required }
    : { type: "object" };
};

export const makeTool = <A, I>(options: {
  readonly name: string;
  readonly description: string;
  readonly input: Schema.Schema<A, I>;
  readonly handler: (input: A) => Effect.Effect<unknown, BridgeError, AutocadBridge>;
}): Tool => ({
  name: options.name,
  description: options.description,
  inputSchema: toInputJsonSchema(options.input),
  run: (args) =>
    Schema.decodeUnknown(options.input)(args).pipe(
      Effect.mapError((error) => new ToolInputError({ message: error.message })),
      Effect.flatMap(options.handler),
    ),
});
