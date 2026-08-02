/*
 * Filename: ShortcutEditor.ts
 * FullPath: modules/views/home-view/src/ts/ShortcutEditor.ts
 * Change date and time: 09.30.00_02.08.2026
 * Reason for changes: Theme stamp for light-modal contrast; Open-link URL for view tiles.
 */
import { registerModal } from "fest/lure";
import { getHomeOverlayMountResolver } from "./view-opener";

/** Above `$z-shell-chrome` / context-menu layer so the form is visible and clickable. */
const SHORTCUT_EDITOR_Z = "2147483646";

/** WHY: Match context-menu pin — Settings may not have applied data-theme yet. */
function resolveEditorTheme(): "light" | "dark" {
    const root = document.documentElement;
    const pinned = String(root.getAttribute("data-theme") || "").trim().toLowerCase();
    if (pinned === "light" || pinned === "dark") return pinned;
    const scheme = String(root.getAttribute("data-scheme") || "").trim().toLowerCase();
    if (scheme === "light" || scheme === "dark") return scheme;
    try {
        const stored = String(localStorage.getItem("rs-appearance-theme") || "").trim().toLowerCase();
        if (stored === "light" || stored === "dark") return stored;
    } catch {
        // private mode
    }
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
}

function synthesizeViewHref(view: string): string {
    const id = String(view || "").trim().replace(/^#/, "").replace(/^\/+/, "");
    if (!id) return "";
    /* Mono native Windows2 URL (CWSP-explorer / document style). */
    return `/${id}?shell=environment&native=1&view=${encodeURIComponent(id)}`;
}

export type ShortcutActionOption = {
    value: string;
    label: string;
};

export type ShortcutViewOption = {
    value: string;
    label: string;
};

export type ShortcutEditorDraft = {
    label: string;
    icon: string;
    action: string;
    view: string;
    href: string;
    description: string;
    /** Tile shape: square, circle, or squircle */
    shape: string;
    /** Open link: native immersive vs inline env window (same tab). */
    openLinkTarget: string;
};

type ShortcutEditorOptions = {
    mode: "create" | "edit";
    initial: ShortcutEditorDraft;
    actionOptions: ShortcutActionOption[];
    viewOptions: ShortcutViewOption[];
    onSave: (draft: ShortcutEditorDraft) => void;
    onDelete?: () => void;
    isViewAction?: (action: string) => boolean;
    isHrefAction?: (action: string) => boolean;
    registerForBackNavigation?: boolean;
};

const isDefaultViewAction = (action: string): boolean => action === "open-view";
const isDefaultHrefAction = (action: string): boolean => action === "open-link";

const setSelectOptions = (
    select: HTMLSelectElement | null,
    options: Array<{ value: string; label: string }>,
    selectedValue: string,
    placeholder?: { value: string; label: string }
): void => {
    if (!select) return;
    select.innerHTML = "";
    if (placeholder) {
        const placeholderOption = document.createElement("option");
        placeholderOption.value = placeholder.value;
        placeholderOption.textContent = placeholder.label;
        placeholderOption.selected = selectedValue === placeholder.value;
        select.append(placeholderOption);
    }
    for (const option of options) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        node.selected = option.value === selectedValue;
        select.append(node);
    }
    if (selectedValue && !options.some((option) => option.value === selectedValue)) {
        const fallbackOption = document.createElement("option");
        fallbackOption.value = selectedValue;
        fallbackOption.textContent = selectedValue;
        fallbackOption.selected = true;
        select.append(fallbackOption);
    }
};

export const openShortcutEditor = (options: ShortcutEditorOptions): void => {
    const {
        mode,
        initial,
        actionOptions,
        viewOptions,
        onSave,
        onDelete,
        isViewAction = isDefaultViewAction,
        isHrefAction = isDefaultHrefAction,
        registerForBackNavigation = false
    } = options;

    const modal = document.createElement("div");
    modal.className = "rs-modal-backdrop speed-dial-editor";
    const theme = resolveEditorTheme();
    modal.dataset.theme = theme;
    modal.innerHTML = `
        <form class="modal-form speed-dial-editor__form" data-theme="${theme}">
            <header class="modal-header">
                <h2 class="modal-title">${mode === "create" ? "Create shortcut" : "Edit shortcut"}</h2>
                <p class="modal-description">Configure quick access tiles for frequently used views or links.</p>
            </header>
            <div class="modal-fields">
                <label class="modal-field">
                    <span>Label</span>
                    <input name="label" type="text" minlength="1" required />
                </label>
                <label class="modal-field">
                    <span>Icon</span>
                    <input name="icon" type="text" placeholder="phosphor icon name" />
                </label>
                <label class="modal-field">
                    <span>Shape</span>
                    <select name="shape">
                        <option value="squircle">Squircle</option>
                        <option value="circle">Circle</option>
                        <option value="square">Rounded square</option>
                    </select>
                </label>
                <label class="modal-field">
                    <span>Action</span>
                    <select name="action"></select>
                </label>
                <label class="modal-field" data-field="view">
                    <span>View</span>
                    <select name="view"></select>
                </label>
                <label class="modal-field" data-field="href">
                    <span>Link</span>
                    <input name="href" type="text" inputmode="url" autocomplete="off" placeholder="/settings?native=1, /workcenter, or https://…" />
                </label>
                <label class="modal-field" data-field="open-link-target">
                    <span>Open link in</span>
                    <select name="openLinkTarget">
                        <option value="native-window">Native window (new browser window)</option>
                        <option value="new-tab">Open in new tab</option>
                        <option value="inline">Open Inline (env window, same tab)</option>
                    </select>
                </label>
                <label class="modal-field">
                    <span>Description</span>
                    <textarea name="description" rows="2" placeholder="Optional description"></textarea>
                </label>
            </div>
            <footer class="modal-actions">
                <div class="modal-actions-left">
                    ${mode === "edit" ? '<button type="button" data-action="delete" class="btn danger">Delete</button>' : ""}
                </div>
                <div class="modal-actions-right">
                    <button type="button" data-action="cancel" class="btn secondary">Cancel</button>
                    <button type="submit" class="btn save">Save</button>
                </div>
            </footer>
        </form>
    `;

    const form = modal.querySelector("form") as HTMLFormElement | null;
    const labelInput = form?.querySelector('input[name="label"]') as HTMLInputElement | null;
    const iconInput = form?.querySelector('input[name="icon"]') as HTMLInputElement | null;
    const shapeSelect = form?.querySelector('select[name="shape"]') as HTMLSelectElement | null;
    const actionSelect = form?.querySelector('select[name="action"]') as HTMLSelectElement | null;
    const viewSelect = form?.querySelector('select[name="view"]') as HTMLSelectElement | null;
    const hrefInput = form?.querySelector('input[name="href"]') as HTMLInputElement | null;
    const openLinkTargetSelect = form?.querySelector('select[name="openLinkTarget"]') as HTMLSelectElement | null;
    const descriptionInput = form?.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
    const viewField = form?.querySelector('[data-field="view"]') as HTMLElement | null;
    const hrefField = form?.querySelector('[data-field="href"]') as HTMLElement | null;
    const openLinkTargetField = form?.querySelector('[data-field="open-link-target"]') as HTMLElement | null;

    if (labelInput) labelInput.value = String(initial.label || "New shortcut");
    if (iconInput) iconInput.value = String(initial.icon || "sparkle");
    const shapeVal = String(initial.shape || "squircle").toLowerCase();
    if (shapeSelect) shapeSelect.value = ["circle", "square", "squircle"].includes(shapeVal) ? shapeVal : "squircle";
    if (hrefInput) {
        hrefInput.value = String(initial.href || "");
        const autoHref = synthesizeViewHref(initial.view);
        if (autoHref) hrefInput.placeholder = `Auto: ${autoHref}`;
    }
    if (descriptionInput) descriptionInput.value = String(initial.description || "");
    const olt = String(initial.openLinkTarget || "native-window").toLowerCase();
    if (openLinkTargetSelect) {
        openLinkTargetSelect.value =
            olt === "inline" || olt === "in-shell"
                ? "inline"
                : olt === "new-tab" || olt === "tab" || olt === "browser" || olt === "browser-tab"
                  ? "new-tab"
                  : "native-window";
    }

    setSelectOptions(actionSelect, actionOptions, String(initial.action || ""));
    setSelectOptions(viewSelect, viewOptions, String(initial.view || ""), { value: "", label: "Choose view" });

    const syncFieldVisibility = () => {
        const action = String(actionSelect?.value || "");
        if (viewField) viewField.hidden = !isViewAction(action);
        if (hrefField) hrefField.hidden = !isHrefAction(action);
        /* Show target mode for Open link (and when Open view also exposes Link). */
        if (openLinkTargetField) {
            openLinkTargetField.hidden = !(action === "open-link" || isHrefAction(action));
        }
        /* Prefill Open-link from view when switching to link action with empty href. */
        if (action === "open-link" && hrefInput && !String(hrefInput.value || "").trim()) {
            const fromView = synthesizeViewHref(String(viewSelect?.value || initial.view || ""));
            if (fromView) hrefInput.value = fromView;
        }
        const autoHref = synthesizeViewHref(String(viewSelect?.value || initial.view || ""));
        if (hrefInput && autoHref) {
            hrefInput.placeholder = `Auto: ${autoHref}`;
        }
    };

    viewSelect?.addEventListener("change", () => {
        const autoHref = synthesizeViewHref(String(viewSelect?.value || ""));
        if (hrefInput && autoHref) hrefInput.placeholder = `Auto: ${autoHref}`;
    });

    let unregisterBackNav: (() => void) | null = null;
    const escHandler = (event: KeyboardEvent) => {
        if (event.key === "Escape") closeModal();
    };

    const closeModal = () => {
        unregisterBackNav?.();
        unregisterBackNav = null;
        document.removeEventListener("keydown", escHandler);
        modal.remove();
    };

    actionSelect?.addEventListener("change", syncFieldVisibility);
    syncFieldVisibility();

    document.addEventListener("keydown", escHandler);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
    });

    form?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const action = target?.dataset?.action || "";
        if (action === "cancel") {
            event.preventDefault();
            closeModal();
            return;
        }
        if (action === "delete" && mode === "edit") {
            event.preventDefault();
            onDelete?.();
            closeModal();
        }
    });

    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        onSave({
            label: String(labelInput?.value || "").trim() || "Item",
            icon: String(iconInput?.value || "").trim() || "sparkle",
            action: String(actionSelect?.value || "open-view"),
            view: String(viewSelect?.value || "").trim(),
            href: String(hrefInput?.value || "").trim(),
            description: String(descriptionInput?.value || "").trim(),
            shape: String(shapeSelect?.value || "squircle").toLowerCase(),
            openLinkTarget: (() => {
                const v = String(openLinkTargetSelect?.value || "native-window").toLowerCase();
                if (v === "inline" || v === "in-shell") return "inline";
                if (v === "new-tab" || v === "tab" || v === "browser") return "new-tab";
                return "native-window";
            })()
        });
        closeModal();
    });

    if (registerForBackNavigation) {
        unregisterBackNav = registerModal(modal, undefined, closeModal);
    }
    // WHY: body alone is under `.env-shell-chrome` (z≈2.147e9); prefer overlay slot + inline z.
    modal.style.setProperty("position", "fixed", "important");
    modal.style.setProperty("inset", "0", "important");
    modal.style.setProperty("z-index", SHORTCUT_EDITOR_Z, "important");
    modal.style.setProperty("color-scheme", theme === "light" ? "light only" : "dark only", "important");
    form?.style.setProperty("color-scheme", theme === "light" ? "light only" : "dark only", "important");
    const mount =
        (typeof getHomeOverlayMountResolver === "function"
            ? getHomeOverlayMountResolver()?.(null)
            : null) ?? document.body;
    mount.append(modal);
};
