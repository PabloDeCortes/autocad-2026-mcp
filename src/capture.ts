import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { BridgeConfig } from "./config";
import { AutocadNotRunningError, CaptureError } from "./errors";

const maxImageWidth = 1600;

const captureScript = (outputPath: string): string =>
  [
    "$ErrorActionPreference = 'Stop'",
    "try { $acad = [System.Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application') } catch { Write-Output 'NO_AUTOCAD'; exit 0 }",
    "try {",
    "$hwnd = [IntPtr][int64]$acad.HWND",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class AcadCapture {",
    "  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }",
    '  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd);',
    "}",
    "'@",
    "if ([AcadCapture]::IsIconic($hwnd)) { [AcadCapture]::ShowWindowAsync($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 500 }",
    "$rect = New-Object AcadCapture+Rect",
    "[AcadCapture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null",
    "$w = $rect.Right - $rect.Left",
    "$h = $rect.Bottom - $rect.Top",
    "if ($w -le 0 -or $h -le 0) { Write-Output 'EMPTY_WINDOW'; exit 0 }",
    "$bmp = New-Object System.Drawing.Bitmap($w, $h)",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$hdc = $g.GetHdc()",
    "[AcadCapture]::PrintWindow($hwnd, $hdc, 2) | Out-Null",
    "$g.ReleaseHdc($hdc)",
    "$g.Dispose()",
    `if ($w -gt ${maxImageWidth}) {`,
    `$nw = ${maxImageWidth}`,
    `$nh = [int]($h * ${maxImageWidth} / $w)`,
    "$scaled = New-Object System.Drawing.Bitmap($bmp, $nw, $nh)",
    "$bmp.Dispose()",
    "$bmp = $scaled",
    "}",
    `$bmp.Save('${outputPath.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$bmp.Dispose()",
    "Write-Output 'OK'",
    "} catch { Write-Output ('FAILED ' + $_.Exception.Message) }",
  ].join("\n");

export class ViewCapture extends Effect.Service<ViewCapture>()("ViewCapture", {
  effect: Effect.gen(function* () {
    const config = yield* BridgeConfig;
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;

    const capture = (): Effect.Effect<Uint8Array, CaptureError | AutocadNotRunningError> =>
      Effect.gen(function* () {
        const id = yield* Effect.sync(() => crypto.randomUUID());
        const outputPath = join(config.exchangeDirectory, `capture-${id}.png`);
        const encoded = Buffer.from(captureScript(outputPath), "utf16le").toString("base64");
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
          .pipe(Effect.mapError((error) => new CaptureError({ message: error.message })));
        const trimmed = output.trim();
        if (trimmed === "NO_AUTOCAD") {
          return yield* new AutocadNotRunningError();
        }
        if (trimmed !== "OK") {
          return yield* new CaptureError({
            message: trimmed === "" ? "capture produced no output" : trimmed,
          });
        }
        return yield* fs.readFile(outputPath).pipe(
          Effect.mapError((error) => new CaptureError({ message: error.message })),
          Effect.ensuring(Effect.ignore(fs.remove(outputPath))),
        );
      });

    return { capture } as const;
  }),
}) {}
