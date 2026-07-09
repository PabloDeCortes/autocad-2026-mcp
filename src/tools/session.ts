import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import { ViewCapture } from "../capture";
import { lispPoint, progn } from "../lisp";
import { Coordinates, LispList, Point, decodeBridgeResult } from "../schemas";
import { ImageResult, makeTool } from "./definition";
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
    'Evaluate raw AutoLISP code in the active drawing and return the value of the last expression as JSON. Multiple top-level expressions are allowed. Entity names are returned as handle strings; dotted pairs become two-element arrays. Functions defined with defun persist for the AutoCAD session, so define drawing helpers once and reuse them in later calls; prefer batching many operations into one call over many small calls. The code must never prompt for user input (no getpoint/getstring/getkword, no ssget without a mode like "_X", no dialogs) — a pending prompt stalls AutoCAD until the request times out.',
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

const ViewWindow = Schema.Struct({
  min: Point.annotations({ description: "Lower-left corner of the view window" }),
  max: Point.annotations({ description: "Upper-right corner of the view window" }),
});

const zoomToWindow = (bridge: AutocadBridge, window: typeof ViewWindow.Type) =>
  bridge.evaluate(`(mcp:zoom-window ${lispPoint(window.min)} ${lispPoint(window.max)})`);

const zoomWindow = makeTool({
  name: "zoom_window",
  description: "Zoom the active viewport to a rectangular window in world coordinates.",
  input: ViewWindow,
  handler: (window) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      yield* zoomToWindow(bridge, window);
      return { zoomed: true };
    }),
});

const captureView = makeTool({
  name: "capture_view",
  description:
    "Capture a screenshot of the AutoCAD application window as a PNG image. Optionally zoom the active viewport to a rectangular window in world coordinates first. Use this to visually verify the drawing after changes.",
  input: Schema.Struct({
    window: Schema.optional(
      ViewWindow.annotations({
        description: "View window to zoom to before capturing; omit to capture the current view",
      }),
    ),
  }),
  handler: ({ window }) =>
    Effect.gen(function* () {
      if (window !== undefined) {
        const bridge = yield* AutocadBridge;
        yield* zoomToWindow(bridge, window);
      }
      const capture = yield* ViewCapture;
      const data = yield* capture.capture();
      return new ImageResult({ data, mimeType: "image/png" });
    }),
});

const CountPair = Schema.Tuple(Schema.String, Schema.Number);

const BlockUsage = Schema.Tuple(Schema.String, Schema.Number, Schema.Number);

const OverviewResult = Schema.Tuple(
  Schema.Number,
  LispList(CountPair),
  LispList(CountPair),
  Schema.NullOr(Schema.Tuple(Coordinates, Coordinates)),
  LispList(BlockUsage),
);

const drawingOverview = makeTool({
  name: "drawing_overview",
  description:
    "Summarize the drawing in one call: total entity count, entity counts by DXF type and by layer, drawing extents, and block definitions with their entity counts and number of inserted references (anonymous blocks are listed only when inserted). Call this first to understand an unfamiliar drawing.",
  input: Schema.Struct({}),
  handler: () =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(`(mcp:drawing-overview)`);
      const [total, byType, byLayer, extents, blocks] =
        yield* decodeBridgeResult(OverviewResult)(result);
      return {
        totalEntities: total,
        entitiesByType: Object.fromEntries(byType),
        entitiesByLayer: Object.fromEntries(byLayer),
        extents: extents === null ? null : { min: extents[0], max: extents[1] },
        blocks: blocks.map(([name, entityCount, instanceCount]) => ({
          name,
          entityCount,
          instanceCount,
        })),
      };
    }),
});

export const sessionTools: ReadonlyArray<Tool> = [
  autocadStatus,
  drawingOverview,
  evaluateLisp,
  saveDrawing,
  zoomExtents,
  zoomWindow,
  captureView,
];
