import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import { lispPoint, lispReal, lispString } from "../lisp";
import { AngleDegrees, LispList, Point, decodeBridgeResult } from "../schemas";
import { makeTool } from "./definition";
import type { Tool } from "./definition";

const listBlocks = makeTool({
  name: "list_blocks",
  description: "List the names of all named block definitions in the drawing.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(`(mcp:list-blocks)`);
      const blocks = yield* decodeBridgeResult(LispList(Schema.String))(result);
      return { blocks };
    }),
});

const insertBlock = makeTool({
  name: "insert_block",
  description:
    "Insert an existing block definition into model space. Returns the handle of the new block reference.",
  input: Schema.Struct({
    name: Schema.NonEmptyString.annotations({ description: "Block definition name" }),
    position: Point,
    scale: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), { default: () => 1 }),
    rotation: Schema.optionalWith(AngleDegrees, { default: () => 0 }),
  }),
  handler: ({ name, position, scale, rotation }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:insert-block ${lispString(name)} ${lispPoint(position)} ${lispReal(scale)} ${lispReal(rotation)})`,
      );
      const handle = yield* decodeBridgeResult(Schema.String)(result);
      return { handle };
    }),
});

export const blockTools: ReadonlyArray<Tool> = [listBlocks, insertBlock];
