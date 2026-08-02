/**
 * Default speed-dial action handlers for fl-ui (no CWSP-shell Actions.ts / core).
 * Hosts may extend via `registerSpeedDialAction` before the grid mounts.
 */

import { navigate } from "fest/lure";
import {
    NAVIGATION_SHORTCUTS,
    buildSpeedDialViewPathHref,
    isExternalWebHref,
    normalizeExternalWebHref,
    openInDetachedBrowserWindow,
    openInNewBrowserTab,
    parseSpeedDialViewFromHref,
    normalizeOpenLinkTarget,
    resolveItemOpenLinkTarget,
    resolveSpeedDialItemHref,
    snapshotSpeedDialItem,
    type SpeedDialItem,
    type SpeedDialMetaRegistry
} from "./launcher-state";
import { showSuccess, showError } from "./toast";
import { getSpeedDialViewOpener } from "./view-opener";
import {
    MARKDOWN_VIEW_MANAGED_WINDOW_KEY,
    normalizeMarkdownViewWindowId
} from "../../../window-frame/src/views/markdown-view-window";

/**
 * Resolve speed-dial / shortcut `meta.view` and desktop `viewId` strings to a canonical `ViewId`.
 * WHY: Persisted rows may store the human label ("Markdown", "Plan") or legacy ids; {@link normalizeMarkdownViewWindowId}
 * only covers the markdown family.
 */
export function resolveOpenViewTarget(raw: string | undefined | null): string {
    const t = String(raw ?? "").trim();
    if (!t) return "";
    const tLower = t.toLowerCase().replace(/^#/, "");
    const byShortcut = NAVIGATION_SHORTCUTS.find(
        (s) =>
            String(s.view).toLowerCase() === tLower ||
            String(s.label).trim().toLowerCase() === tLower
    );
    if (byShortcut) return String(byShortcut.view);
    const md = normalizeMarkdownViewWindowId(t);
    return md || t.replace(/^#/, "").trim();
}

/** Same arity as handlers invoked from SpeedDial.runItemAction. */
export type SpeedDialActionHandler = (context: any, second?: any, third?: HTMLElement) => any;

const actionRegistry = new Map<string, SpeedDialActionHandler>();
const labelsPerAction = new Map<string, (entityDesc: any) => string>();
const iconsPerAction = new Map<string, string>();

let builtinsInstalled = false;

/**
 * Turn bare view tokens (`settings`, `#workcenter`, `/viewer`) into absolute
 * mono-app URLs (`https://host/settings?shell=environment&native=1&view=settings`).
 * External http(s)/mailto links pass through unchanged.
 */
export const normalizeSpeedDialOpenHref = (raw: string): string => {
    const input = String(raw || "").trim();
    if (!input) return "";
    if (/^(mailto:|blob:|data:)/i.test(input)) return input;

    const asView = (candidate: string): string => {
        const view = resolveOpenViewTarget(candidate);
        return view ? buildSpeedDialViewPathHref(view, true, { native: true }) : "";
    };

    /* Already absolute http(s). */
    if (/^https?:\/\//i.test(input)) {
        try {
            const u = new URL(input);
            if (typeof location !== "undefined" && u.origin === location.origin) {
                const seg = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
                const mono = asView(seg);
                if (mono) return mono;
            }
            return u.href;
        } catch {
            return input;
        }
    }

    if (input.startsWith("/")) {
        const seg = input.replace(/^\//, "").split(/[/?#]/)[0];
        const mono = asView(seg);
        if (mono) return mono;
        try {
            return new URL(input, location.href).href;
        } catch {
            return input;
        }
    }

    const token = input.replace(/^#/, "").split(/[/?#]/)[0].trim();
    const mono = asView(token);
    if (mono && !/[.:]/.test(token)) return mono;

    try {
        return new URL(input, location.href).href;
    } catch {
        return input;
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
        const rawTarget = meta?.view || entityDesc?.view || entityDesc?.type || "";
        const targetView = resolveOpenViewTarget(String(rawTarget || ""));
        if (!targetView) {
            showError("No view target");
            return;
        }
        const viewMaker = context?.viewMaker ?? getSpeedDialViewOpener();
        /*
         * Explicit per-tile / menu Native → new PWA/app window (same as open-link native).
         * Default open-view stays inline in the current environment shell.
         */
        const linkTarget =
            context?.openLinkTarget != null
                ? normalizeOpenLinkTarget(context.openLinkTarget)
                : meta?.openLinkTarget != null && String(meta.openLinkTarget).trim()
                  ? normalizeOpenLinkTarget(meta.openLinkTarget)
                  : "inline";
        if (linkTarget === "native-window") {
            const href = buildSpeedDialViewPathHref(targetView, true, { native: true });
            if (!href) {
                showError("Link is missing");
                return;
            }
            if (!openInDetachedBrowserWindow(href)) {
                showError("Unable to open native window");
            }
            return;
        }
        if (linkTarget === "new-tab") {
            const href = buildSpeedDialViewPathHref(targetView, true, { native: false });
            if (!href) {
                showError("Link is missing");
                return;
            }
            if (!openInNewBrowserTab(href)) {
                showError("Unable to open new tab");
            }
            return;
        }
        ensureHashNavigation(targetView, viewMaker, {});
    });

    actionRegistry.set("open-link", async (context: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        const metaMap = context?.meta as SpeedDialMetaRegistry | undefined;
        const meta = item && metaMap?.get ? metaMap.get(item.id) : null;
        /*
         * - native-window → PWA app window when installed (mono `?native=1`); else detached
         * - inline → openView in current environment shell (same tab)
         * - new-tab → ordinary browser tab (`target=_blank`) for http(s)/www or app URL
         */
        const raw = meta?.href || (item as any)?.href || context?.href || resolveSpeedDialItemHref(item);
        const viewFromMeta = resolveOpenViewTarget(String(meta?.view || ""));
        const externalHref = isExternalWebHref(raw) ? normalizeExternalWebHref(raw) || normalizeSpeedDialOpenHref(String(raw || "")) : "";
        const view = externalHref
            ? ""
            : resolveOpenViewTarget(parseSpeedDialViewFromHref(String(raw || ""))) || viewFromMeta;
        const linkTarget =
            context?.openLinkTarget != null
                ? normalizeOpenLinkTarget(context.openLinkTarget)
                : resolveItemOpenLinkTarget(meta);
        const opener = context?.viewMaker ?? getSpeedDialViewOpener();

        /* Inline: always in-session env window — never a second browser window/tab. */
        if (linkTarget === "inline") {
            if (view && typeof opener === "function") {
                try {
                    opener(view, {});
                    return;
                } catch (e) {
                    console.warn("[speed-dial] inline openView failed; falling back to URL", e);
                }
            }
            if (externalHref && typeof opener === "function") {
                try {
                    /* Prefer in-shell viewer for arbitrary http(s) when available. */
                    opener("viewer", { params: { url: externalHref, href: externalHref } } as any);
                    return;
                } catch (e) {
                    console.warn("[speed-dial] inline viewer open failed", e);
                }
            }
            showError(externalHref ? "Unable to open link inline" : "Link is missing");
            return;
        }

        /* New browser tab — keep external URLs as-is; app views open without native=1. */
        if (linkTarget === "new-tab") {
            const href = externalHref
                ? externalHref
                : view
                  ? buildSpeedDialViewPathHref(view, true, { native: false })
                  : normalizeSpeedDialOpenHref(String(raw || ""));
            if (!href) {
                showError("Link is missing");
                return;
            }
            if (!openInNewBrowserTab(href)) {
                showError("Unable to open new tab");
            }
            return;
        }

        /* Native / detached window: mono boot for app views; sized window for http(s). */
        const href = externalHref
            ? externalHref
            : view
              ? buildSpeedDialViewPathHref(view, true, { native: true })
              : normalizeSpeedDialOpenHref(String(raw || ""));
        if (!href) {
            showError("Link is missing");
            return;
        }
        if (!openInDetachedBrowserWindow(href)) {
            showError("Unable to open native window (popup blocked?)");
        }
    });

    actionRegistry.set("copy-link", async (context: any) => {
        const item = context?.items?.find?.((i: SpeedDialItem) => i?.id === context?.id) || null;
        const metaMap = context?.meta as SpeedDialMetaRegistry | undefined;
        const meta = item && metaMap?.get ? metaMap.get(item.id) : null;
        const raw = meta?.href || (item as any)?.href || context?.href || resolveSpeedDialItemHref(item);
        const href = normalizeSpeedDialOpenHref(String(raw || ""));
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

    /*
     * WHY: `NAVIGATION_SHORTCUTS` registers `open-view-viewer` only; persisted grids / older builds used
     * `open-view-markdown` or `open-view-reader`. Re-map to canonical `viewer` (markdown-view module).
     */
    const viewerAliasActions: Array<{ alias: string; label: string }> = [
        { alias: "markdown", label: "Markdown" },
        { alias: "reader", label: "Markdown" }
    ];
    for (const { alias, label } of viewerAliasActions) {
        const actionId = `open-view-${alias}`;
        if (actionRegistry.has(actionId)) continue;
        iconsPerAction.set(actionId, "article");
        labelsPerAction.set(actionId, () => `Open ${label}`);
        actionRegistry.set(actionId, async (context: any) => {
            return actionRegistry.get("open-view")?.(context, {
                label,
                type: MARKDOWN_VIEW_MANAGED_WINDOW_KEY,
                view: MARKDOWN_VIEW_MANAGED_WINDOW_KEY,
                DIR: "/"
            });
        });
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
