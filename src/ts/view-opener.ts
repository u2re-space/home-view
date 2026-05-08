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

/** Resolved from `shellContext.resolveOverlayMountPoint` while home is mounted (context menus above `.wf-frame`). */
export type OverlayMountResolver = (anchor?: Element | null) => HTMLElement;

let overlayMountResolver: OverlayMountResolver | null = null;

export function setHomeOverlayMountResolver(fn: OverlayMountResolver | null): void {
    overlayMountResolver = typeof fn === "function" ? fn : null;
}

export function getHomeOverlayMountResolver(): OverlayMountResolver | null {
    return overlayMountResolver;
}
