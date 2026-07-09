import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { AutocadBridge } from "./bridge";
import { ViewCapture } from "./capture";
import { BridgeConfig } from "./config";
import { AutocadMcp } from "./server";

const MainLayer = AutocadMcp.Default.pipe(
  Layer.provide(AutocadBridge.Default),
  Layer.provide(ViewCapture.Default),
  Layer.provide(BridgeConfig.Default),
  Layer.provide(BunContext.layer),
);

BunRuntime.runMain(Layer.launch(MainLayer));
