import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import { lispInteger, lispPoint, lispReal, lispString } from "../lisp";
import {
  AngleDegrees,
  Coordinates,
  EntitySummary,
  Limit,
  LispList,
  Point,
  decodeBridgeResult,
} from "../schemas";
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

const BlockDefinitionResult = Schema.Tuple(Coordinates, Schema.Number, LispList(EntitySummary));

const getBlockDefinition = makeTool({
  name: "get_block_definition",
  description:
    "Describe a block definition: its base point and the entities it contains, summarized like list_entities (in block-local coordinates). Works for anonymous blocks (names starting with *) too.",
  input: Schema.Struct({
    name: Schema.NonEmptyString.annotations({ description: "Block definition name" }),
    limit: Limit,
  }),
  handler: ({ name, limit }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:block-definition ${lispString(name)} ${lispInteger(limit)})`,
      );
      const [basePoint, total, entities] = yield* decodeBridgeResult(BlockDefinitionResult)(result);
      return { name, basePoint, total, returned: entities.length, entities };
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

export const blockTools: ReadonlyArray<Tool> = [listBlocks, getBlockDefinition, insertBlock];
