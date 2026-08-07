/* Registers `ui-icon` (UIPhosphorIcon) for launcher tiles. */
import "@fest-lib/icon";
import type { BaseViewOptions, ShellContext, View, ViewLifecycle, ViewOptions } from "views/types";
import { HomeChannelAction } from "views/apis/channel-actions";
import { initializeOrientedDesktop } from "./ts/OrientDesktop";
import { setHomeOverlayMountResolver, setSpeedDialViewOpener } from "./ts/view-opener";
import { resolveOpenViewTarget } from "./ts/action-registry";

export type HomeViewOptions = BaseViewOptions;

export { initializeOrientedDesktop } from "./ts/OrientDesktop";

export class HomeView implements View {
    id = "home";
    name = "Home";
    icon = "house";

    private options: HomeViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;

    lifecycle: ViewLifecycle = {
        onUnmount: () => {
            setSpeedDialViewOpener(null);
            setHomeOverlayMountResolver(null);
            this.element = null;
        }
    };

    constructor(options: HomeViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    /**
     * WHY: prefer `openView` when the host provides it — calling both navigate + openView
     * caused duplicate navigation and unreliable overlay open on environment shell.
     */
    private dispatchShellRoute(viewId: string, opts?: ViewOptions): void {
        const id = resolveOpenViewTarget(viewId);
        if (!id) return;
        const shellContext = this.shellContext;
        if (!shellContext) {
            console.warn("[HomeView] No shellContext; cannot open:", id);
            return;
        }
        if (typeof shellContext.openView === "function") {
            void Promise.resolve(shellContext.openView(id, opts)).catch((e) =>
                console.warn("[HomeView] shellContext.openView failed", id, e)
            );
        } else if (typeof shellContext.navigate === "function") {
            void Promise.resolve(shellContext.navigate(id, opts)).catch((e) =>
                console.warn("[HomeView] shellContext.navigate failed", id, e)
            );
        } else {
            console.warn("[HomeView] shellContext has no navigate/openView; cannot open:", id);
        }
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext ?? this.shellContext;
        }

        const root = document.createElement("section");
        /* WHY: `view-home--grid` + env-home-workspace → transparent desktop host (not marketing .view-home). */
        root.className = "view-home view-home--grid env-home-workspace";
        root.dataset.view = "home";
        /* WHY: SpeedDial root owns `#home` for paste/ctx selectors; avoid duplicate ids. */
        root.id = "home-view";

        const openFromLauncher = (viewId: string, params?: Record<string, string>) => {
            const p = { ...(params || {}) };
            const native = String(p.native || "");
            /* WHY: Open link / mono apps pass native=1 → Windows2 WCO (not a nested env desktop). */
            this.dispatchShellRoute(viewId, {
                ...(native === "1" || native === "true" ? { native: "1" } : {}),
                params: p
            } as ViewOptions);
        };
        setSpeedDialViewOpener(openFromLauncher);

        setHomeOverlayMountResolver(
            typeof this.shellContext?.resolveOverlayMountPoint === "function"
                ? (anchor) => this.shellContext!.resolveOverlayMountPoint!(anchor)
                : null
        );

        /* WHY: pass opener into SpeedDial/createCtxMenu so mount cannot clear it with undefined. */
        initializeOrientedDesktop(root, openFromLauncher);

        this.element = root;
        return root;
    }

    invokeChannelApi(action: string, payload?: unknown): unknown {
        if (action !== HomeChannelAction.Navigate && action !== HomeChannelAction.OpenView) return undefined;
        const viewId =
            typeof payload === "string"
                ? payload
                : payload && typeof payload === "object" && "viewId" in payload
                  ? String((payload as Record<string, unknown>).viewId)
                  : "";
        if (!viewId.trim()) return false;
        this.dispatchShellRoute(viewId.trim());
        return true;
    }
}

export function createView(options?: HomeViewOptions): HomeView {
    return new HomeView(options);
}

export const createHomeView = createView;
export default createView;
