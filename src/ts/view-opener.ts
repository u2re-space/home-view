/**
 * View navigation callback for speed-dial / home launcher.
 * Host apps register `setSpeedDialViewOpener`; otherwise actions fall back to hash routing via `fest/lure`.
 */

export type SpeedDialViewOpener = (view: string, params?: Record<string, string>) => void;

let viewOpener: SpeedDialViewOpener | null = null;

/** Register how "open-view" shortcuts reach your shell (tabs, router, etc.). */
export function setSpeedDialViewOpener(opener: SpeedDialViewOpener | null): void {
    viewOpener = typeof opener === "function" ? opener : null;
}

export function getSpeedDialViewOpener(): SpeedDialViewOpener | null {
    return viewOpener;
}
