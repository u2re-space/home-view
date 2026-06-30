import { registerModal } from "fest/lure";

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
    modal.innerHTML = `
        <form class="modal-form speed-dial-editor__form">
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
                    <input name="href" type="text" inputmode="url" autocomplete="off" placeholder="https://…, mailto:…" />
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
    const descriptionInput = form?.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
    const viewField = form?.querySelector('[data-field="view"]') as HTMLElement | null;
    const hrefField = form?.querySelector('[data-field="href"]') as HTMLElement | null;

    if (labelInput) labelInput.value = String(initial.label || "New shortcut");
    if (iconInput) iconInput.value = String(initial.icon || "sparkle");
    const shapeVal = String(initial.shape || "squircle").toLowerCase();
    if (shapeSelect) shapeSelect.value = ["circle", "square", "squircle"].includes(shapeVal) ? shapeVal : "squircle";
    if (hrefInput) hrefInput.value = String(initial.href || "");
    if (descriptionInput) descriptionInput.value = String(initial.description || "");

    setSelectOptions(actionSelect, actionOptions, String(initial.action || ""));
    setSelectOptions(viewSelect, viewOptions, String(initial.view || ""), { value: "", label: "Choose view" });

    const syncFieldVisibility = () => {
        const action = String(actionSelect?.value || "");
        if (viewField) viewField.hidden = !isViewAction(action);
        if (hrefField) hrefField.hidden = !isHrefAction(action);
    };

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
            shape: String(shapeSelect?.value || "squircle").toLowerCase()
        });
        closeModal();
    });

    if (registerForBackNavigation) {
        unregisterBackNav = registerModal(modal, undefined, closeModal);
    }
    document.body.append(modal);
};
