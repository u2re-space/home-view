/**
 * Default speed-dial action handlers for fl-ui (no CrossWord Actions.ts / core).
 * Hosts may extend via `registerSpeedDialAction` before the grid mounts.
 */

import { navigate } from "fest/lure";
import {
    NAVIGATION_SHORTCUTS,
    snapshotSpeedDialItem,
    type SpeedDialItem,
    type SpeedDialMetaRegistry
} from "./launcher-state";
import { showSuccess, showError } from "../../misc/Toast";
import { getSpeedDialViewOpener } from "./view-opener";

/** Same arity as handlers invoked from SpeedDial.runItemAction. */
export type SpeedDialActionHandler = (context: any, second?: any, third?: HTMLElement) => any;

const actionRegistry = new Map<string, SpeedDialActionHandler>();
const labelsPerAction = new Map<string, (entityDesc: any) => string>();
const iconsPerAction = new Map<string, string>();

let builtinsInstalled = false;

const isSameOrigin = (href: string): boolean => {
    try {
        const u = new URL(href, typeof location !== "undefined" ? location.href : "https://local.invalid/");
        return u.origin === (typeof location !== "undefined" ? location.origin : "");
    } catch {
        return false;
    }
};

const copyTextToClipboard = async (text: string): Promise<void> => {
    const t = String(text || "").trim();
    if (!t.length) throw new Error("empty");
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(t);
        return;
    }
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
};

const ensureHashNavigation = (view: string, viewMaker?: any, props?: Record<string, string>): void => {
    if (!view || typeof window === "undefined") return;
    if (typeof viewMaker === "function") {
        viewMaker(view, props);
        return;
    }
    const opener = getSpeedDialViewOpener();
    if (opener) {
        opener(view, props);
        return;
    }
    const hash = `#${String(view).replace(/^#/, "")}`;
    if (location.hash !== hash) navigate(hash);
};

const installBuiltins = (): void => {
    if (builtinsInstalled) return;
    builtinsInstalled = true;

    iconsPerAction.set("open-view", "compass");
    iconsPerAction.set("open-link", "arrow-square-out");
    iconsPerAction.set("copy-link", "copy");
    iconsPerAction.set("copy-state-desc", "brackets-curly");

    labelsPerAction.set("open-view", (d: any) => `Open ${d?.label || "view"}`);
    labelsPerAction.set("open-link", (d: any) => (d?.label ? `Open ${d.label}` : "Open link"));
    labelsPerAction.set("copy-link", () => "Copy link");
    labelsPerAction.set("copy-state-desc", () => "Copy shortcut JSON");

    actionRegistry.set("open-view", async (context: any, entityDesc?: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        const metaMap = context?.meta as SpeedDialMetaRegistry | undefined;
        const meta = item && metaMap?.get ? metaMap.get(item.id) : null;
        const targetView = meta?.view || entityDesc?.view || entityDesc?.type || "";
        if (!targetView) {
            showError("No view target");
            return;
        }
        const viewMaker = context?.viewMaker ?? getSpeedDialViewOpener();
        ensureHashNavigation(targetView, viewMaker, {});
    });

    actionRegistry.set("open-link", async (context: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        const metaMap = context?.meta as SpeedDialMetaRegistry | undefined;
        const meta = item && metaMap?.get ? metaMap.get(item.id) : null;
        const href = meta?.href || (item as any)?.href || context?.href;
        if (!href) {
            showError("Link is missing");
            return;
        }
        const target = isSameOrigin(String(href)) ? "_self" : "_blank";
        try {
            window?.open?.(String(href), target, "noopener,noreferrer");
        } catch (e) {
            console.warn(e);
            showError("Unable to open link");
        }
    });

    actionRegistry.set("copy-link", async (context: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        const metaMap = context?.meta as SpeedDialMetaRegistry | undefined;
        const meta = item && metaMap?.get ? metaMap.get(item.id) : null;
        const href = meta?.href || (item as any)?.href || context?.href;
        if (!href) {
            showError("Nothing to copy");
            return;
        }
        try {
            await copyTextToClipboard(String(href));
            showSuccess("Link copied");
        } catch (e) {
            console.warn(e);
            showError("Failed to copy link");
        }
    });

    actionRegistry.set("copy-state-desc", async (context: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        if (!item) {
            showError("Nothing to copy");
            return;
        }
        const snapshot = snapshotSpeedDialItem(item);
        if (!snapshot) {
            showError("Nothing to copy");
            return;
        }
        try {
            const text = JSON.stringify(snapshot, null, 2);
            await copyTextToClipboard(text);
            showSuccess("Shortcut saved to clipboard");
        } catch (e) {
            console.warn(e);
            showError("Failed to copy shortcut");
        }
    });

    for (const shortcut of NAVIGATION_SHORTCUTS) {
        const actionId = `open-view-${shortcut.view}`;
        if (!iconsPerAction.has(actionId)) iconsPerAction.set(actionId, shortcut.icon);
        if (!labelsPerAction.has(actionId)) labelsPerAction.set(actionId, () => `Open ${shortcut.label}`);
        if (!actionRegistry.has(actionId)) {
            actionRegistry.set(actionId, async (context: any) => {
                return actionRegistry.get("open-view")?.(context, {
                    label: shortcut.label,
                    type: shortcut.view,
                    view: shortcut.view,
                    DIR: "/"
                });
            });
        }
    }
};

/** Override or add a launcher action (e.g. host-specific). */
export function registerSpeedDialAction(id: string, handler: SpeedDialActionHandler): void {
    installBuiltins();
    actionRegistry.set(id, handler);
}

export function getSpeedDialActionRegistry(): Map<string, SpeedDialActionHandler> {
    installBuiltins();
    return actionRegistry;
}

export function getSpeedDialActionLabels(): Map<string, (entityDesc: any) => string> {
    installBuiltins();
    return labelsPerAction;
}

export function getSpeedDialActionIcons(): Map<string, string> {
    installBuiltins();
    return iconsPerAction;
}
