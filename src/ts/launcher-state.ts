/**
 * Speed-dial / launcher persistence for fl.ui only (no core).
 * Storage keys match CrossWord `StateStorage` so shells sharing one origin keep one grid.
 */

import { makeObjectAssignable, observe, stringRef, safe } from "fest/object";
import { makeUIState } from "fest/lure";

export type GridCell = [number, number];

export interface SpeedDialItemMeta {
    action?: string;
    view?: string;
    href?: string;
    description?: string;
    shape?: string;
    entityType?: string;
    tags?: string[];
    [key: string]: any;
}

export interface SpeedDialPersistedItem {
    id: string;
    cell: ReturnType<typeof observe<GridCell>>;
    icon: string;
    label: string;
    action: string;
    meta?: SpeedDialItemMeta;
}

type SpeedDialRecord = Omit<SpeedDialPersistedItem, "meta">;

export interface SpeedDialItem {
    id: string;
    cell: ReturnType<typeof observe>;
    icon: ReturnType<typeof stringRef>;
    label: ReturnType<typeof stringRef>;
    action: string;
}

export const NAVIGATION_SHORTCUTS = [
    { view: "home", label: "Home", icon: "house-line" },
    { view: "task", label: "Plan", icon: "calendar-dots" },
    { view: "event", label: "Events", icon: "calendar-star" },
    { view: "bonus", label: "Bonuses", icon: "ticket" },
    { view: "person", label: "Contacts", icon: "address-book" },
    { view: "explorer", label: "Explorer", icon: "books" },
    { view: "settings", label: "Settings", icon: "gear-six" }
] as const;

const STORAGE_KEY = "cw::workspace::speed-dial";
const META_STORAGE_KEY = `${STORAGE_KEY}::meta`;

const fallbackClone = <T>(value: T): T => {
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(safe(value));
        } catch {
            /* proxies / non-cloneable */
        }
    }
    try {
        return JSON.parse(JSON.stringify(safe(value) as any)) as T;
    } catch {
        return value;
    }
};

const generateItemId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `sd-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000)}`;
};

const EXTERNAL_SHORTCUTS: SpeedDialPersistedItem[] = [
    {
        id: "shortcut-docs",
        cell: observe([0, 1]),
        icon: "book-open-text",
        label: "Docs",
        action: "open-link",
        meta: { href: "https://github.com/fest-live", description: "Project documentation" }
    },
    {
        id: "shortcut-roadmap",
        cell: observe([1, 1]),
        icon: "signpost",
        label: "Roadmap",
        action: "open-link",
        meta: { href: "https://github.com/u2re-space/unite-2.man", description: "Manifest notes" }
    },
    {
        id: "shortcut-fest-live",
        cell: observe([2, 1]),
        icon: "github-logo",
        label: "Fest Live",
        action: "open-link",
        meta: { href: "https://github.com/fest-live", description: "Fest Live Organization" }
    },
    {
        id: "shortcut-l2ne-dev",
        cell: observe([3, 1]),
        icon: "user",
        label: "L2NE Dev",
        action: "open-link",
        meta: { href: "https://github.com/L2NE-dev", description: "L2NE Developer Profile" }
    },
    {
        id: "shortcut-u2re-space",
        cell: observe([0, 2]),
        icon: "planet",
        label: "U2RE Space",
        action: "open-link",
        meta: { href: "https://github.com/u2re-space/", description: "U2RE Space Organization" }
    },
    {
        id: "shortcut-telegram",
        cell: observe([1, 2]),
        icon: "telegram-logo",
        label: "Telegram",
        action: "open-link",
        meta: { href: "https://t.me/u2re_space", description: "U2RE Space Telegram" }
    }
];

const DEFAULT_SPEED_DIAL_DATA: SpeedDialPersistedItem[] = [
    {
        id: "shortcut-explorer",
        cell: observe([2, 0]),
        icon: "books",
        label: "Explorer",
        action: "open-view",
        meta: { view: "explorer" }
    },
    {
        id: "shortcut-settings",
        cell: observe([3, 0]),
        icon: "gear-six",
        label: "Settings",
        action: "open-view",
        meta: { view: "settings" }
    },
    ...EXTERNAL_SHORTCUTS
];

const splitDefaultEntries = (entries: SpeedDialPersistedItem[]) => {
    const records: SpeedDialRecord[] = [];
    const metaEntries: Array<[string, SpeedDialItemMeta]> = [];
    entries.forEach((entry) => {
        const { meta, ...record } = entry;
        records.push(record as SpeedDialRecord);
        const normalizedMeta: SpeedDialItemMeta = { action: entry.action, ...(meta || {}) };
        metaEntries.push([entry.id, normalizedMeta]);
    });
    return { records, metaEntries };
};

const { records: DEFAULT_SPEED_DIAL_RECORDS, metaEntries: DEFAULT_META_ENTRIES } = splitDefaultEntries(DEFAULT_SPEED_DIAL_DATA);
const legacyMetaBuffer: Array<[string, SpeedDialItemMeta]> = [];

const ensureCell = (cell?: ReturnType<typeof observe<GridCell>>): ReturnType<typeof observe<GridCell>> => {
    if (cell && Array.isArray(cell) && cell.length >= 2) {
        return observe([Number(cell[0]) || 0, Number(cell[1]) || 0]);
    }
    return observe([0, 0]);
};

const createMetaState = (meta: SpeedDialItemMeta = {}) => {
    return makeObjectAssignable(observe({
        action: meta.action || "open-view",
        view: meta.view || "",
        href: meta.href || "",
        description: meta.description || "",
        entityType: meta.entityType || "",
        tags: Array.isArray(meta.tags) ? [...meta.tags] : [],
        ...meta
    }));
};

export type SpeedDialMetaEntry = ReturnType<typeof createMetaState>;
export type SpeedDialMetaRegistry = Map<string, SpeedDialMetaEntry>;

const registryFromEntries = (entries: Iterable<[string, SpeedDialItemMeta]>) => {
    const registry = new Map<string, SpeedDialMetaEntry>();
    for (const [id, meta] of entries) {
        registry.set(id, createMetaState(meta));
    }
    return registry as SpeedDialMetaRegistry;
};

const normalizeMetaEntries = (raw?: any): Array<[string, SpeedDialItemMeta]> => {
    if (!raw) return [];
    if (raw instanceof Map) {
        return Array.from(raw.entries());
    }
    if (Array.isArray(raw)) {
        return raw
            .map((entry: any) => {
                if (entry && typeof entry === "object" && "id" in entry) {
                    return [entry.id, (entry.meta || entry) as SpeedDialItemMeta] as [string, SpeedDialItemMeta];
                }
                return null;
            })
            .filter(Boolean) as Array<[string, SpeedDialItemMeta]>;
    }
    if (typeof raw === "object") {
        return Object.entries(raw as Record<string, SpeedDialItemMeta>) as Array<[string, SpeedDialItemMeta]>;
    }
    return [];
};

const packMetaRegistry = (registry: SpeedDialMetaRegistry) => {
    const payload: Record<string, SpeedDialItemMeta> = {};
    registry?.forEach((meta, id) => {
        payload[id] = fallbackClone(meta ?? {});
    });
    return payload;
};

const createInitialMetaRegistry = () => registryFromEntries(DEFAULT_META_ENTRIES);
const unpackMetaRegistry = (raw?: any) => {
    const entries = normalizeMetaEntries(raw);
    return registryFromEntries(entries.length ? entries : DEFAULT_META_ENTRIES);
};

const unwrapRef = (value: any, fallback?: string) => {
    if (value && typeof value === "object" && "value" in value) {
        return value.value ?? fallback;
    }
    return value ?? fallback;
};

const serializeItemState = (item: SpeedDialItem): SpeedDialRecord => {
    return {
        id: item.id,
        cell: observe([item.cell?.[0] ?? 0, item.cell?.[1] ?? 0]),
        icon: unwrapRef(item.icon, "sparkle"),
        label: unwrapRef(item.label, "Shortcut"),
        action: item.action
    };
};

const createStatefulItem = (config: SpeedDialRecord): SpeedDialItem => {
    return observe({
        id: config.id || generateItemId(),
        cell: observe(ensureCell(config.cell)),
        icon: stringRef(config.icon || "sparkle"),
        label: stringRef(config.label || "Shortcut"),
        action: config.action || "open-view"
    }) as any;
};

const createInitialState = () => observe(DEFAULT_SPEED_DIAL_RECORDS.map(createStatefulItem));
const unpackState = (raw?: SpeedDialPersistedItem[]) => {
    const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_SPEED_DIAL_DATA;
    const records = source.map((entry) => {
        const { meta, ...record } = entry;
        if (meta) {
            legacyMetaBuffer.push([entry.id, { action: entry.action, ...meta }]);
        } else {
            legacyMetaBuffer.push([entry.id, { action: entry.action }]);
        }
        return record as SpeedDialRecord;
    });
    return observe(records.map(createStatefulItem));
};
const packState = (collection: SpeedDialItem[]) => collection.map(serializeItemState);

export const speedDialMeta = makeUIState(META_STORAGE_KEY, createInitialMetaRegistry, unpackMetaRegistry, packMetaRegistry) as unknown as SpeedDialMetaRegistry;
export const speedDialItems = makeUIState(STORAGE_KEY, createInitialState, unpackState, packState) as unknown as SpeedDialItem[];
export const persistSpeedDialItems = () => (speedDialItems as any)?.$save?.();
export const persistSpeedDialMeta = () => (speedDialMeta as any)?.$save?.();

export const getSpeedDialMeta = (id?: string | null) => {
    if (!id) return null;
    return speedDialMeta?.get?.(id) ?? null;
};

export const ensureSpeedDialMeta = (id: string, defaults: SpeedDialItemMeta = {}) => {
    let meta = speedDialMeta?.get?.(id);
    if (!meta) {
        meta = createMetaState(defaults);
        speedDialMeta?.set?.(id, meta);
        persistSpeedDialMeta();
    }
    if (defaults?.action && meta.action !== defaults.action) {
        meta.action = defaults.action;
    }
    return meta;
};

export const removeSpeedDialMeta = (id: string) => {
    const removed = speedDialMeta?.delete?.(id);
    if (removed) {
        persistSpeedDialMeta();
    }
    return removed;
};

const syncMetaActionFromItem = (item?: SpeedDialItem | null) => {
    if (!item) return false;
    const desiredAction = item.action || "open-view";
    const meta = ensureSpeedDialMeta(item.id, { action: desiredAction });
    if (meta.action !== desiredAction) {
        meta.action = desiredAction;
        return true;
    }
    return false;
};

const syncMetaActionsForAllItems = () => {
    let changed = false;
    speedDialItems?.forEach?.((item) => {
        if (syncMetaActionFromItem(item)) {
            changed = true;
        }
    });
    if (changed) {
        persistSpeedDialMeta();
    }
};

const flushLegacyMetaBuffer = () => {
    if (!legacyMetaBuffer.length) return;
    legacyMetaBuffer.forEach(([id, meta]) => {
        const target = ensureSpeedDialMeta(id, meta);
        Object.assign(target, meta);
    });
    legacyMetaBuffer.length = 0;
    persistSpeedDialMeta();
};

flushLegacyMetaBuffer();
syncMetaActionsForAllItems();

const ensureExternalShortcuts = () => {
    let changed = false;
    EXTERNAL_SHORTCUTS.forEach((shortcut) => {
        const exists = speedDialItems?.find?.((item) => item?.id === shortcut.id);
        if (!exists) {
            const item = createStatefulItem(shortcut);
            if (shortcut.label && item.label && typeof item.label === "object" && "value" in item.label) {
                item.label.value = shortcut.label;
            }
            if (shortcut.icon && item.icon && typeof item.icon === "object" && "value" in item.icon) {
                item.icon.value = shortcut.icon;
            }

            speedDialItems.push(observe(item) as any);
            ensureSpeedDialMeta(item.id, shortcut.meta);
            changed = true;
        } else {
            const currentMeta = getSpeedDialMeta(shortcut.id);
            if (shortcut.meta && currentMeta) {
                const nextHref = String(shortcut.meta.href ?? "");
                if (nextHref !== String(currentMeta.href ?? "")) {
                    currentMeta.href = nextHref;
                    changed = true;
                }
                const nextDesc = String(shortcut.meta.description ?? "");
                if (nextDesc !== String(currentMeta.description ?? "")) {
                    currentMeta.description = nextDesc;
                    changed = true;
                }
            } else if (shortcut.meta && !currentMeta) {
                ensureSpeedDialMeta(shortcut.id, shortcut.meta);
                changed = true;
            }
        }
    });
    if (changed) {
        persistSpeedDialItems();
        persistSpeedDialMeta();
    }
};
ensureExternalShortcuts();

export const findSpeedDialItem = (id?: string | null) => {
    if (!id) return null;
    return speedDialItems?.find?.((item) => item?.id === id) || null;
};

export const createEmptySpeedDialItem = (
    cell: ReturnType<typeof observe<GridCell>> = observe([0, 0]) as ReturnType<typeof observe<GridCell>>
): SpeedDialItem => {
    const item = createStatefulItem({
        id: generateItemId(),
        cell,
        icon: "sparkle",
        label: "New shortcut",
        action: "open-link"
    });
    ensureSpeedDialMeta(item.id, { action: item.action, href: "", description: "" });
    return item;
};

export const addSpeedDialItem = (item: SpeedDialItem) => {
    speedDialItems?.push?.(observe(item) as any);
    const metaChanged = syncMetaActionFromItem(item);
    persistSpeedDialItems();
    if (metaChanged) {
        persistSpeedDialMeta();
    }
    return item;
};

export const upsertSpeedDialItem = (item: SpeedDialItem) => {
    const existingIndex = speedDialItems?.findIndex?.((entry) => entry?.id === item?.id) ?? -1;
    if (existingIndex === -1) {
        speedDialItems?.push?.(observe(item) as any);
    } else if (speedDialItems[existingIndex] !== item) {
        speedDialItems.splice(existingIndex, 1, observe(item) as any);
    }
    const metaChanged = syncMetaActionFromItem(item);
    persistSpeedDialItems();
    if (metaChanged) {
        persistSpeedDialMeta();
    }
    return item;
};

export const removeSpeedDialItem = (id: string) => {
    const index = speedDialItems?.findIndex?.((entry) => entry?.id === id) ?? -1;
    if (index === -1) return false;
    speedDialItems.splice(index, 1);
    removeSpeedDialMeta(id);
    persistSpeedDialItems();
    return true;
};

export const snapshotSpeedDialItem = (item: SpeedDialItem) => {
    const meta = getSpeedDialMeta(item.id);
    const resolvedAction = meta?.action || item.action;
    const metaSnapshot = fallbackClone((meta ?? {}) as SpeedDialItemMeta) as SpeedDialItemMeta;
    if (!metaSnapshot.action) {
        metaSnapshot.action = resolvedAction;
    }
    return {
        state: {
            id: item.id,
            cell: observe([item.cell?.[0] ?? 0, item.cell?.[1] ?? 0]),
            icon: unwrapRef(item.icon, ""),
            label: unwrapRef(item.label, "")
        },
        desc: {
            action: resolvedAction,
            meta: metaSnapshot
        }
    };
};

const WALLPAPER_KEY = "cw::workspace::wallpaper";
export const wallpaperState = makeUIState(WALLPAPER_KEY, () => observe({
    src: "/assets/wallpaper.jpg",
    opacity: 1,
    blur: 0
}), (raw) => observe(raw || {
    src: "/assets/wallpaper.jpg",
    opacity: 1,
    blur: 0
}), (state) => ({ ...state })) as unknown as { src: string; opacity: number; blur: number };

export const persistWallpaper = () => (wallpaperState as any)?.$save?.();

export type GridShape = "square" | "squircle" | "circle" | "rounded" | "hexagon" | "diamond";

export interface GridLayoutSettings {
    columns: number;
    rows: number;
    shape: GridShape;
}

const GRID_LAYOUT_KEY = "cw::workspace::grid-layout";
export const gridLayoutState = makeUIState(GRID_LAYOUT_KEY, () => observe({
    columns: 4,
    rows: 8,
    shape: "square" as GridShape
}), (raw) => observe(raw || {
    columns: 4,
    rows: 8,
    shape: "square" as GridShape
}), (state) => ({ ...state })) as unknown as GridLayoutSettings;

export const persistGridLayout = () => (gridLayoutState as any)?.$save?.();

export const applyGridSettings = (settings?: { grid?: GridLayoutSettings }) => {
    const gridConfig = settings?.grid || gridLayoutState;
    const columns = gridConfig?.columns ?? 4;
    const rows = gridConfig?.rows ?? 8;
    const shape = gridConfig?.shape ?? "square";

    if (gridLayoutState) {
        gridLayoutState.columns = columns;
        gridLayoutState.rows = rows;
        gridLayoutState.shape = shape;
        persistGridLayout();
    }

    if (typeof document === "undefined") {
        return;
    }

    document.querySelectorAll(".speed-dial-grid").forEach((grid) => {
        const el = grid as HTMLElement;
        el.dataset.gridColumns = String(columns);
        el.dataset.gridRows = String(rows);
        el.dataset.gridShape = shape;
    });

    document.documentElement.dataset.gridColumns = String(columns);
    document.documentElement.dataset.gridRows = String(rows);
    document.documentElement.dataset.gridShape = shape;
};

if (typeof globalThis !== "undefined" && typeof document !== "undefined") {
    const run = () => applyGridSettings();
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
    } else {
        queueMicrotask(run);
    }
}

export const parseSpeedDialItemFromJSON = (jsonText: string, suggestedCell?: GridCell): SpeedDialItem | null => {
    try {
        const parsed = JSON.parse(jsonText) as any;
        if (!parsed || typeof parsed !== "object") return null;

        const state = parsed.state || parsed;
        const desc = parsed.desc || parsed.meta || {};

        if (!state || typeof state !== "object") return null;

        const cellValue = state.cell && Array.isArray(state.cell) && state.cell.length >= 2
            ? [Number(state.cell[0]) || 0, Number(state.cell[1]) || 0] as GridCell
            : (suggestedCell || [0, 0] as GridCell);

        const item = createStatefulItem({
            id: state.id || generateItemId(),
            cell: cellValue,
            icon: state.icon || desc.icon || "sparkle",
            label: state.label || desc.label || "Shortcut",
            action: desc.action || state.action || "open-view"
        });

        const meta: SpeedDialItemMeta = {
            action: desc.action || state.action || "open-view",
            ...(desc.meta || desc || {}),
            ...(state.meta || {})
        };

        if (meta.href) {
            meta.action = meta.action || "open-link";
        } else if (meta.view) {
            meta.action = meta.action || "open-view";
        }

        ensureSpeedDialMeta(item.id, meta);
        return item;
    } catch (e) {
        console.warn("Failed to parse JSON for speed dial item:", e);
        return null;
    }
};

export const parseSpeedDialItemFromURL = (urlText: string, suggestedCell?: GridCell): SpeedDialItem | null => {
    try {
        const trimmed = urlText.trim();
        if (!trimmed) return null;

        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            try {
                url = new URL(trimmed, globalThis?.location?.href);
            } catch {
                return null;
            }
        }

        const hostname = url.hostname || "";
        const domain = hostname.replace(/^www\./, "");
        const pathname = url.pathname || "";
        const label = domain || url.host || "Link";

        const item = createStatefulItem({
            id: generateItemId(),
            cell: suggestedCell || [0, 0],
            icon: "link",
            label,
            action: "open-link"
        });

        const meta: SpeedDialItemMeta = {
            action: "open-link",
            href: url.href,
            description: `${label}${pathname ? ` - ${pathname}` : ""}`
        };

        ensureSpeedDialMeta(item.id, meta);
        return item;
    } catch (e) {
        console.warn("Failed to parse URL for speed dial item:", e);
        return null;
    }
};

const readClipboardTextBrowser = async (): Promise<{ ok: boolean; data?: string; error?: string }> => {
    try {
        if (!navigator.clipboard?.readText) {
            return { ok: false, error: "clipboard.readText unavailable" };
        }
        const data = await navigator.clipboard.readText();
        return { ok: true, data: String(data ?? "") };
    } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
    }
};

export const createSpeedDialItemFromClipboard = async (suggestedCell?: GridCell): Promise<SpeedDialItem | null> => {
    try {
        const clipboardResult = await readClipboardTextBrowser();
        if (!clipboardResult.ok || !clipboardResult.data) {
            console.warn("Failed to read clipboard text:", clipboardResult.error);
            return null;
        }

        const clipboardText = String(clipboardResult.data);
        if (!clipboardText.trim()) return null;

        const trimmed = clipboardText.trim();

        const isURL = /^https?:\/\/[^\s]+$/i.test(trimmed) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(trimmed);

        if (isURL && typeof URL !== "undefined" && URL.canParse(trimmed, globalThis?.location?.origin)) {
            return parseSpeedDialItemFromURL(trimmed, suggestedCell);
        }

        const isJSON = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
        if (isJSON) {
            const parsed = parseSpeedDialItemFromJSON(trimmed, suggestedCell);
            if (parsed) return parsed;
        }

        return null;
    } catch (e) {
        console.warn("Failed to create speed dial item from clipboard:", e);
        return null;
    }
};
