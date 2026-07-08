import { blockTools } from "./blocks";
import { entityTools } from "./entities";
import { layerTools } from "./layers";
import { sessionTools } from "./session";
import type { Tool } from "./definition";

export const tools: ReadonlyArray<Tool> = [
  ...sessionTools,
  ...entityTools,
  ...layerTools,
  ...blockTools,
];
