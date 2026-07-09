import { Effect, Schema } from "effect";
import { absurd } from "effect/Function";
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

const LineSpec = Schema.Struct({ start: Point, end: Point, layer: OptionalLayer });

const CircleSpec = Schema.Struct({
  center: Point,
  radius: Schema.Number.pipe(Schema.positive()),
  layer: OptionalLayer,
});

const ArcSpec = Schema.Struct({
  center: Point,
  radius: Schema.Number.pipe(Schema.positive()),
  startAngle: AngleDegrees,
  endAngle: AngleDegrees,
  layer: OptionalLayer,
});

const PolylineSpec = Schema.Struct({
  points: Schema.Array(Point).pipe(Schema.minItems(2)),
  closed: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  width: Schema.optional(
    Schema.Number.pipe(Schema.nonNegative()).annotations({
      description: "Constant line width in drawing units, e.g. for thick pipe runs",
    }),
  ),
  layer: OptionalLayer,
});

const textJustifications = {
  left: undefined,
  center: [1, 0],
  right: [2, 0],
  middle: [1, 2],
} as const;

const TextSpec = Schema.Struct({
  position: Point,
  text: Schema.NonEmptyString,
  height: Schema.Number.pipe(Schema.positive()),
  rotation: Schema.optionalWith(AngleDegrees, { default: () => 0 }),
  justification: Schema.optionalWith(Schema.Literal("left", "center", "right", "middle"), {
    default: () => "left",
  }).annotations({
    description:
      "How the text relates to position: left = baseline start, center/right = horizontal alignment, middle = centered both ways",
  }),
  layer: OptionalLayer,
});

const lineGroups = (spec: typeof LineSpec.Type): ReadonlyArray<string> => [
  cons(0, `"LINE"`),
  ...layerGroups(spec.layer),
  cons(10, lispPoint(spec.start)),
  cons(11, lispPoint(spec.end)),
];

const circleGroups = (spec: typeof CircleSpec.Type): ReadonlyArray<string> => [
  cons(0, `"CIRCLE"`),
  ...layerGroups(spec.layer),
  cons(10, lispPoint(spec.center)),
  cons(40, lispReal(spec.radius)),
];

const arcGroups = (spec: typeof ArcSpec.Type): ReadonlyArray<string> => [
  cons(0, `"ARC"`),
  ...layerGroups(spec.layer),
  cons(10, lispPoint(spec.center)),
  cons(40, lispReal(spec.radius)),
  cons(50, lispReal(spec.startAngle)),
  cons(51, lispReal(spec.endAngle)),
];

const polylineGroups = (spec: typeof PolylineSpec.Type): ReadonlyArray<string> => [
  cons(0, `"LWPOLYLINE"`),
  cons(100, `"AcDbEntity"`),
  ...layerGroups(spec.layer),
  cons(100, `"AcDbPolyline"`),
  cons(90, lispInteger(spec.points.length)),
  cons(70, lispInteger(spec.closed ? 1 : 0)),
  ...(spec.width === undefined ? [] : [cons(43, lispReal(spec.width))]),
  ...spec.points.map((point) => cons(10, lispPoint2d(point))),
];

const textGroups = (spec: typeof TextSpec.Type): ReadonlyArray<string> => {
  const alignment = textJustifications[spec.justification];
  return [
    cons(0, `"TEXT"`),
    ...layerGroups(spec.layer),
    cons(10, lispPoint(spec.position)),
    cons(40, lispReal(spec.height)),
    cons(1, lispString(spec.text)),
    cons(50, lispReal(spec.rotation)),
    ...(alignment === undefined
      ? []
      : [
          cons(72, lispInteger(alignment[0])),
          cons(73, lispInteger(alignment[1])),
          cons(11, lispPoint(spec.position)),
        ]),
  ];
};

const createLine = makeTool({
  name: "create_line",
  description: "Create a line between two points. Returns the handle of the new entity.",
  input: LineSpec,
  handler: (spec) => madeEntity(spec.layer, lineGroups(spec)),
});

const createCircle = makeTool({
  name: "create_circle",
  description:
    "Create a circle from a center point and radius. Returns the handle of the new entity.",
  input: CircleSpec,
  handler: (spec) => madeEntity(spec.layer, circleGroups(spec)),
});

const createArc = makeTool({
  name: "create_arc",
  description:
    "Create a circular arc from a center point, radius, and start/end angles in degrees (counterclockwise from the positive X axis). Returns the handle of the new entity.",
  input: ArcSpec,
  handler: (spec) => madeEntity(spec.layer, arcGroups(spec)),
});

const createPolyline = makeTool({
  name: "create_polyline",
  description:
    "Create a 2D lightweight polyline through the given points (z is ignored), optionally closed and with a constant width. Returns the handle of the new entity.",
  input: PolylineSpec,
  handler: (spec) => madeEntity(spec.layer, polylineGroups(spec)),
});

const createText = makeTool({
  name: "create_text",
  description:
    "Create a single-line text entity at a position, with optional rotation and justification. Returns the handle of the new entity.",
  input: TextSpec,
  handler: (spec) => madeEntity(spec.layer, textGroups(spec)),
});

const EntitySpec = Schema.Union(
  Schema.Struct({ type: Schema.Literal("line"), ...LineSpec.fields }),
  Schema.Struct({ type: Schema.Literal("circle"), ...CircleSpec.fields }),
  Schema.Struct({ type: Schema.Literal("arc"), ...ArcSpec.fields }),
  Schema.Struct({ type: Schema.Literal("polyline"), ...PolylineSpec.fields }),
  Schema.Struct({ type: Schema.Literal("text"), ...TextSpec.fields }),
);

const entitySpecGroups = (spec: typeof EntitySpec.Type): ReadonlyArray<string> => {
  switch (spec.type) {
    case "line":
      return lineGroups(spec);
    case "circle":
      return circleGroups(spec);
    case "arc":
      return arcGroups(spec);
    case "polyline":
      return polylineGroups(spec);
    case "text":
      return textGroups(spec);
    default:
      return absurd(spec);
  }
};

const createEntities = makeTool({
  name: "create_entities",
  description:
    "Create many entities (lines, circles, arcs, polylines, texts) in one call — one AutoCAD round-trip instead of one per entity, so use this whenever creating more than a couple of entities. Returns the handles of the new entities in input order.",
  input: Schema.Struct({
    entities: Schema.Array(EntitySpec).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  handler: ({ entities }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const layers = [...new Set(entities.map((entity) => entity.layer))];
      const result = yield* bridge.evaluate(
        progn(
          ...layers.flatMap(requireLayerExpressions),
          `(list ${entities
            .map(
              (entity) =>
                `(mcp:made-entity (entmakex (list ${entitySpecGroups(entity).join(" ")})))`,
            )
            .join(" ")})`,
        ),
      );
      const handles = yield* decodeBridgeResult(LispList(Schema.String))(result);
      return { created: handles.length, handles };
    }),
});

const createDimension = makeTool({
  name: "create_dimension",
  description:
    "Create an aligned linear dimension between two points, with the dimension line placed through linePosition. textOverride replaces the measured value — use it when the drawing is schematic rather than to scale. Uses the current dimension style. Returns the handle of the new dimension.",
  input: Schema.Struct({
    start: Point,
    end: Point,
    linePosition: Point.annotations({
      description:
        "Point the dimension line passes through, controlling its offset from the measured segment",
    }),
    textOverride: Schema.optional(
      Schema.NonEmptyString.annotations({
        description: "Dimension text replacing the measured value",
      }),
    ),
    layer: OptionalLayer,
  }),
  handler: ({ start, end, linePosition, textOverride, layer }) =>
    Effect.gen(function* () {
      const bridge = yield* AutocadBridge;
      const result = yield* bridge.evaluate(
        `(mcp:dim-aligned ${lispPoint(start)} ${lispPoint(end)} ${lispPoint(linePosition)} ${lispNilable(textOverride, lispString)} ${lispNilable(layer, lispString)})`,
      );
      const handle = yield* decodeBridgeResult(Schema.String)(result);
      return { handle };
    }),
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
  createEntities,
  createDimension,
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
