import type { Point } from "./schemas";

export const lispString = (value: string): string => {
  let escaped = "";
  for (const character of value) {
    if (character === "\\") {
      escaped += "\\\\";
    } else if (character === '"') {
      escaped += '\\"';
    } else if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "\t") {
      escaped += "\\t";
    } else {
      escaped += character;
    }
  }
  return `"${escaped}"`;
};

export const lispReal = (value: number): string => {
  const text = String(value);
  const integral = /^(-?\d+)(e[+-]?\d+)?$/i.exec(text);
  if (integral === null) {
    return text;
  }
  return `${integral[1] ?? text}.0${integral[2] ?? ""}`;
};

export const lispInteger = (value: number): string => String(Math.trunc(value));

export const lispPoint = (point: Point): string =>
  `(list ${lispReal(point.x)} ${lispReal(point.y)} ${lispReal(point.z)})`;

export const lispPoint2d = (point: Point): string =>
  `(list ${lispReal(point.x)} ${lispReal(point.y)})`;

export const lispStringList = (values: ReadonlyArray<string>): string =>
  `(list ${values.map(lispString).join(" ")})`;

export const cons = (code: number, value: string): string => `(cons ${code} ${value})`;

export const progn = (...expressions: ReadonlyArray<string>): string =>
  `(progn ${expressions.join(" ")})`;
