import { Data } from "effect";
import { absurd } from "effect/Function";

export class AutocadNotRunningError extends Data.TaggedError("AutocadNotRunningError") {}

export class NoActiveDocumentError extends Data.TaggedError("NoActiveDocumentError") {}

export class SendCommandError extends Data.TaggedError("SendCommandError")<{
  readonly message: string;
}> {}

export class BridgeIoError extends Data.TaggedError("BridgeIoError")<{
  readonly message: string;
}> {}

export class BridgeTimeoutError extends Data.TaggedError("BridgeTimeoutError")<{
  readonly message: string;
}> {}

export class BridgeResponseError extends Data.TaggedError("BridgeResponseError")<{
  readonly message: string;
}> {}

export class LispEvaluationError extends Data.TaggedError("LispEvaluationError")<{
  readonly message: string;
}> {}

export class CaptureError extends Data.TaggedError("CaptureError")<{
  readonly message: string;
}> {}

export class ToolInputError extends Data.TaggedError("ToolInputError")<{
  readonly message: string;
}> {}

export type BridgeError =
  | AutocadNotRunningError
  | NoActiveDocumentError
  | SendCommandError
  | BridgeIoError
  | BridgeTimeoutError
  | BridgeResponseError
  | LispEvaluationError
  | CaptureError;

export const toolFailureMessage = (error: ToolInputError | BridgeError): string => {
  switch (error._tag) {
    case "ToolInputError":
      return `Invalid tool input: ${error.message}`;
    case "AutocadNotRunningError":
      return "AutoCAD is not running. Start AutoCAD 2026, open a drawing, and try again.";
    case "NoActiveDocumentError":
      return "AutoCAD is running but no drawing is open. Open a drawing and try again.";
    case "SendCommandError":
      return `Failed to send the command to AutoCAD: ${error.message}`;
    case "BridgeIoError":
      return `File exchange with AutoCAD failed: ${error.message}`;
    case "BridgeTimeoutError":
      return error.message;
    case "BridgeResponseError":
      return `Could not decode the AutoCAD response: ${error.message}`;
    case "LispEvaluationError":
      return `AutoLISP error: ${error.message}`;
    case "CaptureError":
      return `Screen capture failed: ${error.message}`;
    default:
      return absurd(error);
  }
};
