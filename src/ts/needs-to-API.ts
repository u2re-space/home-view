/**
 * Home view — lightweight landing / shortcuts shell when `home` is the default view.
 */

import { H } from "fest/lure";

export type HomeViewOptions = BaseViewOptions;

export class HomeView implements View {
    id = "home" as const;
    name = "Home";
    icon = "house";

    private options: HomeViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;

    lifecycle: ViewLifecycle = {
        onMount: () => undefined,
        onUnmount: () => undefined,
        onShow: () => undefined,
        onHide: () => undefined,
    };

    constructor(options: HomeViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        const navigate = (viewId: string) => this.shellContext?.navigate(viewId as never);

        this.element = H`
            <div class="view-home" data-view="home">
                <header class="view-home__header">
                    <h1 class="view-home__title">CrossWord</h1>
                    <p class="view-home__subtitle">Pick a workspace to continue.</p>
                </header>
                <nav class="view-home__nav" aria-label="Quick open">
                    <button type="button" class="view-home__btn" data-open="workcenter">Work Center</button>
                    <button type="button" class="view-home__btn" data-open="viewer">Viewer</button>
                    <button type="button" class="view-home__btn" data-open="explorer">Explorer</button>
                    <button type="button" class="view-home__btn" data-open="settings">Settings</button>
                </nav>
            </div>
        `;

        this.element.querySelectorAll("[data-open]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = (btn as HTMLElement).dataset.open;
                if (id) navigate(id);
            });
        });

        return this.element;
    }

    canHandleMessage(): boolean {
        return false;
    }

    async handleMessage(): Promise<void> {}

    invokeChannelApi(action: string, payload?: unknown): unknown {
        if (action === HomeChannelAction.Navigate || action === HomeChannelAction.OpenView) {
            const id =
                typeof payload === "string"
                    ? payload
                    : payload && typeof payload === "object" && payload !== null && "viewId" in payload
                      ? String((payload as Record<string, unknown>).viewId)
                      : "";
            const trimmed = id.trim();
            if (trimmed) this.shellContext?.navigate(trimmed as never);
            return Boolean(trimmed);
        }

        if (action === HomeChannelAction.WallpaperSet) {
            const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
            workspaceApplyWallpaper({
                src: typeof p.src === "string" ? p.src : undefined,
                opacity: typeof p.opacity === "number" ? p.opacity : undefined,
                blur: typeof p.blur === "number" ? p.blur : undefined
            });
            return true;
        }

        if (action === HomeChannelAction.WallpaperFromFile && payload instanceof File) {
            workspaceApplyWallpaperFromFile(payload);
            return true;
        }

        if (action === HomeChannelAction.SpeedDialPinHref) {
            const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
            const href = typeof p.href === "string" ? p.href : "";
            const label = typeof p.label === "string" ? p.label : href;
            if (!href.trim()) return false;
            workspacePinHrefToSpeedDial({
                href,
                label,
                icon: typeof p.icon === "string" ? p.icon : undefined,
                action: typeof p.action === "string" ? (p.action as "open-link") : undefined
            });
            return true;
        }

        if (action === HomeChannelAction.SpeedDialPinFile && payload instanceof File) {
            workspacePinFileToSpeedDial(payload);
            return true;
        }

        return undefined;
    }
}

export function createView(options?: HomeViewOptions): HomeView {
    return new HomeView(options);
}

export const createHomeView = createView;

export default createView;
