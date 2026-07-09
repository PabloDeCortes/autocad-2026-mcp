import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import {
  cons,
  lispInteger,
  lispNilable,
  lispPoint,
  lispPoint2d,
  lispReal,
  lispString,
  lispStringList,
  progn,
} from "../lisp";
import {
  AngleDegrees,
  Coordinates,
  EntityHandle,
  EntitySummary,
  Limit,
  LispList,
  Point,
  decodeBridgeResult,
} from "../schemas";
import { makeTool } from "./definition";
import type { Tool } from "./definition";

const OptionalLayer = Schema.optional(
  Schema.NonEmptyString.annotations({
    description: "Existing layer to place the entity on; defaults to the current layer",
  }),
);

const layerGroups = (layer: string | undefined): ReadonlyArray<string> =>
  layer === undefined ? [] : [cons(8, lispString(layer))];

const requireLayerExpressions = (layer: string | undefined): ReadonlyArray<string> =>
  layer === undefined ? [] : [`(mcp:require-layer ${lispString(layer)})`];

const madeEntity = (layer: string | undefined, dxfGroups: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const bridge = yield* AutocadBridge;
    const result = yield* bridge.evaluate(
      progn(
        ...requireLayerExpressions(layer),
        `(mcp:made-entity (entmakex (list ${dxfGroups.join(" ")})))`,
      ),
    );
    const handle = yield* decodeBridgeResult(Schema.String)(result);
    return { handle };
  });

const createLine = makeTool({
  name: "create_line",
  description: "Create a line between two points. Returns the handle of the new entity.",
  input: Schema.Struct({ start: Point, end: Point, layer: OptionalLayer }),
  handler: ({ start, end, layer }) =>
    madeEntity(layer, [
      cons(0, `"LINE"`),
      ...layerGroups(layer),
      cons(10, lispPoint(start)),
      cons(11, lispPoint(end)),
    ]),
});

const createCircle = makeTool({
  name: "create_circle",
  description:
    "Create a circle from a center point and radius. Returns the handle of the new entity.",
  input: Schema.Struct({
    center: Point,
    radius: Schema.Number.pipe(Schema.positive()),
    layer: OptionalLayer,
  }),
  handler: ({ center, radius, layer }) =>
    madeEntity(layer, [
      cons(0, `"CIRCLE"`),
      ...layerGroups(layer),
      cons(10, lispPoint(center)),
      cons(40, lispReal(radius)),
    ]),
});

const createArc = makeTool({
  name: "create_arc",
  description:
    "Create a circular arc from a center point, radius, and start/end angles in degrees (counterclockwise from the positive X axis). Returns the handle of the new entity.",
  input: Schema.Struct({
    center: Point,
    radius: Schema.Number.pipe(Schema.positive()),
    startAngle: AngleDegrees,
    endAngle: AngleDegrees,
    layer: OptionalLayer,
  }),
  handler: ({ center, radius, startAngle, endAngle, layer }) =>
    madeEntity(layer, [
      cons(0, `"ARC"`),
      ...layerGroups(layer),
      cons(10, lispPoint(center)),
      cons(40, lispReal(radius)),
      cons(50, lispReal(startAngle)),
      cons(51, lispReal(endAngle)),
    ]),
});

const createPolyline = makeTool({
  name: "create_polyline",
  description:
    "Create a 2D lightweight polyline through the given points (z is ignored). Returns the handle of the new entity.",
  input: Schema.Struct({
    points: Schema.Array(Point).pipe(Schema.minItems(2)),
    closed: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    layer: OptionalLayer,
  }),
  handler: ({ points, closed, layer }) =>
    madeEntity(layer, [
      cons(0, `"LWPOLYLINE"`),
      cons(100, `"AcDbEntity"`),
      ...layerGroups(layer),
      cons(100, `"AcDbPolyline"`),
      cons(90, lispInteger(points.length)),
      cons(70, lispInteger(closed ? 1 : 0)),
      ...points.map((point) => cons(10, lispPoint2d(point))),
    ]),
});

const createText = makeTool({
  name: "create_text",
  description:
    "Create a single-line text entity at a position. Returns the handle of the new entity.",
  input: Schema.Struct({
    position: Point,
    text: Schema.NonEmptyString,
    height: Schema.Number.pipe(Schema.positive()),
    rotation: Schema.optionalWith(AngleDegrees, { default: () => 0 }),
    layer: OptionalLayer,
  }),
  handler: ({ position, text, height, rotation, layer }) =>
    madeEntity(layer, [
      cons(0, `"TEXT"`),
      ...layerGroups(layer),
      cons(10, lispPoint(position)),
      cons(40, lispReal(height)),
      cons(1, lispString(text)),
      cons(50, lispReal(rotation)),
    ]),
});

const ListEntitiesResult = Schema.Tuple(Schema.Number, LispList(EntitySummary));

const Handles = Schema.NonEmptyArray(EntityHandle);

const SelectionWindow = Schema.Struct({
  min: Point.annotations({ description: "Lower-left corner of the window" }),
  max: Point.annotations({ description: "Upper-right corner of the window" }),
  mode: Schema.optionalWith(Schema.Literal("crossing", "inside", "center"), {
    default: () => "crossing",
  }).annotations({
    description:
      "How an entity bounding box must relate to the window: crossing = overlaps it, inside = fully within it, center = its center lies within it",
  }),
});

const lispWindow = (window: typeof SelectionWindow.Type | undefined): string =>
  window === undefined
    ? "nil"
    : `(list ${lispReal(window.min.x)} ${lispReal(window.min.y)} ${lispReal(window.max.x)} ${lispReal(window.max.y)} ${lispString(window.mode)})`;

const summarizedEntities = (call: string) =>
  Effect.gen(function* () {
    const bridge = yield* AutocadBridge;
    const result = yield* bridge.evaluate(call);
    const [total, entities] = yield* decodeBridgeResult(ListEntitiesResult)(result);
    return { total, returned: entities.length, entities };
  });

const listEntities = makeTool({
  name: "list_entities",
  description:
    "List entities in the drawing with handle, DXF type, layer, color index (absent means ByLayer), world-coordinate bounding box, and text content for text-bearing types. Optionally filter by DXF type names (comma separated, wildcards allowed, e.g. LINE,CIRCLE or *TEXT), by layer name, and by a rectangular window in world coordinates.",
  input: Schema.Struct({
    typeFilter: Schema.optional(
      Schema.NonEmptyString.annotations({
        description: "DXF type filter such as LINE, CIRCLE,ARC, or *POLYLINE",
      }),
    ),
    layerFilter: Schema.optional(
      Schema.NonEmptyString.annotations({
        description: "Layer name filter, wildcards allowed, e.g. Walls or Floor*",
      }),
    ),
    window: Schema.optional(
      SelectionWindow.annotations({
        description: "Rectangular window that entities must fall into, in world coordinates",
      }),
    ),
    limit: Limit,
  }),
  handler: ({ typeFilter, layerFilter, window, limit }) =>
    summarizedEntities(
      `(mcp:list-entities ${lispNilable(typeFilter, lispString)} ${lispNilable(layerFilter, lispString)} ${lispInteger(limit)} ${lispWindow(window)})`,
    ),
});

const getSelectedEntities = makeTool({
  name: "get_selected_entities",
  description:
    "List the entities currently selected (highlighted) in the AutoCAD window, with handle, DXF type, and layer. Reads the selection without modifying it.",
  input: Schema.Struct({ limit: Limit }),
  handler: ({ limit }) => summarizedEntities(`(mcp:selected-entities ${lispInteger(limit)})`),
});

const BoundingBoxRecord = Schema.Tuple(Schema.String, Coordinates, Coordinates);

const axisExtremes = (
  corners: ReadonlyArray<readonly [number, number, number]>,
  pick: (...values: Array<number>) => number,
): ReadonlyArray<number> => [
  pick(...corners.map((corner) => corner[0])),
  pick(...corners.map((corner) => corner[1])),
  pick(...corners.map((corner) => corner[2])),
];

const getBoundingBox = makeTool({
  name: "get_bounding_box",
  description:
    "Return the world-coordinate bounding box (min and max corner as [x, y, z]) of each entity, plus the combined box enclosing all of them.",
  input: Schema.Struct({ handles: Handles }),
  handler: ({ handles }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(`(mcp:bounding-boxes ${lispStringList(handles)})`);
      const records = yield* decodeBridgeResult(Schema.Array(BoundingBoxRecord))(result);
      const boxes = records.map(([handle, min, max]) => ({ handle, min, max }));
      return {
        boxes,
        combined: {
          min: axisExtremes(
            boxes.map((box) => box.min),
            Math.min,
          ),
          max: axisExtremes(
            boxes.map((box) => box.max),
            Math.max,
          ),
        },
      };
    }),
});

const EntityDataEntry = Schema.Tuple([Schema.Number], Schema.Unknown);

const getEntity = makeTool({
  name: "get_entity",
  description:
    "Return the full DXF group data of one entity as {code, value} pairs (entget). Point groups have array values.",
  input: Schema.Struct({ handle: EntityHandle }),
  handler: ({ handle }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(`(entget (mcp:require-entity ${lispString(handle)}))`);
      const entries = yield* decodeBridgeResult(Schema.Array(EntityDataEntry))(result);
      return {
        handle,
        groups: entries.map(([code, ...rest]) => ({
          code,
          value: rest.length === 1 ? rest[0] : rest,
        })),
      };
    }),
});

const countedCall = (key: string, call: string) =>
  Effect.gen(function* () {
    const bridge = yield* AutocadBridge;
    const result = yield* bridge.evaluate(call);
    const count = yield* decodeBridgeResult(Schema.Number)(result);
    return { [key]: count };
  });

const eraseEntities = makeTool({
  name: "erase_entities",
  description: "Erase entities by handle. Returns how many were erased.",
  input: Schema.Struct({ handles: Handles }),
  handler: ({ handles }) => countedCall("erased", `(mcp:erase ${lispStringList(handles)})`),
});

const copyEntities = makeTool({
  name: "copy_entities",
  description:
    "Copy entities, optionally displacing the copies by an offset vector. Returns the handles of the new copies in input order.",
  input: Schema.Struct({
    handles: Handles,
    offset: Schema.optionalWith(Point.annotations({ description: "Displacement vector" }), {
      default: () => ({ x: 0, y: 0, z: 0 }),
    }),
  }),
  handler: ({ handles, offset }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:copy ${lispStringList(handles)} ${lispPoint(offset)})`,
      );
      const copies = yield* decodeBridgeResult(LispList(Schema.String))(result);
      return { copied: copies.length, handles: copies };
    }),
});

const moveEntities = makeTool({
  name: "move_entities",
  description: "Move entities by a displacement vector. Returns how many were moved.",
  input: Schema.Struct({
    handles: Handles,
    offset: Point.annotations({ description: "Displacement vector" }),
  }),
  handler: ({ handles, offset }) =>
    countedCall("moved", `(mcp:move ${lispStringList(handles)} ${lispPoint(offset)})`),
});

const rotateEntities = makeTool({
  name: "rotate_entities",
  description:
    "Rotate entities around a base point by an angle in degrees (counterclockwise). Returns how many were rotated.",
  input: Schema.Struct({ handles: Handles, basePoint: Point, angle: AngleDegrees }),
  handler: ({ handles, basePoint, angle }) =>
    countedCall(
      "rotated",
      `(mcp:rotate ${lispStringList(handles)} ${lispPoint(basePoint)} ${lispReal(angle)})`,
    ),
});

const scaleEntities = makeTool({
  name: "scale_entities",
  description:
    "Scale entities uniformly around a base point by a positive factor. Returns how many were scaled.",
  input: Schema.Struct({
    handles: Handles,
    basePoint: Point,
    factor: Schema.Number.pipe(Schema.positive()),
  }),
  handler: ({ handles, basePoint, factor }) =>
    countedCall(
      "scaled",
      `(mcp:scale ${lispStringList(handles)} ${lispPoint(basePoint)} ${lispReal(factor)})`,
    ),
});

export const entityTools: ReadonlyArray<Tool> = [
  createLine,
  createCircle,
  createArc,
  createPolyline,
  createText,
  listEntities,
  getSelectedEntities,
  getBoundingBox,
  getEntity,
  eraseEntities,
  copyEntities,
  moveEntities,
  rotateEntities,
  scaleEntities,
];
