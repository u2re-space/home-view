import type { BaseViewOptions, ShellContext, View, ViewLifecycle, ViewOptions } from "views/types";
import { HomeChannelAction } from "views/apis/channel-actions";

export type HomeViewOptions = BaseViewOptions;

export class HomeView implements View {
    id = "home";
    name = "Home";
    icon = "house";

    private options: HomeViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;

    lifecycle: ViewLifecycle = {
        onUnmount: () => {
            this.element = null;
        }
    };

    constructor(options: HomeViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext ?? this.shellContext;
        }

        const root = document.createElement("section");
        root.className = "view-home";
        root.dataset.view = "home";
        root.innerHTML = `
            <header class="view-home__header">
                <h1 class="view-home__title">U2RE Space</h1>
                <p class="view-home__subtitle">Pick a workspace view to continue.</p>
            </header>
            <nav class="view-home__nav" aria-label="Quick open">
                <button type="button" class="view-home__btn" data-open="workcenter">Work Center</button>
                <button type="button" class="view-home__btn" data-open="viewer">Viewer</button>
                <button type="button" class="view-home__btn" data-open="explorer">Explorer</button>
                <button type="button" class="view-home__btn" data-open="settings">Settings</button>
            </nav>
        `;

        root.querySelectorAll<HTMLElement>("[data-open]").forEach((button) => {
            button.addEventListener("click", () => {
                const viewId = button.dataset.open;
                if (viewId) void this.shellContext?.navigate?.(viewId);
            });
        });

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
        void this.shellContext?.navigate?.(viewId.trim());
        return true;
    }
}

export function createView(options?: HomeViewOptions): HomeView {
    return new HomeView(options);
}

export const createHomeView = createView;
export default createView;
