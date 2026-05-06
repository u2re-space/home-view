/**
 * Lightweight toasts for home-view / SpeedDial (no CrossWord core).
 * Shells may listen for `view:toast` on `window` and render FL-UI / status UI.
 */
export function showSuccess(message: string): void {
    globalThis.dispatchEvent?.(
        new CustomEvent("view:toast", { detail: { type: "success", message: String(message || "") } })
    );
}

export function showError(message: string): void {
    globalThis.dispatchEvent?.(
        new CustomEvent("view:toast", { detail: { type: "error", message: String(message || "") } })
    );
}
