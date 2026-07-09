import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import { AngleDegrees, BridgeResponse, EntitySummary, LayerRecord, Point } from "../src/schemas";

describe("Point", () => {
  test("defaults z to 0", () => {
    expect(Schema.decodeUnknownSync(Point)({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, z: 0 });
  });

  test("rejects missing coordinates", () => {
    expect(Either.isLeft(Schema.decodeUnknownEither(Point)({ x: 1 }))).toBe(true);
  });
});

describe("AngleDegrees", () => {
  test("decodes degrees to radians", () => {
    expect(Schema.decodeUnknownSync(AngleDegrees)(180)).toBeCloseTo(Math.PI);
    expect(Schema.decodeUnknownSync(AngleDegrees)(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe("BridgeResponse", () => {
  const decode = Schema.decodeUnknownSync(Schema.parseJson(BridgeResponse));

  test("decodes success payloads", () => {
    expect(decode(`{"ok":true,"result":[1,2]}`)).toEqual({ ok: true, result: [1, 2] });
  });

  test("decodes null results", () => {
    expect(decode(`{"ok":true,"result":null}`)).toEqual({ ok: true, result: null });
  });

  test("decodes failure payloads", () => {
    expect(decode(`{"ok":false,"error":"no entity"}`)).toEqual({ ok: false, error: "no entity" });
  });

  test("rejects unknown shapes", () => {
    expect(() => decode(`{"status":"?"}`)).toThrow();
  });
});

describe("EntitySummary", () => {
  test("omits absent color, box, and text", () => {
    expect(Schema.decodeUnknownSync(EntitySummary)(["1F", "LINE", "0", null, null, null])).toEqual({
      handle: "1F",
      type: "LINE",
      layer: "0",
    });
  });

  test("maps color, bounding box, and text when present", () => {
    expect(
      Schema.decodeUnknownSync(EntitySummary)([
        "20",
        "MTEXT",
        "Walls",
        3,
        [
          [0, 0, 0],
          [10, 5, 0],
        ],
        "hello",
      ]),
    ).toEqual({
      handle: "20",
      type: "MTEXT",
      layer: "Walls",
      colorIndex: 3,
      boundingBox: { min: [0, 0, 0], max: [10, 5, 0] },
      text: "hello",
    });
  });
});

describe("LayerRecord", () => {
  test("derives visibility and state flags", () => {
    expect(Schema.decodeUnknownSync(LayerRecord)(["Walls", -3, 5])).toEqual({
      name: "Walls",
      colorIndex: 3,
      isOff: true,
      isFrozen: true,
      isLocked: true,
    });
  });

  test("reports a plain on layer", () => {
    expect(Schema.decodeUnknownSync(LayerRecord)(["0", 7, 0])).toEqual({
      name: "0",
      colorIndex: 7,
      isOff: false,
      isFrozen: false,
      isLocked: false,
    });
  });
});
