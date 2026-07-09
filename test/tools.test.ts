import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { AutocadBridge } from "../src/bridge";
import { ViewCapture } from "../src/capture";
import { LispEvaluationError } from "../src/errors";
import { tools } from "../src/tools";
import { ImageResult } from "../src/tools/definition";

const findTool = (name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`tool ${name} is not registered`);
  }
  return tool;
};

const capturedBytes = new Uint8Array([137, 80, 78, 71]);

const stubBridge = (respond: (expression: string) => unknown) => {
  const calls: Array<string> = [];
  const layer = Layer.merge(
    Layer.succeed(
      AutocadBridge,
      AutocadBridge.make({
        evaluate: (expression) =>
          Effect.sync(() => {
            calls.push(expression);
            return respond(expression);
          }),
      }),
    ),
    Layer.succeed(ViewCapture, ViewCapture.make({ capture: () => Effect.succeed(capturedBytes) })),
  );
  return { calls, layer };
};

const runTool = (name: string, args: unknown, respond: (expression: string) => unknown) => {
  const { calls, layer } = stubBridge(respond);
  return Effect.runPromise(findTool(name).run(args).pipe(Effect.provide(layer))).then((result) => ({
    result,
    calls,
  }));
};

describe("registry", () => {
  test("tool names are unique", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every tool exposes an object input schema", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

describe("create_line", () => {
  test("builds an entmakex expression and returns the handle", async () => {
    const { result, calls } = await runTool(
      "create_line",
      { start: { x: 0, y: 0 }, end: { x: 10, y: 5, z: 2 } },
      () => "1F",
    );
    expect(result).toEqual({ handle: "1F" });
    expect(calls).toEqual([
      `(progn (mcp:made-entity (entmakex (list (cons 0 "LINE") (cons 10 (list 0.0 0.0 0.0)) (cons 11 (list 10.0 5.0 2.0))))))`,
    ]);
  });

  test("checks the layer before creating on it", async () => {
    const { calls } = await runTool(
      "create_line",
      { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, layer: "Walls" },
      () => "2A",
    );
    expect(calls[0]).toContain(`(mcp:require-layer "Walls")`);
    expect(calls[0]).toContain(`(cons 8 "Walls")`);
  });

  test("rejects invalid input without calling the bridge", async () => {
    const { calls, layer } = stubBridge(() => "unused");
    const exit = await Effect.runPromiseExit(
      findTool("create_line")
        .run({ start: { x: 0, y: 0 } })
        .pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("create_arc", () => {
  test("converts angles from degrees to radians", async () => {
    const { calls } = await runTool(
      "create_arc",
      { center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 180 },
      () => "3B",
    );
    expect(calls[0]).toContain(`(cons 50 0.0)`);
    expect(calls[0]).toContain(`(cons 51 ${Math.PI})`);
  });
});

describe("create_polyline", () => {
  test("emits vertex count, closed flag, and 2d vertices", async () => {
    const { calls } = await runTool(
      "create_polyline",
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        closed: true,
      },
      () => "4C",
    );
    expect(calls[0]).toContain(`(cons 90 3)`);
    expect(calls[0]).toContain(`(cons 70 1)`);
    expect(calls[0]).toContain(`(cons 10 (list 1.0 1.0))`);
  });
});

describe("list_entities", () => {
  test("decodes totals and rich summaries", async () => {
    const { result, calls } = await runTool(
      "list_entities",
      { typeFilter: "LINE", limit: 2 },
      () => [
        5,
        [
          [
            "1F",
            "LINE",
            "0",
            null,
            [
              [0, 0, 0],
              [10, 5, 0],
            ],
            null,
          ],
          ["20", "MTEXT", "Walls", 3, null, "Стояк В1"],
        ],
      ],
    );
    expect(calls).toEqual([`(mcp:list-entities "LINE" nil 2 nil)`]);
    expect(result).toEqual({
      total: 5,
      returned: 2,
      entities: [
        {
          handle: "1F",
          type: "LINE",
          layer: "0",
          boundingBox: { min: [0, 0, 0], max: [10, 5, 0] },
        },
        { handle: "20", type: "MTEXT", layer: "Walls", colorIndex: 3, text: "Стояк В1" },
      ],
    });
  });

  test("passes nil when no filter is given", async () => {
    const { calls } = await runTool("list_entities", {}, () => [0, []]);
    expect(calls).toEqual([`(mcp:list-entities nil nil 100 nil)`]);
  });

  test("filters by layer", async () => {
    const { calls } = await runTool("list_entities", { layerFilter: "Walls" }, () => [0, []]);
    expect(calls).toEqual([`(mcp:list-entities nil "Walls" 100 nil)`]);
  });

  test("renders the selection window with its mode", async () => {
    const { calls } = await runTool(
      "list_entities",
      { window: { min: { x: 0, y: 0 }, max: { x: 10, y: 5 }, mode: "center" } },
      () => [0, []],
    );
    expect(calls).toEqual([`(mcp:list-entities nil nil 100 (list 0.0 0.0 10.0 5.0 "center"))`]);
  });

  test("defaults the window mode to crossing", async () => {
    const { calls } = await runTool(
      "list_entities",
      { window: { min: { x: 0, y: 0 }, max: { x: 10, y: 5 } } },
      () => [0, []],
    );
    expect(calls).toEqual([`(mcp:list-entities nil nil 100 (list 0.0 0.0 10.0 5.0 "crossing"))`]);
  });
});

describe("get_selected_entities", () => {
  test("reads the current selection", async () => {
    const { result, calls } = await runTool("get_selected_entities", {}, () => [
      1,
      [["1F", "LWPOLYLINE", "Frames", null, null, null]],
    ]);
    expect(calls).toEqual([`(mcp:selected-entities 100)`]);
    expect(result).toEqual({
      total: 1,
      returned: 1,
      entities: [{ handle: "1F", type: "LWPOLYLINE", layer: "Frames" }],
    });
  });
});

describe("get_selected_entities with empty selection", () => {
  test("decodes the nil list AutoLISP produces for an empty selection", async () => {
    const { result } = await runTool("get_selected_entities", {}, () => [0, null]);
    expect(result).toEqual({ total: 0, returned: 0, entities: [] });
  });
});

describe("get_bounding_box", () => {
  test("returns per-entity boxes and the combined box", async () => {
    const { result, calls } = await runTool("get_bounding_box", { handles: ["1F", "20"] }, () => [
      ["1F", [0, 0, 0], [10, 5, 0]],
      ["20", [-2, 3, 0], [4, 20, 1]],
    ]);
    expect(calls).toEqual([`(mcp:bounding-boxes (list "1F" "20"))`]);
    expect(result).toEqual({
      boxes: [
        { handle: "1F", min: [0, 0, 0], max: [10, 5, 0] },
        { handle: "20", min: [-2, 3, 0], max: [4, 20, 1] },
      ],
      combined: { min: [-2, 0, 0], max: [10, 20, 1] },
    });
  });
});

describe("get_entity", () => {
  test("maps DXF groups, flattening scalar values", async () => {
    const { result } = await runTool("get_entity", { handle: "1F" }, () => [
      [0, "LINE"],
      [10, 0, 0, 0],
      [11, 10, 5, 0],
    ]);
    expect(result).toEqual({
      handle: "1F",
      groups: [
        { code: 0, value: "LINE" },
        { code: 10, value: [0, 0, 0] },
        { code: 11, value: [10, 5, 0] },
      ],
    });
  });
});

describe("erase_entities", () => {
  test("returns the erased count", async () => {
    const { result, calls } = await runTool("erase_entities", { handles: ["1F", "20"] }, () => 2);
    expect(calls).toEqual([`(mcp:erase (list "1F" "20"))`]);
    expect(result).toEqual({ erased: 2 });
  });
});

describe("copy_entities", () => {
  test("copies with an offset and returns the new handles", async () => {
    const { result, calls } = await runTool(
      "copy_entities",
      { handles: ["1F", "20"], offset: { x: 5, y: -2 } },
      () => ["2A", "2B"],
    );
    expect(calls).toEqual([`(mcp:copy (list "1F" "20") (list 5.0 -2.0 0.0))`]);
    expect(result).toEqual({ copied: 2, handles: ["2A", "2B"] });
  });

  test("defaults the offset to zero for copies in place", async () => {
    const { calls } = await runTool("copy_entities", { handles: ["1F"] }, () => ["2A"]);
    expect(calls).toEqual([`(mcp:copy (list "1F") (list 0.0 0.0 0.0))`]);
  });
});

describe("zoom_window", () => {
  test("zooms the viewport to the given window", async () => {
    const { result, calls } = await runTool(
      "zoom_window",
      { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } },
      () => true,
    );
    expect(calls).toEqual([`(mcp:zoom-window (list 0.0 0.0 0.0) (list 100.0 50.0 0.0))`]);
    expect(result).toEqual({ zoomed: true });
  });
});

describe("capture_view", () => {
  test("returns the captured image without touching the view by default", async () => {
    const { result, calls } = await runTool("capture_view", {}, () => true);
    expect(calls).toEqual([]);
    expect(result).toBeInstanceOf(ImageResult);
    if (result instanceof ImageResult) {
      expect(result.data).toEqual(capturedBytes);
      expect(result.mimeType).toBe("image/png");
    }
  });

  test("zooms to the requested window before capturing", async () => {
    const { calls } = await runTool(
      "capture_view",
      { window: { min: { x: 0, y: 0 }, max: { x: 10, y: 5 } } },
      () => true,
    );
    expect(calls).toEqual([`(mcp:zoom-window (list 0.0 0.0 0.0) (list 10.0 5.0 0.0))`]);
  });
});

describe("drawing_overview", () => {
  test("maps counts, extents, and block usage", async () => {
    const { result, calls } = await runTool("drawing_overview", {}, () => [
      6,
      [
        ["LINE", 4],
        ["CIRCLE", 2],
      ],
      [
        ["0", 1],
        ["Walls", 5],
      ],
      [
        [0, 0, 0],
        [200, 100, 0],
      ],
      [
        ["Frame", 12, 2],
        ["*U2", 30, 6],
      ],
    ]);
    expect(calls).toEqual([`(mcp:drawing-overview)`]);
    expect(result).toEqual({
      totalEntities: 6,
      entitiesByType: { LINE: 4, CIRCLE: 2 },
      entitiesByLayer: { "0": 1, Walls: 5 },
      extents: { min: [0, 0, 0], max: [200, 100, 0] },
      blocks: [
        { name: "Frame", entityCount: 12, instanceCount: 2 },
        { name: "*U2", entityCount: 30, instanceCount: 6 },
      ],
    });
  });

  test("decodes an empty drawing", async () => {
    const { result } = await runTool("drawing_overview", {}, () => [
      0,
      null,
      null,
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      null,
    ]);
    expect(result).toEqual({
      totalEntities: 0,
      entitiesByType: {},
      entitiesByLayer: {},
      extents: { min: [0, 0, 0], max: [0, 0, 0] },
      blocks: [],
    });
  });
});

describe("get_block_definition", () => {
  test("returns the base point and contained entities", async () => {
    const { result, calls } = await runTool("get_block_definition", { name: "*U2" }, () => [
      [0, 0, 0],
      2,
      [
        [
          "1A",
          "LWPOLYLINE",
          "0",
          null,
          [
            [0, 0, 0],
            [272, 384, 0],
          ],
          null,
        ],
        ["1B", "TEXT", "0", 7, null, "Формат A4"],
      ],
    ]);
    expect(calls).toEqual([`(mcp:block-definition "*U2" 100)`]);
    expect(result).toEqual({
      name: "*U2",
      basePoint: [0, 0, 0],
      total: 2,
      returned: 2,
      entities: [
        {
          handle: "1A",
          type: "LWPOLYLINE",
          layer: "0",
          boundingBox: { min: [0, 0, 0], max: [272, 384, 0] },
        },
        { handle: "1B", type: "TEXT", layer: "0", colorIndex: 7, text: "Формат A4" },
      ],
    });
  });
});

describe("autocad_status", () => {
  test("shapes the status tuple", async () => {
    const { result } = await runTool("autocad_status", {}, () => [
      "25.1s (LMS Tech)",
      "Drawing1.dwg",
      "C:\\Drawings\\",
      "0",
      4,
    ]);
    expect(result).toEqual({
      connected: true,
      acadVersion: "25.1s (LMS Tech)",
      drawingName: "Drawing1.dwg",
      drawingDirectory: "C:\\Drawings\\",
      currentLayer: "0",
      hasUnsavedChanges: true,
    });
  });
});

describe("evaluate_lisp", () => {
  test("wraps code in progn and returns the raw result", async () => {
    const { result, calls } = await runTool("evaluate_lisp", { code: "(+ 1 2)" }, () => 3);
    expect(calls).toEqual(["(progn\n(+ 1 2)\n)"]);
    expect(result).toBe(3);
  });
});

describe("failure propagation", () => {
  test("bridge failures surface as typed errors", async () => {
    const failingLayer = Layer.merge(
      Layer.succeed(
        AutocadBridge,
        AutocadBridge.make({
          evaluate: () => Effect.fail(new LispEvaluationError({ message: "no entity" })),
        }),
      ),
      Layer.succeed(
        ViewCapture,
        ViewCapture.make({ capture: () => Effect.succeed(capturedBytes) }),
      ),
    );
    const exit = await Effect.runPromiseExit(
      findTool("zoom_extents").run({}).pipe(Effect.provide(failingLayer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
