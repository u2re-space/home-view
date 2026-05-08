import { loadAsAdopted, getCorrectOrientation, orientationNumberMap } from "fest/dom";
import type { GridItemType } from "fest/core";
import { bindInteraction, resolveGridCellFromClientPoint } from "./Interact";

import { openShortcutEditor } from "./ShortcutEditor";
import {
    loadDesktopRaw,
    decodeDesktopState,
    persistDesktopMain,
    persistDesktopDraft
} from "fest/lure";
import {
    compactIconSrcForStorage,
    expandIconSrcForDom,
    normalizeIconSrcFromPayload,
    hostnameToFaviconRef,
    serializeDesktopItemCompact,
    ITEM_COMPACT_KIND,
    parseDesktopItemCompact
} from "fest/lure";

// NEEDS TO REFACTOR FOR LESS DEPENDENCY FROM CROSSWORD
//import { ENABLED_VIEW_IDS, pickEnabledView } from "@frontend/shared/routing/views";
//import { requestOpenView } from "@frontend/shared/routing/view-api";

// @ts-ignore Vite inline SCSS
import speedDialViewStyles from "./SpeedDial.scss?inline";
// Registers `data-mixin="ui-orientbox"` (container-type / --orient wiring).
import "./OrientBox";
import { setAppWallpaper } from "../../misc/Canvas-2";
import {
    closeUnifiedContextMenu,
    type ContextMenuEntry,
    openUnifiedContextMenu
} from "../../../explorer-view/src/ts/ContextMenu";
import { getSpeedDialViewOpener, getHomeOverlayMountResolver } from "./view-opener";
import {
    MARKDOWN_VIEW_MANAGED_WINDOW_KEY
} from "../../../../shells/window-frame/src/views/markdown-view-window";
import { resolveOpenViewTarget } from "./action-registry";
import { navigate } from "fest/lure";

/** Orient-layer desktop shares SpeedDial styles; HomeView only adopts this sheet while home is visible, so load once here. */
let orientDesktopStyleSheet: CSSStyleSheet | null = null;
const ensureOrientDesktopStyles = (): void => {
    if (orientDesktopStyleSheet) return;
    orientDesktopStyleSheet = loadAsAdopted(speedDialViewStyles) as CSSStyleSheet;
};

type DesktopAction = "open-view" | "open-link";
export type DesktopTileShape = "square" | "circle" | "squircle";
export type ViewId = string;

type DesktopItem = {
    id: string;
    label: string;
    icon: string;
    iconSrc?: string;
    viewId: ViewId;
    cell: [number, number];
    action?: DesktopAction;
    href?: string;
    /** Visual tile shape (persisted in JSON). */
    shape?: DesktopTileShape;
};

type DesktopState = {
    columns: number;
    rows: number;
    items: DesktopItem[];
};

const SUPPRESS_CLICK_MS = 280;
const ITEM_ENVELOPE_KIND = "cw-speed-dial-item";
const REGISTRY_ENVELOPE_KIND = "cw-speed-dial-registry";
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/i;
const ACTION_OPTIONS: Array<{ value: DesktopAction; label: string }> = [
    { value: "open-view", label: "Open view" },
    { value: "open-link", label: "Open link" }
];

const normalizeTileShape = (raw: unknown): DesktopTileShape => {
    const s = String(raw || "").toLowerCase();
    if (s === "circle" || s === "square" || s === "squircle") return s;
    return "squircle";
};

/** `data-grid-shape` on launcher grids: dominant tile shape, or `mixed` if icons disagree (per-tile is still `data-shape` on `.ui-ws-item-icon`). */
const gridShapeAttributeFromItems = (items: DesktopItem[]): string => {
    if (!items.length) return "squircle";
    const distinct = new Set(items.map((it) => normalizeTileShape(it.shape)));
    if (distinct.size === 1) return normalizeTileShape(items[0].shape);
    return "mixed";
};

const DEFAULT_STATE: DesktopState = {
    columns: 4,
    rows: 8,
    items: [
        { id: "viewer", label: "Markdown", icon: "article", viewId: "viewer", cell: [0, 0], action: "open-view", shape: "squircle" },
        { id: "explorer", label: "Explorer", icon: "books", viewId: "explorer", cell: [1, 0], action: "open-view", shape: "squircle" },
        { id: "settings", label: "Settings", icon: "gear-six", viewId: "settings", cell: [2, 0], action: "open-view", shape: "squircle" },
        { id: "airpad", label: "AirPad", icon: "paper-plane-tilt", viewId: "airpad", cell: [3, 0], action: "open-view", shape: "squircle" }
    ]
};

const protectedIds = new Set(DEFAULT_STATE.items.map((item) => item.id));
const createDesktopItemId = (prefix = "item"): string => {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
};

const clampCell = (cell: [number, number], columns: number, rows: number): [number, number] => {
    return [
        Math.max(0, Math.min(columns - 1, Math.round(cell[0]))),
        Math.max(0, Math.min(rows - 1, Math.round(cell[1])))
    ];
};

const cellKey = (cell: [number, number]): string => `${cell[0]}:${cell[1]}`;

const findNearestFreeCell = (
    preferred: [number, number],
    occupied: Set<string>,
    columns: number,
    rows: number
): [number, number] => {
    const start = clampCell(preferred, columns, rows);
    if (!occupied.has(cellKey(start))) return start;
    const maxRadius = Math.max(columns, rows);
    for (let radius = 1; radius <= maxRadius; radius += 1) {
        for (let y = Math.max(0, start[1] - radius); y <= Math.min(rows - 1, start[1] + radius); y += 1) {
            for (let x = Math.max(0, start[0] - radius); x <= Math.min(columns - 1, start[0] + radius); x += 1) {
                const edge = Math.abs(x - start[0]) === radius || Math.abs(y - start[1]) === radius;
                if (!edge) continue;
                const candidate: [number, number] = [x, y];
                if (!occupied.has(cellKey(candidate))) return candidate;
            }
        }
    }
    return start;
};

const enforceUniqueCells = (items: DesktopItem[], columns: number, rows: number): DesktopItem[] => {
    const occupied = new Set<string>();
    for (const item of items) {
        const nextCell = findNearestFreeCell(item.cell, occupied, columns, rows);
        item.cell = nextCell;
        occupied.add(cellKey(nextCell));
    }
    return items;
};

const normalizeItem = (raw: any, columns: number, rows: number): DesktopItem | null => {
    const id = String(raw?.id || "").trim();
    if (!id) return null;
    if (id === "home") return null;
    const action = String(raw?.action || (raw?.href ? "open-link" : "open-view"));
    const item: DesktopItem = {
        id,
        label: String(raw?.label || "Item"),
        icon: String(raw?.icon || (action === "open-link" ? "link" : "sparkle")),
        iconSrc: normalizeIconSrcFromPayload(raw?.iconSrc, raw?.href, action),
        viewId: String(raw?.viewId || "home") as ViewId,
        cell: clampCell([Number(raw?.cell?.[0] || 0), Number(raw?.cell?.[1] || 0)], columns, rows),
        action: action === "open-link" ? "open-link" : "open-view",
        href: raw?.href ? String(raw.href) : "",
        shape: normalizeTileShape(raw?.shape)
    };
    if (item.action === "open-link") {
        item.viewId = "home";
    }
    return item;
};

const readState = (): DesktopState => {
    try {
        const raw = loadDesktopRaw();
        if (!raw) return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
        const decoded = decodeDesktopState(raw);
        if (!decoded) return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
        const columns = Math.max(4, Math.min(8, Number(decoded.columns || DEFAULT_STATE.columns)));
        const rows = Math.max(6, Math.min(12, Number(decoded.rows || DEFAULT_STATE.rows)));
        const fallbackItems = [...DEFAULT_STATE.items];
        const sourceItems = Array.isArray(decoded.items) && decoded.items.length ? decoded.items : fallbackItems;
        const items = enforceUniqueCells(sourceItems
            .map((item) => normalizeItem(item, columns, rows))
            .filter((item): item is DesktopItem => Boolean(item)), columns, rows);
        // Corrupt or legacy payloads can normalize to zero items; restore defaults instead of an empty desktop.
        const restored = items.length
            ? items
            : enforceUniqueCells(
                  fallbackItems
                      .map((entry) =>
                          normalizeItem(
                              { ...entry, cell: [entry.cell[0], entry.cell[1]] as [number, number] },
                              columns,
                              rows
                          )
                      )
                      .filter((item): item is DesktopItem => Boolean(item)),
                  columns,
                  rows
              );
        return { columns, rows, items: restored };
    } catch {
        return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
    }
};

const applyCellVars = (node: HTMLElement, cell: [number, number]): void => {
    node.style.setProperty("--cell-x", String(cell[0]));
    node.style.setProperty("--cell-y", String(cell[1]));
    node.style.setProperty("--p-cell-x", String(cell[0]));
    node.style.setProperty("--p-cell-y", String(cell[1]));
};

const readImageFileFromClipboard = (event: ClipboardEvent): File | null => {
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
        if (item.type?.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) return file;
        }
    }
    return null;
};

const pickDroppedImageFile = (event: DragEvent): File | null => {
    const files = Array.from(event.dataTransfer?.files || []);
    return files.find((file) => file.type?.startsWith("image/")) || null;
};

const readAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
        reader.readAsDataURL(file);
    });
};

const applyWallpaperFromFile = async (file: File): Promise<boolean> => {
    if (!file?.type?.startsWith("image/")) return false;
    const dataUrl = await readAsDataUrl(file);
    if (!dataUrl) return false;
    setAppWallpaper(dataUrl);
    return true;
};

const parseUrlFromText = (text: string): URL | null => {
    const value = String(text || "").trim();
    if (!value) return null;
    const direct = (() => {
        try {
            return new URL(value);
        } catch {
            return null;
        }
    })();
    if (direct && /^https?:$/i.test(direct.protocol)) return direct;
    const match = value.match(URL_PATTERN);
    if (!match?.[1]) return null;
    try {
        const parsed = new URL(match[1]);
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const parseUrlFromHtml = (html: string): URL | null => {
    const content = String(html || "").trim();
    if (!content) return null;
    try {
        const doc = new DOMParser().parseFromString(content, "text/html");
        const href = doc.querySelector("a[href]")?.getAttribute("href") || "";
        if (!href) return null;
        const parsed = new URL(href, window.location.href);
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const createLinkItem = (url: URL, cell: [number, number], labelHint = ""): DesktopItem => {
    const label = String(labelHint || "").trim() || url.hostname.replace(/^www\./, "") || "Link";
    return {
        id: createDesktopItemId("link"),
        label,
        icon: "link",
        iconSrc: hostnameToFaviconRef(url.hostname),
        viewId: "home",
        cell,
        action: "open-link",
        href: url.href,
        shape: "squircle"
    };
};

const parseUrlItemFromText = (text: string, cell: [number, number]): DesktopItem | null => {
    const parsed = parseUrlFromText(text);
    if (!parsed) return null;
    return createLinkItem(parsed, cell);
};

const normalizeImportedItems = (
    payload: unknown,
    columns: number,
    rows: number,
    preferredCell: [number, number]
): DesktopItem[] => {
    if (!payload) return [];
    const base = payload as any;
    const sourceList = Array.isArray(base?.items)
        ? base.items
        : Array.isArray(payload)
            ? payload
            : base?.item
                ? [base.item]
                : [payload];
    const normalized = sourceList
        .map((raw, index) => normalizeItem({
            ...(raw || {}),
            id: String(raw?.id || createDesktopItemId("import")),
            cell: raw?.cell ?? [preferredCell[0], preferredCell[1] + index]
        }, columns, rows))
        .filter((item): item is DesktopItem => Boolean(item));
    return normalized;
};

const parseItemsFromTextPayload = (
    textPlain: string,
    textHtml: string,
    columns: number,
    rows: number,
    preferredCell: [number, number]
): DesktopItem[] => {
    const plain = String(textPlain || "").trim();
    const html = String(textHtml || "").trim();
    if (plain.startsWith("{") || plain.startsWith("[")) {
        try {
            const parsed = JSON.parse(plain) as any;
            if (parsed?.k === ITEM_COMPACT_KIND) {
                const flat = parseDesktopItemCompact(parsed);
                if (flat?.id) {
                    return normalizeImportedItems({ items: [flat] }, columns, rows, preferredCell);
                }
            }
            if (parsed?.kind === ITEM_ENVELOPE_KIND || parsed?.kind === REGISTRY_ENVELOPE_KIND || parsed?.items || parsed?.item || Array.isArray(parsed)) {
                return normalizeImportedItems(parsed, columns, rows, preferredCell);
            }
        } catch {
            // ignore parse errors and continue with URL heuristics
        }
    }
    const htmlUrl = parseUrlFromHtml(html);
    if (htmlUrl) {
        const labelHint = (() => {
            try {
                const doc = new DOMParser().parseFromString(html, "text/html");
                const text = doc.querySelector("a[href]")?.textContent || "";
                return String(text || "").trim();
            } catch {
                return "";
            }
        })();
        return [createLinkItem(htmlUrl, preferredCell, labelHint)];
    }
    const plainItem = parseUrlItemFromText(plain, preferredCell);
    return plainItem ? [plainItem] : [];
};

const itemsForStoragePayload = (items: DesktopItem[]): DesktopItem[] =>
    items.map((it) => ({
        ...it,
        iconSrc: compactIconSrcForStorage(it.iconSrc || "", it.action, it.href)
    }));

const serializeRegistryEnvelope = (state: DesktopState): string => {
    return JSON.stringify({
        kind: REGISTRY_ENVELOPE_KIND,
        version: 1,
        columns: state.columns,
        rows: state.rows,
        items: itemsForStoragePayload(state.items)
    }, null, 2);
};

const downloadJson = (filename: string, content: string): void => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const openDesktopItem = (item: DesktopItem): void => {
    if (item.action === "open-link") {
        if (!item.href) return;
        window.open(item.href, "_blank", "noopener,noreferrer");
        return;
    }
    const target = resolveDesktopShellViewId(item.viewId, MARKDOWN_VIEW_MANAGED_WINDOW_KEY);
    const opener = getSpeedDialViewOpener();
    if (opener) {
        opener(target, { source: "home", itemId: item.id });
        return;
    }
    console.warn("[OrientDesktop] No view opener registered; using hash fallback for:", target);
    navigate(`#${target}`);
};

const prettifyView = (viewId: string): string => {
    const value = String(viewId || "").trim();
    if (!value) return "View";
    /* Canonical `viewer` id → markdown-view module (same as shell `VIEW_TITLES.viewer`). */
    if (value.toLowerCase() === MARKDOWN_VIEW_MANAGED_WINDOW_KEY) return "Markdown";
    return value.charAt(0).toUpperCase() + value.slice(1);
};

/**
 * Desktop tile `viewId` → shell `openView` id (collapses `markdown` → `viewer` per {@link MARKDOWN_VIEW_MANAGED_WINDOW_KEY}).
 */
const resolveDesktopShellViewId = (raw: string | undefined | null, fallback: string): string => {
    const t = String(raw ?? "").trim();
    if (!t) return fallback;
    return resolveOpenViewTarget(t) || fallback;
};

/** See `markdown-view-window.ts`: primary id is {@link MARKDOWN_VIEW_MANAGED_WINDOW_KEY}; label “Markdown”. */
const DESKTOP_SHELL_VIEW_OPTIONS = (
    [MARKDOWN_VIEW_MANAGED_WINDOW_KEY, "explorer", "settings", "airpad", "workcenter", "history", "editor"] as const
).map((viewId) => ({ value: viewId, label: prettifyView(viewId) }));


export const initializeOrientedDesktop = (host: HTMLElement): void => {
    if (!host || host.dataset.desktopMounted === "true") return;
    host.dataset.desktopMounted = "true";

    ensureOrientDesktopStyles();

    const state = readState();
    const itemById = new Map(state.items.map((item) => [item.id, item] as const));
    const itemIdList = state.items.map((item) => item.id);

    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    const DRAFT_DEBOUNCE_MS = 400;

    const desktopRoot = document.createElement("div");
    desktopRoot.className = "speed-dial-root app-oriented-desktop ui-orientbox";
    desktopRoot.setAttribute("data-mixin", "ui-orientbox");
    desktopRoot.style.position = "absolute";
    desktopRoot.style.inset = "0";
    desktopRoot.style.pointerEvents = "auto";
    desktopRoot.style.background = "transparent";
    desktopRoot.style.display = "grid";
    desktopRoot.tabIndex = 0;

    const syncDesktopOrient = (): void => {
        const n = orientationNumberMap?.[getCorrectOrientation()] ?? 0;
        desktopRoot.style.setProperty("--orient", String(n));
    };
    syncDesktopOrient();
    screen.orientation?.addEventListener?.("change", syncDesktopOrient);
    window.addEventListener("resize", syncDesktopOrient);


    // Two stacks: `data-grid-layer` controls z-index (see SpeedDial.scss). BEM --labels/--icons are swapped vs
    // layer on purpose — shapes live in the “labels” slot, caption text in the “icons” slot.
    const applyGridLayoutVars = (el: HTMLElement): void => {
        el.style.setProperty("--layout-c", String(state.columns));
        el.style.setProperty("--layout-r", String(state.rows));
    };

    const shapeStack = document.createElement("div");
    shapeStack.className =
        "speed-dial-grid speed-dial-grid--labels ui-launcher-grid app-oriented-desktop__grid app-oriented-desktop__grid--labels";
    shapeStack.dataset.gridLayer = "icons";
    shapeStack.setAttribute("data-grid-columns", String(state.columns));
    shapeStack.setAttribute("data-grid-rows", String(state.rows));
    applyGridLayoutVars(shapeStack);
    shapeStack.dataset.dialStack = "shapes";

    const textStack = document.createElement("div");
    textStack.className =
        "speed-dial-grid speed-dial-grid--icons ui-launcher-grid app-oriented-desktop__grid app-oriented-desktop__grid--icons";
    textStack.dataset.gridLayer = "labels";
    textStack.setAttribute("data-grid-columns", String(state.columns));
    textStack.setAttribute("data-grid-rows", String(state.rows));
    applyGridLayoutVars(textStack);
    textStack.dataset.dialStack = "text";

    desktopRoot.append(shapeStack, textStack);
    host.appendChild(desktopRoot);

    const applyGridShapeMetadata = (): void => {
        const attr = gridShapeAttributeFromItems(state.items);
        shapeStack.setAttribute("data-grid-shape", attr);
        textStack.setAttribute("data-grid-shape", attr);
    };
    applyGridShapeMetadata();

    const commitDesktop = (): void => {
        if (draftTimer !== null) {
            clearTimeout(draftTimer);
            draftTimer = null;
        }
        persistDesktopMain(state.columns, state.rows, itemsForStoragePayload(state.items));
        applyGridShapeMetadata();
    };
    const scheduleDesktopDraft = (): void => {
        if (draftTimer !== null) clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            draftTimer = null;
            persistDesktopDraft(state.columns, state.rows, itemsForStoragePayload(state.items));
        }, DRAFT_DEBOUNCE_MS);
    };

    let suppressClickUntil = 0;
    const iconNodeById = new Map<string, HTMLElement>();
    const labelNodeById = new Map<string, HTMLElement>();
    const escapeHtml = (value: string): string => String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char] || char));
    const occupiedSet = (exceptId = ""): Set<string> => {
        const occupied = new Set<string>();
        for (const entry of state.items) {
            if (exceptId && entry.id === exceptId) continue;
            occupied.add(cellKey(entry.cell));
        }
        return occupied;
    };
    const applyItemCell = (item: DesktopItem, cell: [number, number]): void => {
        item.cell = clampCell(cell, state.columns, state.rows);
        const iconNode = iconNodeById.get(item.id);
        const labelNode = labelNodeById.get(item.id);
        if (iconNode) applyCellVars(iconNode, item.cell);
        if (labelNode) applyCellVars(labelNode, item.cell);
    };
    const placeItemIntoFreeCell = (item: DesktopItem, preferred: [number, number], exceptId = ""): [number, number] => {
        const target = findNearestFreeCell(preferred, occupiedSet(exceptId), state.columns, state.rows);
        applyItemCell(item, target);
        return target;
    };
    const addItems = (items: DesktopItem[], preferredCell: [number, number]): number => {
        let added = 0;
        for (let index = 0; index < items.length; index += 1) {
            const incoming = items[index];
            if (!incoming) continue;
            const item = normalizeItem({
                ...incoming,
                id: incoming.id || createDesktopItemId("item"),
                cell: incoming.cell || [preferredCell[0], preferredCell[1] + index]
            }, state.columns, state.rows);
            if (!item || itemById.has(item.id)) continue;
            item.cell = findNearestFreeCell(item.cell, occupiedSet(), state.columns, state.rows);
            state.items.push(item);
            itemById.set(item.id, item);
            itemIdList.push(item.id);
            mountDesktopItem(item);
            added += 1;
        }
        if (added > 0) commitDesktop();
        return added;
    };
    const refreshDesktopItemNodes = (item: DesktopItem): void => {
        const iconNode = iconNodeById.get(item.id);
        const labelNode = labelNodeById.get(item.id);
        if (labelNode) {
            const span = labelNode.querySelector(".ui-ws-item-label span") as HTMLElement | null;
            if (span) span.textContent = item.label || "Item";
            applyCellVars(labelNode, item.cell);
        }
        if (iconNode) {
            const iconShape = iconNode.querySelector(".ui-ws-item-icon") as HTMLElement | null;
            if (iconShape) {
                iconShape.dataset.shape = normalizeTileShape(item.shape);
                const existingImage = iconShape.querySelector(".ui-ws-item-icon-image") as HTMLImageElement | null;
                let iconElement = iconShape.querySelector("ui-icon") as HTMLElement | null;
                const domIconSrc = expandIconSrcForDom(item.iconSrc || "");
                if (domIconSrc) {
                    iconElement?.remove();
                    if (existingImage) {
                        existingImage.src = domIconSrc;
                        existingImage.alt = item.label ? String(item.label) : "";
                    } else {
                        const image = document.createElement("img");
                        image.className = "ui-ws-item-icon-image";
                        image.alt = item.label ? String(item.label) : "";
                        image.loading = "lazy";
                        image.decoding = "async";
                        image.referrerPolicy = "no-referrer";
                        image.src = domIconSrc;
                        image.addEventListener("error", () => image.remove());
                        iconShape.insertBefore(image, iconShape.firstChild);
                    }
                } else {
                    if (existingImage) existingImage.remove();
                    if (!iconElement) {
                        iconElement = document.createElement("ui-icon");
                        iconElement.setAttribute("icon-style", "duotone");
                        iconShape.appendChild(iconElement);
                    }
                    iconElement.setAttribute("icon-style", "duotone");
                    iconElement.setAttribute("icon", item.icon || "sparkle");
                }
            }
            applyCellVars(iconNode, item.cell);
        }
    };
    const guessCellFromPoint = (x: number, y: number): [number, number] => {
        return resolveGridCellFromClientPoint(
            shapeStack,
            [x, y],
            {
                layout: { columns: state.columns, rows: state.rows },
                items: itemById,
                list: itemIdList,
                item: { id: "__menu__", cell: [0, 0] } satisfies GridItemType
            },
            "round"
        );
    };
    const importFromClipboard = async (cell: [number, number]): Promise<boolean> => {
        try {
            if (navigator.clipboard?.read) {
                const records = await navigator.clipboard.read();
                for (const record of records) {
                    if (record.types.includes("image/png") || record.types.includes("image/jpeg") || record.types.includes("image/webp")) {
                        const imageType = record.types.find((type) => type.startsWith("image/"));
                        if (!imageType) continue;
                        const blob = await record.getType(imageType);
                        const file = new File([blob], "wallpaper", { type: blob.type });
                        const applied = await applyWallpaperFromFile(file);
                        if (applied) return true;
                    }
                    const plainType = record.types.includes("text/plain") ? "text/plain" : "";
                    const htmlType = record.types.includes("text/html") ? "text/html" : "";
                    const plain = plainType ? await (await record.getType(plainType)).text() : "";
                    const html = htmlType ? await (await record.getType(htmlType)).text() : "";
                    const imported = parseItemsFromTextPayload(plain, html, state.columns, state.rows, cell);
                    if (imported.length) {
                        return addItems(imported, cell) > 0;
                    }
                }
            }
            const text = await navigator.clipboard.readText();
            const imported = parseItemsFromTextPayload(text, "", state.columns, state.rows, cell);
            return addItems(imported, cell) > 0;
        } catch {
            return false;
        }
    };

    const makeIconItem = (item: DesktopItem): HTMLElement => {
        const el = document.createElement("div");
        el.className = "ui-ws-item";
        el.dataset.desktopId = item.id;
        el.dataset.layer = "icons";
        el.setAttribute("draggable", "false");
        applyCellVars(el, item.cell);
        applyGridLayoutVars(el);
        const icon = document.createElement("div");
        icon.className = "ui-ws-item-icon shaped";
        icon.dataset.shape = normalizeTileShape(item.shape);
        const mountIconSrc = expandIconSrcForDom(item.iconSrc || "");
        if (mountIconSrc) {
            const image = document.createElement("img");
            image.className = "ui-ws-item-icon-image";
            image.alt = item.label ? String(item.label) : "";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.src = mountIconSrc;
            image.addEventListener("error", () => image.remove());
            icon.appendChild(image);
        } else {
            const iconElement = document.createElement("ui-icon");
            iconElement.setAttribute("icon-style", "duotone");
            iconElement.setAttribute("icon", item.icon || "sparkle");
            icon.appendChild(iconElement);
        }
        el.appendChild(icon);
        return el;
    };

    const makeLabelItem = (item: DesktopItem): HTMLElement => {
        const el = document.createElement("div");
        el.className = "ui-ws-item";
        el.dataset.desktopId = item.id;
        el.dataset.layer = "labels";
        el.style.pointerEvents = "none";
        el.style.background = "transparent";
        applyCellVars(el, item.cell);
        applyGridLayoutVars(el);
        el.innerHTML = `<div class="ui-ws-item-label"><span>${escapeHtml(item.label)}</span></div>`;
        return el;
    };

    const removeDesktopItem = (itemId: string): void => {
        const index = state.items.findIndex((item) => item.id === itemId);
        if (index === -1) return;
        if (desktopRoot.dataset.dialDraggingId === itemId) {
            desktopRoot.dataset.dialDraggingId = "";
        }
        state.items.splice(index, 1);
        itemById.delete(itemId);

        const listIndex = itemIdList.indexOf(itemId);
        if (listIndex >= 0) itemIdList.splice(listIndex, 1);

        iconNodeById.get(itemId)?.remove();
        labelNodeById.get(itemId)?.remove();
        iconNodeById.delete(itemId);
        labelNodeById.delete(itemId);

        enforceUniqueCells(state.items, state.columns, state.rows);
        commitDesktop();
    };

    const mountDesktopItem = (item: DesktopItem): void => {
        const iconNode = makeIconItem(item);
        const labelNode = makeLabelItem(item);
        iconNodeById.set(item.id, iconNode);
        labelNodeById.set(item.id, labelNode);
        shapeStack.appendChild(iconNode);
        textStack.appendChild(labelNode);

        const iconShape = iconNode.querySelector(".ui-ws-item-icon") as HTMLElement | null;
        if (iconShape) {
            iconShape.style.pointerEvents = "auto";
            iconShape.style.touchAction = "none";
        }

        bindInteraction(iconNode, {
            layout: [state.columns, state.rows],
            items: itemById,
            list: itemIdList,
            item,
            immediateDragStyles: true
        });

        iconNode.addEventListener("m-dragstart", () => {
            closeUnifiedContextMenu();
            desktopRoot.dataset.dialDraggingId = item.id;
            iconNode.dataset.interactionState = "onGrab";
            iconNode.dataset.gridCoordinateState = "source";
            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                // Labels stay on the source cell (no shared drag transform); sync again on m-dragsettled.
                labelNode.dataset.interactionState = "onLabelDocked";
                labelNode.dataset.gridCoordinateState = "source";
                applyCellVars(labelNode, item.cell);
                labelNode.style.setProperty("--drag-x", "0");
                labelNode.style.setProperty("--drag-y", "0");
                labelNode.style.setProperty("--cs-drag-x", "0px");
                labelNode.style.setProperty("--cs-drag-y", "0px");
            }
        });

        iconNode.addEventListener("m-dragging", () => {
            scheduleDesktopDraft();
            iconNode.dataset.interactionState = "onMoving";
            iconNode.dataset.gridCoordinateState = "intermediate";
        });

        iconNode.addEventListener("m-dragend", () => {
            suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
            iconNode.dataset.interactionState = "onRelax";
            iconNode.dataset.gridCoordinateState = "destination";
            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                labelNode.dataset.interactionState = "onLabelDocked";
                labelNode.dataset.gridCoordinateState = "source";
            }
        });

        iconNode.addEventListener("m-dragsettled", (event: Event) => {
            const settledCell = ((event as CustomEvent<{ cell?: [number, number] | null }>)?.detail?.cell || null) as [number, number] | null;
            const preferredCell: [number, number] = settledCell
                ? [settledCell[0], settledCell[1]]
                : [item.cell[0], item.cell[1]];
            const finalCell = placeItemIntoFreeCell(item, preferredCell, item.id);

            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                labelNode.dataset.interactionState = "onPlace";
                labelNode.dataset.gridCoordinateState = "destination";
                labelNode.style.setProperty("--drag-x", "0");
                labelNode.style.setProperty("--drag-y", "0");
                labelNode.style.setProperty("--cs-drag-x", "0px");
                labelNode.style.setProperty("--cs-drag-y", "0px");
                applyCellVars(labelNode, finalCell);
            }
            iconNode.dataset.interactionState = "onPlace";
            iconNode.dataset.gridCoordinateState = "destination";
            iconNode.style.setProperty("--drag-x", "0");
            iconNode.style.setProperty("--drag-y", "0");
            iconNode.style.setProperty("--cs-drag-x", "0px");
            iconNode.style.setProperty("--cs-drag-y", "0px");
            applyCellVars(iconNode, finalCell);
            commitDesktop();
            desktopRoot.dataset.dialDraggingId = "";
            setTimeout(() => {
                iconNode.dataset.interactionState = "onHover";
                iconNode.dataset.gridCoordinateState = "source";
                const nextLabelNode = labelNodeById.get(item.id);
                if (nextLabelNode) {
                    nextLabelNode.dataset.interactionState = "onHover";
                    nextLabelNode.dataset.gridCoordinateState = "source";
                }
            }, 280);
        });

        const openTarget = iconShape ?? iconNode;
        openTarget.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (performance.now() < suppressClickUntil) return;
            openDesktopItem(item);
        });
    };

    const createLinkShortcutFromClipboard = async (cell: [number, number]): Promise<boolean> => {
        return importFromClipboard(cell);
    };
    const openItemEditor = (
        item?: DesktopItem | null,
        opts?: {
            suggestedCell?: [number, number];
            seed?: Partial<{
                label: string;
                icon: string;
                action: DesktopAction;
                viewId: string;
                href: string;
                description: string;
                shape: DesktopTileShape;
            }>;
        }
    ): void => {
        const isNew = !item;
        const seed = opts?.seed || {};
        const suggestedCell = opts?.suggestedCell || [0, 0];
        const workingItem: DesktopItem = item
            ? item
            : {
                id: createDesktopItemId("item"),
                label: seed.label || "New shortcut",
                icon: seed.icon || "sparkle",
                iconSrc: "",
                viewId: resolveDesktopShellViewId(seed.viewId, MARKDOWN_VIEW_MANAGED_WINDOW_KEY),
                cell: suggestedCell,
                action: seed.action || "open-view",
                href: seed.href || "",
                shape: normalizeTileShape(seed.shape)
            };
        openShortcutEditor({
            mode: isNew ? "create" : "edit",
            registerForBackNavigation: true,
            initial: {
                label: workingItem.label || "Item",
                icon: workingItem.icon || "sparkle",
                action: workingItem.action || "open-view",
                view: workingItem.viewId || "",
                href: workingItem.href || "",
                description: String(seed.description || ""),
                shape: normalizeTileShape(workingItem.shape)
            },
            actionOptions: ACTION_OPTIONS,
            viewOptions: DESKTOP_SHELL_VIEW_OPTIONS,
            onSave: (next) => {
                const action = String(next.action || "open-view") as DesktopAction;
                const nextHref = String(next.href || "").trim();
                workingItem.label = String(next.label || "Item").trim() || "Item";
                workingItem.icon = String(next.icon || "sparkle").trim() || "sparkle";
                workingItem.action = action;
                workingItem.href = action === "open-link" ? nextHref : "";
                workingItem.viewId =
                    action === "open-link" ? "home" : resolveDesktopShellViewId(next.view, MARKDOWN_VIEW_MANAGED_WINDOW_KEY);
                workingItem.shape = normalizeTileShape(next.shape);
                if (action === "open-link" && nextHref) {
                    try {
                        const u = new URL(nextHref, window.location.href);
                        workingItem.iconSrc = /^https?:$/i.test(u.protocol) ? hostnameToFaviconRef(u.hostname) : "";
                    } catch {
                        workingItem.iconSrc = "";
                    }
                } else {
                    workingItem.iconSrc = "";
                }
                if (isNew) {
                    addItems([workingItem], suggestedCell);
                } else {
                    const existing = itemById.get(workingItem.id);
                    if (existing) {
                        Object.assign(existing, workingItem);
                        itemById.set(existing.id, existing);
                        refreshDesktopItemNodes(existing);
                        commitDesktop();
                    }
                }
            },
            onDelete: isNew
                ? undefined
                : () => {
                    removeDesktopItem(workingItem.id);
                }
        });
    };

    const openDesktopMenu = (event: MouseEvent, item: DesktopItem | null, cellHint: [number, number]): void => {
        const entries: ContextMenuEntry[] = item
            ? [
                {
                    id: "open",
                    label: "Open",
                    icon: item.action === "open-link" ? "arrow-square-out" : "play",
                    action: () => openDesktopItem(item)
                },
                {
                    id: "actions",
                    label: "Actions",
                    icon: "dots-three",
                    action: () => {},
                    children: [
                        ...(item.action === "open-link" && item.href ? [{
                            id: "copy-link",
                            label: "Copy link",
                            icon: "link",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(item.href || "");
                                } catch {
                                    // ignore
                                }
                            }
                        }, {
                            id: "open-link-new-window",
                            label: "Open link in new tab",
                            icon: "arrow-square-out",
                            action: () => {
                                if (item.href) {
                                    window.open(item.href, "_blank", "noopener,noreferrer");
                                }
                            }
                        }] : []),
                        {
                            id: "copy-item-json",
                            label: "Copy item (compact JSON)",
                            icon: "clipboard-text",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(serializeDesktopItemCompact(item));
                                } catch {
                                    // ignore
                                }
                            }
                        },
                    ]
                },
                {
                    id: "manage",
                    label: "Manage",
                    icon: "wrench",
                    action: () => {},
                    children: [
                        {
                            id: "edit",
                            label: "Edit Properties",
                            icon: "pencil-simple-line",
                            action: () => openItemEditor(item, { suggestedCell: item.cell })
                        },
                        {
                            id: "remove",
                            label: "Remove",
                            icon: "trash",
                            danger: true,
                            disabled: protectedIds.has(item.id),
                            action: () => removeDesktopItem(item.id)
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
                            action: () => openItemEditor(undefined, { suggestedCell: cellHint })
                        },
                        {
                            id: "paste-link",
                            label: "Paste shortcut",
                            icon: "clipboard",
                            action: async () => {
                                const created = await createLinkShortcutFromClipboard(cellHint);
                                if (!created) {
                                    //requestOpenView({ viewId: "explorer", target: "window", params: { source: "home" } });
                                }
                            }
                        },
                        {
                            id: "create-link-shortcut",
                            label: "Create link shortcut",
                            icon: "link",
                            action: () => {
                                openItemEditor(undefined, {
                                    suggestedCell: cellHint,
                                    seed: { action: "open-link", label: "New link", icon: "link", href: "", description: "" }
                                });
                            }
                        }
                    ]
                },
                {
                    id: "registry",
                    label: "Registry",
                    icon: "database",
                    action: () => {},
                    children: [
                        {
                            id: "copy-registry-json",
                            label: "Copy registry JSON",
                            icon: "clipboard-text",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(serializeRegistryEnvelope(state));
                                } catch {
                                    // ignore
                                }
                            }
                        },
                        {
                            id: "export-registry-json",
                            label: "Export registry",
                            icon: "download-simple",
                            action: () => {
                                const date = new Date();
                                const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                                downloadJson(`cw-home-registry-${stamp}.json`, serializeRegistryEnvelope(state));
                            }
                        },
                        {
                            id: "import-registry-json",
                            label: "Import from clipboard",
                            icon: "upload-simple",
                            action: async () => {
                                await importFromClipboard(cellHint);
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
                        {
                            id: "open-explorer",
                            label: "Explorer",
                            icon: "books",
                            action: () => /*requestOpenView({ viewId: "explorer", target: "window", params: { source: "home" } })*/{}
                        },
                        {
                            id: "open-settings",
                            label: "Settings",
                            icon: "gear-six",
                            action: () => /*requestOpenView({ viewId: "settings", target: "window", params: { source: "home" } })*/{}
                        }
                    ]
                },
                {
                    id: "wallpaper",
                    label: "Wallpaper",
                    icon: "image",
                    action: () => {},
                    children: [
                        {
                            id: "change-wallpaper",
                            label: "Choose image",
                            icon: "image",
                            action: async () => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.onchange = async () => {
                                    const file = input.files?.[0];
                                    if (!file) return;
                                    await applyWallpaperFromFile(file);
                                };
                                input.click();
                            }
                        }
                    ]
                }
            ];

        openUnifiedContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: entries,
            compact: true,
            anchor: event.target instanceof Element ? event.target : null,
            resolveOverlayMountPoint: getHomeOverlayMountResolver() ?? undefined
        });
    };

    const handlePaste = async (event: ClipboardEvent): Promise<void> => {
        const image = readImageFileFromClipboard(event);
        if (image) {
            event.preventDefault();
            event.stopPropagation();
            await applyWallpaperFromFile(image);
            return;
        }

        const plain = event.clipboardData?.getData("text/plain") || "";
        const html = event.clipboardData?.getData("text/html") || "";
        const items = parseItemsFromTextPayload(plain, html, state.columns, state.rows, [0, 0]);
        if (!items.length) return;

        event.preventDefault();
        event.stopPropagation();
        addItems(items, [0, 0]);
    };

    desktopRoot.addEventListener("pointerdown", () => desktopRoot.focus());
    desktopRoot.addEventListener("dragover", (event) => {
        event.preventDefault();
    });
    desktopRoot.addEventListener("drop", async (event) => {
        const file = pickDroppedImageFile(event);
        if (file) {
            event.preventDefault();
            event.stopPropagation();
            await applyWallpaperFromFile(file);
            return;
        }
        const plain = event.dataTransfer?.getData("text/plain") || "";
        const html = event.dataTransfer?.getData("text/html") || "";
        const uriList = event.dataTransfer?.getData("text/uri-list") || "";
        const merged = [uriList, plain].filter(Boolean).join("\n").trim();
        let items = parseItemsFromTextPayload(merged, html, state.columns, state.rows, [0, 0]);
        if (!items.length) {
            const droppedTextFile = Array.from(event.dataTransfer?.files || [])
                .find((entry) => entry.type === "text/plain" || entry.type === "text/html");
            if (droppedTextFile) {
                const payload = await droppedTextFile.text();
                items = parseItemsFromTextPayload(payload, droppedTextFile.type === "text/html" ? payload : "", state.columns, state.rows, [0, 0]);
            }
        }
        if (!items.length) return;
        event.preventDefault();
        event.stopPropagation();
        addItems(items, [0, 0]);
    });
    desktopRoot.addEventListener("paste", (event) => {
        void handlePaste(event);
    });

    desktopRoot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const target = event.target as HTMLElement | null;
        const itemNode = target?.closest?.(".ui-ws-item[data-desktop-id]") as HTMLElement | null;
        const itemId = itemNode?.dataset.desktopId || "";
        const item = itemId ? itemById.get(itemId) || null : null;
        openDesktopMenu(event, item, guessCellFromPoint(event.clientX, event.clientY));
    });

    for (const item of state.items) {
        mountDesktopItem(item);
    }
};
