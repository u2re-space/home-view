import { observe, numberRef, propRef, stringRef, affected } from "fest/object";
import { E, H, orientRef, M, provide, handleIncomingEntries } from "fest/lure";
import { pointerAnchorRef } from "fest/lure";
import { bindInteraction, resolveGridCellFromClientPoint } from "./Interact";
import { showSuccess, showError } from "./toast";
import { openUnifiedContextMenu, type ContextMenuEntry } from "../explorer/ContextMenu";
import {
    speedDialMeta,
    speedDialItems,
    createEmptySpeedDialItem,
    addSpeedDialItem,
    upsertSpeedDialItem,
    removeSpeedDialItem,
    persistSpeedDialItems,
    persistSpeedDialMeta,
    findSpeedDialItem,
    getSpeedDialMeta,
    ensureSpeedDialMeta,
    NAVIGATION_SHORTCUTS,
    wallpaperState,
    persistWallpaper,
    gridLayoutState,
    createSpeedDialItemFromClipboard,
    parseSpeedDialItemFromJSON,
    parseSpeedDialItemFromURL,
    type SpeedDialItem,
    type GridCell
} from "./launcher-state";
import { isInFocus, MOCElement } from "fest/dom";
import { openShortcutEditor } from "./ShortcutEditor";
import { setSpeedDialViewOpener, getSpeedDialViewOpener } from "./view-opener";
import { getSpeedDialActionRegistry, getSpeedDialActionLabels, getSpeedDialActionIcons } from "./action-registry";
let ctxMenuBound = false;
let persistItemsTimer: ReturnType<typeof setTimeout> | null = null;

/** Lazy-init: top-level `observe` + `pointerAnchorRef` ran during chunk eval and hit TDZ vs `com-app` (see vite-chunk-placement). */
let layoutSingleton: ReturnType<typeof observe<[number, number]>> | null = null;

function getLayout(): ReturnType<typeof observe<[number, number]>> {
    if (!layoutSingleton) {
        layoutSingleton = observe([gridLayoutState.columns ?? 4, gridLayoutState.rows ?? 8]);
        affected(gridLayoutState, () => {
            layoutSingleton![0] = gridLayoutState.columns ?? 4;
            layoutSingleton![1] = gridLayoutState.rows ?? 8;
        });
    }
    return layoutSingleton;
}

type PointerAnchorPair = ReturnType<typeof pointerAnchorRef>;
type NumberRefPair = [ReturnType<typeof numberRef>, ReturnType<typeof numberRef>];
let coordinateRefSingleton: PointerAnchorPair | NumberRefPair | null = null;

function getCoordinateRef(): PointerAnchorPair | NumberRefPair {
    if (!coordinateRefSingleton) {
        coordinateRefSingleton =
            typeof document !== "undefined" ? pointerAnchorRef() : [numberRef(0), numberRef(0)];
    }
    return coordinateRefSingleton;
}

const schedulePersistItems = () => {
    if (persistItemsTimer) clearTimeout(persistItemsTimer);
    persistItemsTimer = setTimeout(() => {
        persistItemsTimer = null;
        persistSpeedDialItems();
    }, 80);
};
const resolveItemAction = (item: SpeedDialItem, override?: string) => {
    if (override) return override;
    const entry = getSpeedDialMeta(item.id);
    return entry?.action || item?.action || "open-view";
};

const ACTION_OPTIONS = [
    { value: "open-view", label: "Open view" },
    { value: "open-link", label: "Open link" },
    { value: "copy-link", label: "Copy link" },
    { value: "copy-state-desc", label: "Copy state + desc" }
];
const DEFAULT_WALLPAPER_SRC = "/assets/wallpaper.jpg";
const WALLPAPER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);

const getRefValue = (ref: any, fallback = "") => {
    if (ref && typeof ref === "object" && "value" in ref) return ref.value ?? fallback;
    return ref ?? fallback;
};

const buildDescriptor = (item: SpeedDialItem) => {
    const meta = getSpeedDialMeta(item.id);
    return {
        label: getRefValue(item?.label),
        type: meta?.view || "speed-dial",
        DIR: "/",
        href: meta?.href,
        view: meta?.view,
        action: resolveItemAction(item)
    };
};

//
const bindCell = (el: HTMLElement, args: any) => {
    const { item } = args;
    const cell = item?.cell ?? [0, 0];
    const layout = getLayout();
    E(el, {
        style: {
            "--cell-x": propRef(cell, 0),
            "--cell-y": propRef(cell, 1),
            "--p-cell-x": propRef(cell, 0),
            "--p-cell-y": propRef(cell, 1),
            "--layout-c": propRef(layout, 0),
            "--layout-r": propRef(layout, 1)
        }
    });
};

//
const runItemAction = (item: SpeedDialItem, actionId?: string, extras: { event?: Event; initiator?: HTMLElement } = {}, makeView?: any) => {
    const resolvedAction = resolveItemAction(item, actionId);
    const action = getSpeedDialActionRegistry().get(resolvedAction);
    if (!action) { showError("Action is unavailable"); return; }
    //const $meta = getSpeedDialMeta(item.id);
    const context = {
        id: item.id,
        items: speedDialItems,
        meta: speedDialMeta,
        action: resolvedAction,
        viewMaker: makeView
    };
    try {
        action(context as any, item, extras?.initiator);
    } catch (error) {
        console.warn(error);
        showError("Failed to run action");
    }
};

const attachItemNode = (item: SpeedDialItem, el?: HTMLElement | null, interactive = true, makeView?: any) => {
    if (!el) return;
    const args = { layout: getLayout(), items: speedDialItems, item, meta: speedDialMeta };
    el.dataset.id = item.id;
    el.dataset.speedDialItem = "true";
    el.addEventListener("dragstart", (ev)=>ev.preventDefault());
    if (interactive) {
        let pointerDownAt: [number, number] | null = null;
        let pointerDownTs = 0;
        let suppressClickUntil = 0;
        const blockTapUntil = (ms = 280) => {
            suppressClickUntil = Math.max(suppressClickUntil, Date.now() + ms);
        };
        if (!el.dataset.dragGuardBound) {
            el.dataset.dragGuardBound = "1";
            el.addEventListener("m-dragstart", () => blockTapUntil(420));
            el.addEventListener("m-dragsettled", () => {
                blockTapUntil(320);
                schedulePersistItems();
            });
        }
        el.addEventListener("click", (ev)=>{
            if (Date.now() < suppressClickUntil) {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                return;
            }
            ev?.preventDefault?.();
            const interactionState = String((el as HTMLElement)?.dataset?.interactionState || "");
            const blockedByInteraction = interactionState === "onGrab" || interactionState === "onMoving" || interactionState === "onRelax";
            if (!blockedByInteraction && !MOCElement(ev?.target as any, '[data-interaction-state="onMoving"],[data-interaction-state="onGrab"],[data-interaction-state="onRelax"]')) {
                runItemAction(item, undefined, { event: ev, initiator: el }, makeView);
            }
        });
        el.addEventListener("pointerdown", (ev: PointerEvent)=>{
            pointerDownAt = [ev.clientX, ev.clientY];
            pointerDownTs = Date.now();
        });
        el.addEventListener("pointerup", (ev: PointerEvent)=>{
            if (!pointerDownAt) return;
            const dx = ev.clientX - pointerDownAt[0];
            const dy = ev.clientY - pointerDownAt[1];
            const distance = Math.hypot(dx, dy);
            const elapsed = Date.now() - pointerDownTs;
            pointerDownAt = null;
            if (distance <= 6 && elapsed <= 350) {
                // PointerAPI drag helper may swallow synthetic click even for tap-like gestures.
                blockTapUntil(250);
                runItemAction(item, undefined, { event: ev, initiator: el }, makeView);
            }
        });
        el.addEventListener("dblclick", (ev)=>{
            ev?.preventDefault?.();
            openItemEditor(item);
        });
    }

    if (el.dataset.layer === "labels") {
        el.style.pointerEvents = "none";
        // needs to bind cell
        bindCell(el, args);
    }
    if (el.dataset.layer === "icons") {
        bindInteraction(el, { ...args, immediateDragStyles: true });
        const cell = item?.cell ?? [0, 0];
        const layout = getLayout();
        E(el, {
            style: {
                "--cell-x": propRef(cell, 0),
                "--cell-y": propRef(cell, 1),
                "--layout-c": propRef(layout, 0),
                "--layout-r": propRef(layout, 1)
            }
        });
    }
};

const deriveCellFromEvent = (ev?: MouseEvent): GridCell => {
    const grid = document.querySelector<HTMLElement>('#home .speed-dial-grid[data-grid-layer="icons"]')
        || document.querySelector<HTMLElement>("#home .speed-dial-grid:last-of-type")
        || document.querySelector<HTMLElement>("#home .speed-dial-grid");
    if (!grid || !ev) return [0, 0];
    return resolveGridCellFromClientPoint(grid, [ev.clientX, ev.clientY], { layout: getLayout() as [number, number] }, "floor");
};

const deriveCellFromCoordinate = (coordinate: [number, number]): GridCell => {
    const grid = document.querySelector<HTMLElement>('#home .speed-dial-grid[data-grid-layer="icons"]')
        || document.querySelector<HTMLElement>("#home .speed-dial-grid:last-of-type")
        || document.querySelector<HTMLElement>("#home .speed-dial-grid");
    if (!grid || !coordinate) return [0, 0];
    return resolveGridCellFromClientPoint(grid, coordinate, { layout: getLayout() as [number, number] }, "floor");
};

const deriveCellFromAnchor = (): GridCell => {
    const ref = getCoordinateRef();
    return deriveCellFromCoordinate([ref[0].value, ref[1].value]);
};

const looksLikeImageFile = (file?: File | null): boolean => {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    const name = String(file.name || "").trim().toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
    return WALLPAPER_EXTENSIONS.has(ext);
};

const parseUrlFromHtml = (html?: string | null): string | null => {
    const source = String(html || "").trim();
    if (!source) return null;
    const hrefMatch = source.match(/href\s*=\s*["']([^"']+)["']/i);
    const href = String(hrefMatch?.[1] || "").trim();
    if (!href) return null;
    return href;
};

const parseShortcutFromTransfer = (transfer: DataTransfer | null | undefined, suggestedCell: GridCell): SpeedDialItem | null => {
    if (!transfer) return null;
    const plain = String(transfer.getData("text/plain") || "").trim();
    const uriList = String(transfer.getData("text/uri-list") || "").trim();
    const html = String(transfer.getData("text/html") || "").trim();
    const preferred = plain || uriList || parseUrlFromHtml(html) || "";
    if (!preferred) return null;
    return parseSpeedDialItemFromJSON(preferred, suggestedCell)
        || parseSpeedDialItemFromURL(preferred, suggestedCell);
};

const createMenuEntryForAction = (actionId: string, item: SpeedDialItem, fallbackLabel: string = "", makeView?: any) => {
    const descriptor = buildDescriptor(item) as any;
    return {
        id: actionId,
        label: getSpeedDialActionLabels().get(actionId)?.(descriptor) || fallbackLabel,
        icon: getSpeedDialActionIcons().get(actionId) || "command",
        action: (initiator: HTMLElement, _menuItem: any, ev: MouseEvent)=>runItemAction(item, actionId, { event: ev, initiator }, makeView)
    };
};

//
export function makeWallpaper() {
    const oRef = orientRef();
    const srcRef = stringRef(DEFAULT_WALLPAPER_SRC);
    affected([wallpaperState, "src"], (s) => provide("/user" + (s?.src || (typeof s == "string" ? s : null)))
        ?.then?.(blob => (srcRef.value = URL.createObjectURL(blob)))
        ?.catch?.(() => {
            srcRef.value = DEFAULT_WALLPAPER_SRC;
        }) || DEFAULT_WALLPAPER_SRC);
    const CE = H`<canvas slot="backdrop" style="position: absolute; pointer-events: none; min-inline-size: 0px; min-block-size: 0px; inline-size: stretch; block-size: stretch; max-block-size: stretch; max-inline-size: stretch; transform: none; scale: 1; inset: 0; pointer-events: none;" data-orient=${oRef} is="ui-canvas" data-src=${srcRef}></canvas>`;
    return CE;
}

//
const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const url = URL.createObjectURL(file);
            wallpaperState.src = url;
            persistWallpaper();
            showSuccess("Wallpaper updated");
        } catch (e) {
            console.warn(e);
            showError("Failed to set wallpaper");
        }
    };
    input.click();
};

//
const handleSpeedDialPaste = async (event: ClipboardEvent, suggestedCell?: GridCell) => {
    if (!isInFocus(event?.target as HTMLElement, "#home") &&
        !isInFocus(event?.target as HTMLElement, "#home:is(:hover, :focus, :focus-visible), #home:has(:hover, :focus, :focus-visible)", "child")
    ) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
        const targetCell = suggestedCell ?? deriveCellFromAnchor();
        const fromClipboardData = parseShortcutFromTransfer(event.clipboardData, targetCell);
        const item = fromClipboardData || await createSpeedDialItemFromClipboard(targetCell);
        if (!item) {
            return false;
        }

        addSpeedDialItem(item);
        persistSpeedDialItems();
        persistSpeedDialMeta();
        showSuccess("Shortcut created from clipboard");
        return true;
    } catch (e) {
        console.warn("Failed to paste speed dial item:", e);
        return false;
    }
};

//
const handleWallpaperDropOrPaste = (event: DragEvent | ClipboardEvent) => {
    if (isInFocus(event?.target as HTMLElement, "#home") ||
        isInFocus(event?.target as HTMLElement, "#home:is(:hover, :focus, :focus-visible), #home:has(:hover, :focus, :focus-visible)", "child")
    ) {
        const isPaste = event instanceof ClipboardEvent;
        const targetEl = event.target as HTMLElement | null;
        const droppedOnItem = !!targetEl?.closest?.("[data-speed-dial-item]");
        const suggestedCell = deriveCellFromAnchor();
        const dataTransfer = isPaste ? (event as ClipboardEvent).clipboardData : (event as DragEvent).dataTransfer;

        if (isPaste) {
            const fromTransfer = parseShortcutFromTransfer(dataTransfer, suggestedCell);
            if (fromTransfer) {
                event.preventDefault();
                event.stopPropagation();
                addSpeedDialItem(fromTransfer);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut created from pasted link");
                return;
            }
            void handleSpeedDialPaste(event as ClipboardEvent, suggestedCell);
        }

        if (!isPaste) {
            const parsed = parseShortcutFromTransfer(dataTransfer, suggestedCell);
            if (parsed) {
                event.preventDefault();
                event.stopPropagation();
                addSpeedDialItem(parsed);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut created from dropped link");
                return;
            }
        }

        event.preventDefault();
        event.stopPropagation();

        const dt = dataTransfer || ((event as any).clipboardData || (event as any).dataTransfer);
        const hasImageFile = !!Array.from((dt as DataTransfer | null)?.files || []).find((file) => looksLikeImageFile(file));
        if (!hasImageFile || droppedOnItem) {
            return;
        }
        // Defer heavy file/clipboard scanning so the UI thread can process preventDefault first.
        queueMicrotask(() => {
            handleIncomingEntries(dt, "/images/wallpaper/", null, (file, path) => {
                console.log(file, path);
                if (looksLikeImageFile(file)) {
                    wallpaperState.src = path;
                    persistWallpaper();
                    showSuccess("Wallpaper updated");
                }
            });
        });
    }
};


export function SpeedDial(makeView: any) {
    getLayout();
    getCoordinateRef();
    setSpeedDialViewOpener(typeof makeView === "function" ? makeView : null);
    const columnsRef = propRef(gridLayoutState, "columns", 4);
    const rowsRef = propRef(gridLayoutState, "rows", 8);
    const shapeRef = propRef(gridLayoutState, "shape", "square");

    const tileShapeForItem = (item: SpeedDialItem): string => {
        const raw = String(getSpeedDialMeta(item.id)?.shape || "squircle").toLowerCase();
        return raw === "circle" || raw === "square" || raw === "squircle" ? raw : "squircle";
    };

    //
    const renderIconItem = (item: SpeedDialItem)=>{
        return H`<div class="ui-ws-item" data-speed-dial-item data-layer="icons" ref=${(el) => attachItemNode(item, el as HTMLElement, true, makeView)}>
            <div data-shape=${tileShapeForItem(item)} class="ui-ws-item-icon shaped">
                <ui-icon icon=${item.icon}></ui-icon>
            </div>
        </div>`;
    };

    //
    const renderLabelItem = (item: SpeedDialItem)=>{
        return H`<div style="background-color: transparent;" class="ui-ws-item" data-speed-dial-item data-layer="labels" ref=${(el) => attachItemNode(item, el as HTMLElement, true, makeView)}>
            <div class="ui-ws-item-label" style="background-color: transparent;">
                <span style="background-color: transparent;">${getRefValue(item.label)}</span>
            </div>
        </div>`;
    };

    //
    const oRef = orientRef();
    const box = H`<div slot="underlay" style="pointer-events: auto; position: relative; contain: strict; overflow: hidden; display: grid;" id="home" data-mixin="ui-orientbox" class="speed-dial-root" prop:orient=${oRef} ref=${(el: HTMLElement) => E(el, { style: { "--orient": oRef } })} on:dragover=${(ev: DragEvent) => ev.preventDefault()} on:drop=${(ev: DragEvent) => handleWallpaperDropOrPaste(ev)} prop:onPaste=${async (ev: ClipboardEvent) => await handleWallpaperDropOrPaste(ev)}>
        <div style="background-color: transparent; color-scheme: dark; pointer-events: none;" class="speed-dial-grid speed-dial-grid--labels ui-launcher-grid" data-layer="items" data-grid-layer="labels" data-grid-columns=${columnsRef} data-grid-rows=${rowsRef} data-grid-shape=${shapeRef} ref=${(el: HTMLElement) => E(el, { style: { "--layout-c": columnsRef, "--layout-r": rowsRef } })}>
            ${M(speedDialItems, renderLabelItem)}
        </div>
        <div style="background-color: transparent; pointer-events: none;" class="speed-dial-grid speed-dial-grid--icons ui-launcher-grid" data-layer="items" data-grid-layer="icons" data-grid-columns=${columnsRef} data-grid-rows=${rowsRef} data-grid-shape=${shapeRef} ref=${(el: HTMLElement) => E(el, { style: { "--layout-c": columnsRef, "--layout-r": rowsRef } })}>
            ${M(speedDialItems, renderIconItem)}
        </div>
    </div>`;

    //
    return box;
}

//
const openItemEditor = (item?: SpeedDialItem, opts?: {
    suggestedCell?: GridCell;
    seed?: Partial<{ label: string; icon: string; action: string; view: string; href: string; description: string }>;
})=>{
    const workingItem = item ?? createEmptySpeedDialItem(opts?.suggestedCell ?? deriveCellFromAnchor());
    const isNew = !item;
    const workingMeta = ensureSpeedDialMeta(workingItem.id);
    const seed = opts?.seed || {};
    if (isNew && seed?.action) {
        workingItem.action = seed.action;
        workingMeta.action = seed.action;
    }
    if (isNew && seed?.label) {
        workingItem.label.value = seed.label;
    }
    if (isNew && seed?.icon) {
        workingItem.icon.value = seed.icon;
    }
    if (isNew && seed?.view) {
        workingMeta.view = seed.view;
    }
    if (isNew && seed?.href) {
        workingMeta.href = seed.href;
    }
    if (isNew && seed?.description) {
        workingMeta.description = seed.description;
    }
    const draft = {
        label: getRefValue(workingItem.label, "New shortcut"),
        icon: getRefValue(workingItem.icon, "sparkle"),
        action: resolveItemAction(workingItem),
        href: workingMeta?.href || "",
        view: workingMeta?.view || "",
        description: workingMeta?.description || "",
        shape: String(workingMeta?.shape || "squircle")
    };

    openShortcutEditor({
        mode: isNew ? "create" : "edit",
        initial: {
            label: draft.label,
            icon: draft.icon,
            action: draft.action,
            href: draft.href,
            view: draft.view,
            description: draft.description,
            shape: draft.shape
        },
        actionOptions: ACTION_OPTIONS,
        viewOptions: [...NAVIGATION_SHORTCUTS].map((shortcut: { view: string; label: string; icon: string }) => ({
            value: String(shortcut.view || ""),
            label: String(shortcut.label || shortcut.view || "")
        })),
        registerForBackNavigation: true,
        isViewAction: (value) => value === "open-view",
        isHrefAction: (value) => value === "open-link" || value === "copy-link",
        onSave: (next) => {
            workingItem.label.value = next.label;
            workingItem.icon.value = next.icon || "sparkle";
            workingItem.action = next.action || "open-view";
            workingMeta.action = workingItem.action;
            workingMeta.view = next.view;
            workingMeta.href = next.href;
            workingMeta.description = next.description;
            workingMeta.shape = next.shape;
            if (isNew) {
                addSpeedDialItem(workingItem);
            } else {
                upsertSpeedDialItem(workingItem);
            }
            persistSpeedDialItems();
            persistSpeedDialMeta();
            showSuccess(isNew ? "Shortcut created" : "Shortcut updated");
        },
        onDelete: isNew
            ? undefined
            : () => {
                removeSpeedDialItem(workingItem.id);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut removed");
            }
    });
};

export function createCtxMenu(makeView?: any) {
    getLayout();
    getCoordinateRef();
    if (typeof makeView === "function") {
        setSpeedDialViewOpener(makeView);
    }
    if (!ctxMenuBound) {
        ctxMenuBound = true;
        document.addEventListener("contextmenu", (event: MouseEvent) => {
            const homeRoot = (event.target as HTMLElement | null)?.closest?.("#home");
            if (!homeRoot) return;
            event.preventDefault();
            const targetEl = (event.target as HTMLElement | null)?.closest?.("[data-speed-dial-item]");
            const itemId = targetEl?.getAttribute?.("data-id");
            const item = findSpeedDialItem(itemId);
            const guessedCell = deriveCellFromEvent(event) ?? deriveCellFromAnchor();
            const toLeaf = (entry: any): ContextMenuEntry => ({
                id: String(entry?.id || "menu-action"),
                label: String(entry?.label || "Action"),
                icon: String(entry?.icon || "command"),
                action: () => entry?.action?.(targetEl as HTMLElement, entry, event)
            });
            const openViewTask = (view: string, params: Record<string, string> = {}) => {
                const opener = getSpeedDialViewOpener() || makeView;
                if (opener) {
                    opener(view, { ...params, newTask: "1" });
                    return;
                }
                getSpeedDialActionRegistry().get(`open-view-${view}`)?.({ id: "", items: speedDialItems, meta: speedDialMeta }, {});
            };

            const menuItems: ContextMenuEntry[] = item
                ? [
                    {
                        id: "open",
                        label: "Open",
                        icon: "play",
                        action: () => runItemAction(item, undefined, { event, initiator: targetEl as HTMLElement }, getSpeedDialViewOpener() || makeView)
                    },
                    {
                        id: "actions",
                        label: "Actions",
                        icon: "dots-three",
                        action: () => {},
                        children: [
                            toLeaf(createMenuEntryForAction(resolveItemAction(item) || "open-view", item, "Run action", getSpeedDialViewOpener() || makeView)),
                            ...(getSpeedDialMeta(item.id)?.href ? [
                                toLeaf(createMenuEntryForAction("open-link", item, "Open link", getSpeedDialViewOpener() || makeView)),
                                toLeaf(createMenuEntryForAction("copy-link", item, "Copy link", getSpeedDialViewOpener() || makeView))
                            ] : []),
                            toLeaf(createMenuEntryForAction("copy-state-desc", item, "Copy shortcut JSON", getSpeedDialViewOpener() || makeView))
                        ]
                    },
                    {
                        id: "open-in",
                        label: "Open In New",
                        icon: "app-window",
                        action: () => {},
                        children: [
                            {
                                id: "open-in-regular-window",
                                label: "Regular window",
                                icon: "app-window",
                                action: () => {
                                    const targetView = String(getSpeedDialMeta(item.id)?.view || "viewer");
                                    openViewTask(targetView, { windowType: "regular" });
                                }
                            },
                            {
                                id: "open-in-tabbed-window",
                                label: "Tabbed window",
                                icon: "rows-plus-bottom",
                                action: () => {
                                    const targetView = String(getSpeedDialMeta(item.id)?.view || "viewer");
                                    openViewTask(targetView, { windowType: "tabbed" });
                                }
                            }
                        ]
                    },
                    {
                        id: "manage",
                        label: "Manage",
                        icon: "wrench",
                        action: () => {},
                        children: [
                            { id: "edit", label: "Edit Properties", icon: "pencil-simple-line", action: ()=>openItemEditor(item) },
                            {
                                id: "remove",
                                label: "Remove",
                                icon: "trash",
                                danger: true,
                                action: ()=>{
                                    removeSpeedDialItem(item.id);
                                    persistSpeedDialItems();
                                    persistSpeedDialMeta();
                                    showSuccess("Shortcut removed");
                                }
                            }
                        ]
                    }
                ]
                : [
                    {
                        id: "new",
                        label: "New",
                        icon: "plus",
                        action: () => {},
                        children: [
                            {
                                id: "create-shortcut",
                                label: "Create shortcut",
                                icon: "plus",
                                action: ()=>{
                                    openItemEditor(undefined, { suggestedCell: guessedCell });
                                }
                            },
                            {
                                id: "create-link-shortcut",
                                label: "Create link shortcut",
                                icon: "link",
                                action: ()=>{
                                    openItemEditor(undefined, {
                                        suggestedCell: guessedCell,
                                        seed: {
                                            action: "open-link",
                                            icon: "link",
                                            label: "New link",
                                            href: "",
                                            description: ""
                                        }
                                    });
                                }
                            },
                            {
                                id: "paste-shortcut",
                                label: "Paste shortcut",
                                icon: "clipboard",
                                action: async ()=>{
                                    try {
                                        const speedDialItem = await createSpeedDialItemFromClipboard(guessedCell);
                                        if (!speedDialItem) {
                                            showError("Clipboard does not contain a valid URL or shortcut JSON");
                                            return;
                                        }
                                        addSpeedDialItem(speedDialItem);
                                        persistSpeedDialItems();
                                        persistSpeedDialMeta();
                                        showSuccess("Shortcut created from clipboard");
                                    } catch (e) {
                                        console.warn(e);
                                        showError("Failed to paste shortcut");
                                    }
                                }
                            }
                        ]
                    },
                    {
                        id: "open",
                        label: "Open",
                        icon: "squares-four",
                        action: () => {},
                        children: [
                            { id: "open-explorer", label: "Explorer", icon: "books", action: ()=>{
                                getSpeedDialActionRegistry().get("open-view-explorer")?.({ id: "", items: speedDialItems, meta: speedDialMeta, viewMaker: getSpeedDialViewOpener() || makeView }, {});
                            } },
                            { id: "open-settings", label: "Settings", icon: "gear-six", action: ()=>{
                                getSpeedDialActionRegistry().get("open-view-settings")?.({ id: "", items: speedDialItems, meta: speedDialMeta, viewMaker: getSpeedDialViewOpener() || makeView }, {});
                            } },
                            {
                                id: "open-window-type",
                                label: "New Window",
                                icon: "app-window",
                                action: () => {},
                                children: [
                                    {
                                        id: "open-viewer-regular",
                                        label: "Viewer (regular)",
                                        icon: "article",
                                        action: () => openViewTask("viewer", { windowType: "regular" })
                                    },
                                    {
                                        id: "open-viewer-tabbed",
                                        label: "Viewer (tabbed)",
                                        icon: "rows-plus-bottom",
                                        action: () => openViewTask("viewer", { windowType: "tabbed" })
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        id: "wallpaper",
                        label: "Wallpaper",
                        icon: "image",
                        action: () => {},
                        children: [
                            { id: "change-wallpaper", label: "Change wallpaper", icon: "image", action: pickWallpaper }
                        ]
                    }
                ];

            openUnifiedContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: menuItems,
                compact: true
            });
        }, { capture: true });
    }

    return H`<div data-home-ctx-menu style="display:none;"></div>` as HTMLElement;
}
