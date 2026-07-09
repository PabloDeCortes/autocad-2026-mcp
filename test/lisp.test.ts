import { describe, expect, test } from "bun:test";
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
} from "../src/lisp";

describe("lispString", () => {
  test("wraps plain text in quotes", () => {
    expect(lispString("Layer1")).toBe(`"Layer1"`);
  });

  test("escapes quotes and backslashes", () => {
    expect(lispString(`a"b\\c`)).toBe(`"a\\"b\\\\c"`);
  });

  test("escapes control characters", () => {
    expect(lispString("a\nb\rc\td")).toBe(`"a\\nb\\rc\\td"`);
  });
});

describe("lispReal", () => {
  test("keeps decimals as written", () => {
    expect(lispReal(1.5)).toBe("1.5");
  });

  test("adds a decimal part to integral values", () => {
    expect(lispReal(3)).toBe("3.0");
    expect(lispReal(-7)).toBe("-7.0");
    expect(lispReal(0)).toBe("0.0");
  });

  test("keeps exponent notation readable by AutoLISP", () => {
    expect(lispReal(1e21)).toBe("1.0e+21");
    expect(lispReal(1.5e-7)).toBe("1.5e-7");
  });
});

describe("lispInteger", () => {
  test("truncates to an integer literal", () => {
    expect(lispInteger(42)).toBe("42");
    expect(lispInteger(7.9)).toBe("7");
  });
});

describe("expression builders", () => {
  test("lispPoint renders three coordinates", () => {
    expect(lispPoint({ x: 1, y: 2.5, z: 0 })).toBe("(list 1.0 2.5 0.0)");
  });

  test("lispPoint2d drops z", () => {
    expect(lispPoint2d({ x: 1, y: 2, z: 9 })).toBe("(list 1.0 2.0)");
  });

  test("lispStringList renders quoted items", () => {
    expect(lispStringList(["1F", "20"])).toBe(`(list "1F" "20")`);
  });

  test("cons and progn compose", () => {
    expect(progn(cons(0, `"LINE"`), "T")).toBe(`(progn (cons 0 "LINE") T)`);
  });

  test("lispNilable renders undefined as nil and values with the renderer", () => {
    expect(lispNilable(undefined, lispString)).toBe("nil");
    expect(lispNilable("Walls", lispString)).toBe(`"Walls"`);
    expect(lispNilable(3, lispInteger)).toBe("3");
  });
});
