import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Data, Duration, Effect, Option, Schedule, Schema } from "effect";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { BridgeConfig } from "./config";
import {
  AutocadNotRunningError,
  BridgeIoError,
  BridgeResponseError,
  BridgeTimeoutError,
  LispEvaluationError,
  NoActiveDocumentError,
  SendCommandError,
} from "./errors";
import type { BridgeError } from "./errors";
import { lispString } from "./lisp";
import { BridgeResponse } from "./schemas";

class ResponseNotReady extends Data.TaggedError("ResponseNotReady") {}

const TriggerOutcome = Schema.Literal("OK", "NO_AUTOCAD", "NO_DOCUMENT", "SEND_FAILED");

const decodeTriggerOutcome = Schema.decodeUnknownOption(TriggerOutcome);

const decodeBridgeResponse = Schema.decodeUnknown(Schema.parseJson(BridgeResponse));

const toForwardSlashes = (value: string): string => value.replaceAll("\\", "/");

const triggerScript = (lispCall: string): string => {
  const escaped = lispCall.replaceAll("'", "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "try { $acad = [System.Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application') } catch { Write-Output 'NO_AUTOCAD'; exit 0 }",
    "$doc = $null",
    "try { $doc = $acad.ActiveDocument } catch {}",
    "if ($null -eq $doc) { Write-Output 'NO_DOCUMENT'; exit 0 }",
    `try { $doc.SendCommand('${escaped}' + "\`n"); Write-Output 'OK' } catch { Write-Output ('SEND_FAILED ' + $_.Exception.Message) }`,
  ].join("\n");
};

const io = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
  Effect.mapError(effect, (error) => new BridgeIoError({ message: error.message }));

export class AutocadBridge extends Effect.Service<AutocadBridge>()("AutocadBridge", {
  effect: Effect.gen(function* () {
    const config = yield* BridgeConfig;
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
    const semaphore = yield* Effect.makeSemaphore(1);
    const pluginPath = toForwardSlashes(config.pluginPath);

    yield* io(fs.makeDirectory(config.exchangeDirectory, { recursive: true }));

    const trigger = (lispCall: string) =>
      Effect.gen(function* () {
        const encoded = Buffer.from(triggerScript(lispCall), "utf16le").toString("base64");
        const command = Command.make(
          config.powershellPath,
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encoded,
        );
        const output = yield* executor
          .string(command)
          .pipe(Effect.mapError((error) => new SendCommandError({ message: error.message })));
        const trimmed = output.trim();
        const outcome = decodeTriggerOutcome(trimmed.split(/\s+/)[0] ?? "");
        if (Option.isNone(outcome)) {
          yield* new SendCommandError({
            message: trimmed === "" ? "powershell produced no output" : trimmed,
          });
          return;
        }
        switch (outcome.value) {
          case "OK":
            return;
          case "NO_AUTOCAD":
            yield* new AutocadNotRunningError();
            return;
          case "NO_DOCUMENT":
            yield* new NoActiveDocumentError();
            return;
          case "SEND_FAILED":
            yield* new SendCommandError({
              message: trimmed.slice("SEND_FAILED".length).trim(),
            });
            return;
        }
      });

    const awaitResponse = (responsePath: string) =>
      io(fs.exists(responsePath)).pipe(
        Effect.filterOrFail(
          (exists) => exists,
          () => new ResponseNotReady(),
        ),
        Effect.zipRight(io(fs.readFileString(responsePath))),
        Effect.retry({
          schedule: Schedule.spaced(config.pollInterval),
          while: (error) => error._tag === "ResponseNotReady",
        }),
        Effect.timeoutFail({
          duration: config.responseTimeout,
          onTimeout: () =>
            new BridgeTimeoutError({
              message: `No response from AutoCAD within ${Duration.format(config.responseTimeout)}. Verify AutoCAD is idle (no command or dialog in progress) and that the plugin at ${pluginPath} is loadable.`,
            }),
        }),
        Effect.catchTag("ResponseNotReady", (error) => Effect.die(error)),
      );

    const exchange = (
      expression: string,
      requestPath: string,
      responsePath: string,
    ): Effect.Effect<unknown, BridgeError> =>
      Effect.gen(function* () {
        yield* io(fs.writeFileString(requestPath, expression));
        yield* trigger(
          `(if (null mcp:execute) (load ${lispString(pluginPath)} nil)) (mcp:execute ${lispString(requestPath)} ${lispString(responsePath)})`,
        );
        const raw = yield* awaitResponse(responsePath);
        const response = yield* decodeBridgeResponse(raw).pipe(
          Effect.mapError((error) => new BridgeResponseError({ message: error.message })),
        );
        if (!response.ok) {
          return yield* new LispEvaluationError({ message: response.error });
        }
        return response.result ?? null;
      });

    const evaluate = (expression: string): Effect.Effect<unknown, BridgeError> =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const id = yield* Effect.sync(() => crypto.randomUUID());
          const requestPath = toForwardSlashes(join(config.exchangeDirectory, `request-${id}.lsp`));
          const responsePath = toForwardSlashes(
            join(config.exchangeDirectory, `response-${id}.json`),
          );
          return yield* exchange(expression, requestPath, responsePath).pipe(
            Effect.ensuring(
              Effect.all([
                Effect.ignore(fs.remove(requestPath)),
                Effect.ignore(fs.remove(responsePath)),
              ]),
            ),
          );
        }),
      );

    return { evaluate } as const;
  }),
}) {}
