import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { AutocadBridge } from "../src/bridge";
import { LispEvaluationError } from "../src/errors";
import { tools } from "../src/tools";

const findTool = (name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`tool ${name} is not registered`);
  }
  return tool;
};

const stubBridge = (respond: (expression: string) => unknown) => {
  const calls: Array<string> = [];
  const layer = Layer.succeed(
    AutocadBridge,
    AutocadBridge.make({
      evaluate: (expression) =>
        Effect.sync(() => {
          calls.push(expression);
          return respond(expression);
        }),
    }),
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
  test("decodes totals and summaries", async () => {
    const { result, calls } = await runTool(
      "list_entities",
      { typeFilter: "LINE", limit: 2 },
      () => [
        5,
        [
          ["1F", "LINE", "0"],
          ["20", "LINE", "Walls"],
        ],
      ],
    );
    expect(calls).toEqual([`(mcp:list-entities "LINE" 2)`]);
    expect(result).toEqual({
      total: 5,
      returned: 2,
      entities: [
        { handle: "1F", type: "LINE", layer: "0" },
        { handle: "20", type: "LINE", layer: "Walls" },
      ],
    });
  });

  test("passes nil when no filter is given", async () => {
    const { calls } = await runTool("list_entities", {}, () => [0, []]);
    expect(calls).toEqual([`(mcp:list-entities nil 100)`]);
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
    const failingLayer = Layer.succeed(
      AutocadBridge,
      AutocadBridge.make({
        evaluate: () => Effect.fail(new LispEvaluationError({ message: "no entity" })),
      }),
    );
    const exit = await Effect.runPromiseExit(
      findTool("zoom_extents").run({}).pipe(Effect.provide(failingLayer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
