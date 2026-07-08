import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { AutocadMcp } from "./server";

BunRuntime.runMain(Layer.launch(AutocadMcp.Default));
