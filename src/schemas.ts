import { Effect, Schema } from "effect";
import { BridgeResponseError } from "./errors";

export const Point = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.optionalWith(Schema.Number, { default: () => 0 }),
}).annotations({ description: "3D point; z defaults to 0" });

export type Point = typeof Point.Type;

export const AngleDegrees = Schema.transform(
  Schema.Number.annotations({ description: "Angle in degrees, counterclockwise" }),
  Schema.Number,
  {
    strict: true,
    decode: (degrees) => (degrees * Math.PI) / 180,
    encode: (radians) => (radians * 180) / Math.PI,
  },
);

export const EntityHandle = Schema.NonEmptyString.annotations({
  description: "AutoCAD entity handle",
});

export const Limit = Schema.optionalWith(Schema.Int.pipe(Schema.positive()), {
  default: () => 100,
});

export const Coordinates = Schema.Tuple(Schema.Number, Schema.Number, Schema.Number);

export type Coordinates = typeof Coordinates.Type;

export const BoundingBox = Schema.Struct({
  min: Schema.typeSchema(Coordinates),
  max: Schema.typeSchema(Coordinates),
});

export const BridgeResponse = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true), result: Schema.optional(Schema.Unknown) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
);

export type BridgeResponse = typeof BridgeResponse.Type;

export const LispList = <A, I>(item: Schema.Schema<A, I>) =>
  Schema.transform(Schema.NullOr(Schema.Array(item)), Schema.Array(Schema.typeSchema(item)), {
    strict: true,
    decode: (value) => value ?? [],
    encode: (value) => value,
  });

export const EntitySummary = Schema.transform(
  Schema.Tuple(
    Schema.String,
    Schema.String,
    Schema.String,
    Schema.NullOr(Schema.Int),
    Schema.NullOr(Schema.Tuple(Coordinates, Coordinates)),
    Schema.NullOr(Schema.String),
  ),
  Schema.Struct({
    handle: Schema.String,
    type: Schema.String,
    layer: Schema.String,
    colorIndex: Schema.optional(Schema.Int),
    boundingBox: Schema.optional(BoundingBox),
    text: Schema.optional(Schema.String),
  }),
  {
    strict: false,
    decode: ([handle, type, layer, colorIndex, box, text]) => ({
      handle,
      type,
      layer,
      ...(colorIndex === null ? {} : { colorIndex }),
      ...(box === null ? {} : { boundingBox: { min: box[0], max: box[1] } }),
      ...(text === null ? {} : { text }),
    }),
    encode: (summary) => [
      summary.handle,
      summary.type,
      summary.layer,
      summary.colorIndex ?? null,
      summary.boundingBox === undefined
        ? null
        : ([summary.boundingBox.min, summary.boundingBox.max] as const),
      summary.text ?? null,
    ],
  },
);

export const LayerRecord = Schema.transform(
  Schema.Tuple(Schema.String, Schema.Int, Schema.Int),
  Schema.Struct({
    name: Schema.String,
    colorIndex: Schema.Int,
    isOff: Schema.Boolean,
    isFrozen: Schema.Boolean,
    isLocked: Schema.Boolean,
  }),
  {
    strict: true,
    decode: ([name, color, flags]) => ({
      name,
      colorIndex: Math.abs(color),
      isOff: color < 0,
      isFrozen: (flags & 1) === 1,
      isLocked: (flags & 4) === 4,
    }),
    encode: (layer) =>
      [
        layer.name,
        layer.isOff ? -layer.colorIndex : layer.colorIndex,
        (layer.isFrozen ? 1 : 0) + (layer.isLocked ? 4 : 0),
      ] as const,
  },
);

export const decodeBridgeResult =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (value: unknown): Effect.Effect<A, BridgeResponseError> =>
    Schema.decodeUnknown(schema)(value).pipe(
      Effect.mapError((error) => new BridgeResponseError({ message: error.message })),
    );
