import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import { progn } from "../lisp";
import { decodeBridgeResult } from "../schemas";
import { makeTool } from "./definition";
import type { Tool } from "./definition";

const StatusResult = Schema.Tuple(
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.Number,
);

const autocadStatus = makeTool({
  name: "autocad_status",
  description:
    "Check the connection to AutoCAD and describe the active drawing: AutoCAD version, drawing name and directory, current layer, and whether there are unsaved changes.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(list (getvar "ACADVER") (getvar "DWGNAME") (getvar "DWGPREFIX") (getvar "CLAYER") (getvar "DBMOD"))`,
      );
      const [acadVersion, drawingName, drawingDirectory, currentLayer, dbmod] =
        yield* decodeBridgeResult(StatusResult)(result);
      return {
        connected: true,
        acadVersion,
        drawingName,
        drawingDirectory,
        currentLayer,
        hasUnsavedChanges: dbmod !== 0,
      };
    }),
});

const evaluateLisp = makeTool({
  name: "evaluate_lisp",
  description:
    "Evaluate raw AutoLISP code in the active drawing and return the value of the last expression as JSON. Multiple top-level expressions are allowed. Entity names are returned as handle strings; dotted pairs become two-element arrays.",
  input: Schema.Struct({
    code: Schema.NonEmptyString.annotations({ description: "AutoLISP source code" }),
  }),
  handler: ({ code }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      return yield* bridge.evaluate(`(progn\n${code}\n)`);
    }),
});

const saveDrawing = makeTool({
  name: "save_drawing",
  description: "Save the active drawing to its current path.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        progn(`(vla-Save (mcp:active-document))`, `(getvar "DWGNAME")`),
      );
      const savedAs = yield* decodeBridgeResult(Schema.String)(result);
      return { savedAs };
    }),
});

const zoomExtents = makeTool({
  name: "zoom_extents",
  description: "Zoom the active viewport to the extents of the drawing.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      yield* bridge.evaluate(progn(`(vla-ZoomExtents (vlax-get-acad-object))`, "T"));
      return { zoomed: true };
    }),
});

export const sessionTools: ReadonlyArray<Tool> = [
  autocadStatus,
  evaluateLisp,
  saveDrawing,
  zoomExtents,
];
