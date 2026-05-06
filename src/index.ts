import type { BaseViewOptions, ShellContext, View, ViewLifecycle, ViewOptions } from "views/types";
import { HomeChannelAction } from "views/apis/channel-actions";
import { initializeOrientedDesktop } from "./ts/OrientDesktop";
import { setSpeedDialViewOpener } from "./ts/view-opener";
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
            this.element = null;
        }
    };

    constructor(options: HomeViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    /**
     * WHY: {@link ShellBase.getContext} exposes `navigate` but not `openView`. Calling both caused a double
     * `navigate("viewer")`; the second hit the same-view short-circuit so the overlay never opened reliably.
     * Prefer `openView` when the host (e.g. environment-shell) provides it.
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
        root.className = "view-home env-home-workspace";
        root.dataset.view = "home";
        root.id = "home";

        setSpeedDialViewOpener((viewId, params) => {
            this.dispatchShellRoute(viewId, { params } as ViewOptions);
        });

        initializeOrientedDesktop(root);

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
