import { Effect, Schema } from "effect";
import { AutocadBridge } from "../bridge";
import {
  cons,
  lispInteger,
  lispPoint,
  lispPoint2d,
  lispReal,
  lispString,
  lispStringList,
  progn,
} from "../lisp";
import { AngleDegrees, EntityHandle, EntitySummary, Point, decodeBridgeResult } from "../schemas";
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

const ListEntitiesResult = Schema.Tuple(Schema.Number, Schema.Array(EntitySummary));

const listEntities = makeTool({
  name: "list_entities",
  description:
    "List entities in the drawing with handle, DXF type, and layer. Optionally filter by DXF type names (comma separated, wildcards allowed, e.g. LINE,CIRCLE or *TEXT).",
  input: Schema.Struct({
    typeFilter: Schema.optional(
      Schema.NonEmptyString.annotations({
        description: "DXF type filter such as LINE, CIRCLE,ARC, or *POLYLINE",
      }),
    ),
    limit: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { default: () => 100 }),
  }),
  handler: ({ typeFilter, limit }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:list-entities ${typeFilter === undefined ? "nil" : lispString(typeFilter)} ${lispInteger(limit)})`,
      );
      const [total, entities] = yield* decodeBridgeResult(ListEntitiesResult)(result);
      return { total, returned: entities.length, entities };
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

const Handles = Schema.NonEmptyArray(EntityHandle);

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
  getEntity,
  eraseEntities,
  moveEntities,
  rotateEntities,
  scaleEntities,
];
