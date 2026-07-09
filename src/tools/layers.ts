import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import { lispInteger, lispNilable, lispString, progn } from "../lisp";
import { LayerRecord, decodeBridgeResult } from "../schemas";
import { makeTool } from "./definition";
import type { Tool } from "./definition";

const LayerName = Schema.NonEmptyString.annotations({ description: "Layer name" });

const listLayers = makeTool({
  name: "list_layers",
  description: "List all layers in the drawing with color index and off/frozen/locked state.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(`(mcp:list-layers)`);
      const layers = yield* decodeBridgeResult(Schema.Array(LayerRecord))(result);
      return { layers };
    }),
});

const createLayer = makeTool({
  name: "create_layer",
  description:
    "Create a layer (or return the existing one with that name), optionally setting its color index (1-255).",
  input: Schema.Struct({
    name: LayerName,
    colorIndex: Schema.optional(
      Schema.Int.pipe(Schema.between(1, 255)).annotations({
        description: "AutoCAD color index between 1 and 255",
      }),
    ),
  }),
  handler: ({ name, colorIndex }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:create-layer ${lispString(name)} ${lispNilable(colorIndex, lispInteger)})`,
      );
      const created = yield* decodeBridgeResult(Schema.String)(result);
      return { name: created };
    }),
});

const setCurrentLayer = makeTool({
  name: "set_current_layer",
  description: "Make an existing layer the current layer for new entities.",
  input: Schema.Struct({ name: LayerName }),
  handler: ({ name }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        progn(
          `(mcp:require-layer ${lispString(name)})`,
          `(setvar "CLAYER" ${lispString(name)})`,
          `(getvar "CLAYER")`,
        ),
      );
      const currentLayer = yield* decodeBridgeResult(Schema.String)(result);
      return { currentLayer };
    }),
});

export const layerTools: ReadonlyArray<Tool> = [listLayers, createLayer, setCurrentLayer];
