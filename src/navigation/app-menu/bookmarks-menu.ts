/*
 * Filename: bookmarks-menu.ts
 * FullPath: modules/projects/fl.ui/src/ui/navigation/app-menu/bookmarks-menu.ts
 * Reason for changes: CRX Start / App Menu — Chrome bookmarks provider + favicon probe.
 */
import {
    addSpeedDialItem,
    findNextFreeSpeedDialCell,
    parseSpeedDialItemFromJSON,
    type GridCell,
    type SpeedDialItem
} from "fl-ui/speed-dial/launcher-state";

/** Local copy — avoid relative `../../explorer/fs-backend` (breaks when this file is hardlinked under home-view). */
function faviconForHref(href: string, size = 64): string {
    const raw = String(href || "").trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return "";
    try {
        const host = new URL(raw).hostname;
        if (!host) return "";
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
    } catch {
        return "";
    }
}

export type BookmarkMenuEntry = {
    id: string;
    title: string;
    url?: string;
    folder?: boolean;
    parentId?: string;
};

export type BookmarksMenuApi = {
    listChildren: (folderId?: string) => Promise<BookmarkMenuEntry[]>;
    search: (query: string) => Promise<BookmarkMenuEntry[]>;
    open: (entry: BookmarkMenuEntry) => Promise<void>;
    /** Prefer extension `_favicon` / large S2 when available. */
    resolveIconUrl?: (href: string, size?: number) => string;
};

const RECENT_KEY = "rs-app-menu-bookmark-recent";
const PINNED_KEY = "rs-app-menu-bookmark-pinned";
const MAX_RECENT = 12;
const MAX_PINNED = 16;

let registeredBookmarksApi: BookmarksMenuApi | null = null;

export function setBookmarksMenuApi(api: BookmarksMenuApi | null): void {
    registeredBookmarksApi = api;
}

export function getRegisteredBookmarksMenuApi(): BookmarksMenuApi | null {
    return registeredBookmarksApi;
}

type ChromeBookmarksLike = {
    getTree: (...args: unknown[]) => unknown;
    getChildren: (...args: unknown[]) => unknown;
    search: (...args: unknown[]) => unknown;
};

type ChromeBookmarkNode = {
    id: string;
    title?: string;
    url?: string;
    parentId?: string;
    children?: ChromeBookmarkNode[];
};

const chromeErr = (): Error | null => {
    try {
        const err = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome
            ?.runtime?.lastError;
        return err ? new Error(String(err.message || err)) : null;
    } catch {
        return null;
    }
};

const callChrome = <T>(api: ChromeBookmarksLike, method: keyof ChromeBookmarksLike, ...args: unknown[]): Promise<T> => {
    const fn = api[method] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof fn !== "function") {
        return Promise.reject(new Error(`chrome.bookmarks.${String(method)} missing`));
    }
    try {
        const result = fn.apply(api, args);
        if (result != null && typeof (result as Promise<T>).then === "function") {
            return result as Promise<T>;
        }
    } catch (e) {
        return Promise.reject(e);
    }
    return new Promise<T>((resolve, reject) => {
        try {
            (fn as (...a: unknown[]) => void).apply(api, [
                ...args,
                (res: T) => {
                    const err = chromeErr();
                    if (err) reject(err);
                    else resolve(res);
                }
            ]);
        } catch (e) {
            reject(e);
        }
    });
};

const nodeToEntry = (node: ChromeBookmarkNode): BookmarkMenuEntry => {
    const url = typeof node.url === "string" && node.url ? node.url : undefined;
    return {
        id: String(node.id),
        title: String(node.title || node.url || node.id || "Bookmark"),
        url,
        folder: !url,
        parentId: node.parentId
    };
};

/** Build BookmarksMenuApi from `chrome.bookmarks` (CRX extension pages). */
export function createChromeBookmarksMenuApi(
    raw?: ChromeBookmarksLike | null
): BookmarksMenuApi | null {
    const api =
        raw ||
        ((globalThis as { chrome?: { bookmarks?: ChromeBookmarksLike } }).chrome?.bookmarks ?? null);
    if (!api?.getTree || !api?.getChildren) return null;

    const resolveIconUrl = (href: string, size = 128): string => {
        const page = String(href || "").trim();
        if (!/^https?:\/\//i.test(page)) return "";
        try {
            const chromeRt = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome
                ?.runtime;
            if (typeof chromeRt?.getURL === "function") {
                const u = new URL(chromeRt.getURL("/_favicon/"));
                u.searchParams.set("pageUrl", page);
                u.searchParams.set("size", String(size));
                return u.toString();
            }
        } catch {
            /* fall through */
        }
        try {
            const host = new URL(page).hostname;
            if (!host) return "";
            return faviconForHref(page, size);
        } catch {
            return faviconForHref(page, size);
        }
    };

    return {
        resolveIconUrl,
        async listChildren(folderId?: string): Promise<BookmarkMenuEntry[]> {
            if (folderId) {
                const kids = await callChrome<ChromeBookmarkNode[]>(api, "getChildren", folderId);
                return (kids || []).map(nodeToEntry);
            }
            const tree = await callChrome<ChromeBookmarkNode[]>(api, "getTree");
            const roots = tree || [];
            const out: BookmarkMenuEntry[] = [];
            for (const root of roots) {
                for (const child of root.children || []) {
                    out.push(nodeToEntry(child));
                }
            }
            return out;
        },
        async search(query: string): Promise<BookmarkMenuEntry[]> {
            const q = String(query || "").trim();
            if (!q) return this.listChildren();
            if (typeof api.search !== "function") {
                const all = await this.listChildren();
                const lower = q.toLowerCase();
                return all.filter(
                    (e) =>
                        e.title.toLowerCase().includes(lower) ||
                        String(e.url || "")
                            .toLowerCase()
                            .includes(lower)
                );
            }
            const hits = await callChrome<ChromeBookmarkNode[]>(api, "search", q);
            return (hits || []).map(nodeToEntry);
        },
        async open(entry: BookmarkMenuEntry): Promise<void> {
            if (entry.folder) return;
            const href = String(entry.url || "").trim();
            if (!href) return;
            try {
                const tabs = (globalThis as { chrome?: { tabs?: { create?: (o: { url: string }) => unknown } } })
                    .chrome?.tabs;
                if (typeof tabs?.create === "function") {
                    await Promise.resolve(tabs.create({ url: href }));
                    return;
                }
            } catch {
                /* fall through */
            }
            globalThis.open?.(href, "_blank", "noopener,noreferrer");
        }
    };
}

export function resolveBookmarksMenuApi(): BookmarksMenuApi | null {
    if (registeredBookmarksApi) return registeredBookmarksApi;
    return createChromeBookmarksMenuApi();
}

export function hasBookmarksMenuApi(): boolean {
    return Boolean(resolveBookmarksMenuApi());
}

export function readRecentBookmarks(): BookmarkMenuEntry[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as BookmarkMenuEntry[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e) => e && e.id && e.title).slice(0, MAX_RECENT);
    } catch {
        return [];
    }
}

export function pushRecentBookmark(entry: BookmarkMenuEntry): void {
    if (!entry?.id || entry.folder) return;
    const next = [entry, ...readRecentBookmarks().filter((e) => e.id !== entry.id)].slice(0, MAX_RECENT);
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        /* ignore quota */
    }
}

const readBookmarkList = (key: string, max: number): BookmarkMenuEntry[] => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as BookmarkMenuEntry[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e) => e && e.id && e.title && !e.folder).slice(0, max);
    } catch {
        return [];
    }
};

export function readPinnedBookmarks(): BookmarkMenuEntry[] {
    return readBookmarkList(PINNED_KEY, MAX_PINNED);
}

export function isBookmarkPinnedToStart(id: string): boolean {
    return readPinnedBookmarks().some((e) => e.id === id);
}

export function pinBookmarkToStart(entry: BookmarkMenuEntry): boolean {
    if (!entry?.id || entry.folder || !String(entry.url || "").trim()) return false;
    const next = [entry, ...readPinnedBookmarks().filter((e) => e.id !== entry.id)].slice(0, MAX_PINNED);
    try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
        return true;
    } catch {
        return false;
    }
}

export function unpinBookmarkFromStart(id: string): boolean {
    const key = String(id || "").trim();
    if (!key) return false;
    const next = readPinnedBookmarks().filter((e) => e.id !== key);
    try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
        return true;
    } catch {
        return false;
    }
}

const DESKTOP_FAVICON_SIZE = 256;

/** Bump `_favicon` / S2 query size so desktop tiles are not upscaled from 16–32px assets. */
export function bumpBookmarkIconUrlSize(raw: string, size = DESKTOP_FAVICON_SIZE): string {
    const url = String(raw || "").trim();
    if (!url) return "";
    try {
        const parsed = new URL(url, globalThis.location?.href);
        if (parsed.searchParams.has("pageUrl")) {
            parsed.searchParams.set("size", String(size));
            return parsed.toString();
        }
        if (parsed.hostname.endsWith("google.com") && parsed.pathname.includes("favicon")) {
            parsed.searchParams.set("sz", String(size));
            return parsed.toString();
        }
    } catch {
        /* ignore malformed stored URL */
    }
    return url;
}

const unwrapMetaField = (raw: unknown): string => {
    if (raw && typeof raw === "object" && "value" in (raw as { value?: unknown })) {
        return String((raw as { value?: unknown }).value ?? "").trim();
    }
    return String(raw ?? "").trim();
};

export function isSpeedDialBookmarkItem(input: {
    entityType?: unknown;
    bookmarkId?: unknown;
}): boolean {
    const entityType = unwrapMetaField(input.entityType).toLowerCase();
    const bookmarkId = unwrapMetaField(input.bookmarkId);
    return entityType === "bookmark" || Boolean(bookmarkId);
}

/** Resolve bookmark bitmap URL for Speed Dial tiles (always prefer largest available). */
export function resolveSpeedDialBookmarkIconUrl(input: {
    iconUrl?: unknown;
    href?: unknown;
    entityType?: unknown;
    bookmarkId?: unknown;
}): string {
    if (!isSpeedDialBookmarkItem(input)) return "";

    const stored = unwrapMetaField(input.iconUrl);
    const href = unwrapMetaField(input.href);

    if (href && /^https?:\/\//i.test(href)) {
        const fresh = resolveBookmarkDesktopIconUrl({ id: "", title: "", url: href }, resolveBookmarksMenuApi());
        if (fresh) return fresh;
    }

    if (stored) return bumpBookmarkIconUrlSize(stored, DESKTOP_FAVICON_SIZE);

    if (href && /^https?:\/\//i.test(href)) {
        return faviconForHref(href, DESKTOP_FAVICON_SIZE);
    }
    return "";
}

/** Best favicon URL for Speed Dial tiles (prefer larger; fall back to S2). */
export function resolveBookmarkDesktopIconUrl(
    entry: BookmarkMenuEntry,
    api?: BookmarksMenuApi | null
): string {
    const href = String(entry.url || "").trim();
    if (!href) return "";
    return (
        api?.resolveIconUrl?.(href, DESKTOP_FAVICON_SIZE) ||
        api?.resolveIconUrl?.(href, 128) ||
        faviconForHref(href, DESKTOP_FAVICON_SIZE) ||
        faviconForHref(href, 128) ||
        faviconForHref(href, 64) ||
        ""
    );
}

/** Place bookmark on Speed Dial — same open-link tile path as Android launcher pins. */
export function placeBookmarkOnDesktop(
    entry: BookmarkMenuEntry,
    cell?: GridCell,
    api?: BookmarksMenuApi | null,
    iconUrl = ""
): SpeedDialItem | null {
    const paint =
        String(iconUrl || "").trim() ||
        bumpBookmarkIconUrlSize(resolveBookmarkDesktopIconUrl(entry, api), DESKTOP_FAVICON_SIZE);
    return pinBookmarkEntry(entry, cell, paint);
}

/** JSON drag envelope for Bookmarks AppMenu → SpeedDial. */
export function buildBookmarkPinEnvelope(entry: BookmarkMenuEntry, iconUrl = ""): string {
    const href = String(entry.url || "").trim();
    return JSON.stringify({
        state: {
            icon: entry.folder ? "folder" : "link",
            label: entry.title || href || "Bookmark",
            action: entry.folder ? "open-path" : "open-link"
        },
        desc: {
            action: entry.folder ? "open-path" : "open-link",
            href: entry.folder ? "" : href,
            path: entry.folder ? `/bookmarks/${entry.id}/` : `/bookmarks/${entry.id}`,
            meta: {
                entityType: "bookmark",
                bookmarkId: entry.id,
                ...(iconUrl ? { iconUrl } : {})
            }
        }
    });
}

export function pinBookmarkEntry(
    entry: BookmarkMenuEntry,
    cell?: GridCell,
    iconUrl = ""
): SpeedDialItem | null {
    if (entry.folder || !String(entry.url || "").trim()) return null;
    const targetCell = cell ?? findNextFreeSpeedDialCell();
    const item = parseSpeedDialItemFromJSON(buildBookmarkPinEnvelope(entry, iconUrl), targetCell);
    if (!item) return null;
    addSpeedDialItem(item);
    return item;
}

const appendPhosphorGlyph = (plate: HTMLElement, name: string): void => {
    const icon = document.createElement("ui-icon");
    icon.setAttribute("icon", name);
    icon.setAttribute("icon-style", "duotone");
    icon.setAttribute("aria-hidden", "true");
    icon.style.setProperty("--icon-size", "1.75rem");
    icon.style.setProperty("--icon-padding", "0px");
    icon.style.setProperty("--icon-color", "currentColor");
    icon.style.color = "currentColor";
    plate.append(icon);
    void customElements.whenDefined("ui-icon").then(() => {
        if (!icon.isConnected) return;
        if (!icon.getAttribute("icon")) icon.setAttribute("icon", name);
        icon.style.setProperty("--icon-size", "1.75rem");
        icon.style.setProperty("--icon-padding", "0px");
    });
};

/**
 * Paint bookmark tile icon.
 * WHY: list UI uses plain `<img>` (not ui-icon mask). Size probes used to clear the
 * plate and reject typical 16–32px favicons (≥48px gate), leaving empty slots.
 */
export async function applyBookmarkIconToPlate(
    plate: HTMLElement,
    entry: BookmarkMenuEntry,
    api?: BookmarksMenuApi | null
): Promise<string> {
    plate.replaceChildren();
    if (entry.folder) {
        appendPhosphorGlyph(plate, "folder");
        plate.toggleAttribute("data-bookmark-bitmap", false);
        return "";
    }

    const href = String(entry.url || "").trim();
    const candidates: string[] = [];
    const fromApi256 = api?.resolveIconUrl?.(href, DESKTOP_FAVICON_SIZE) || "";
    if (fromApi256) candidates.push(fromApi256);
    const fromApi128 = api?.resolveIconUrl?.(href, 128) || "";
    if (fromApi128 && !candidates.includes(fromApi128)) candidates.push(fromApi128);
    const fromApi64 = api?.resolveIconUrl?.(href, 64) || "";
    if (fromApi64 && !candidates.includes(fromApi64)) candidates.push(fromApi64);
    const s2 = faviconForHref(href, DESKTOP_FAVICON_SIZE);
    if (s2 && !candidates.includes(s2)) candidates.push(s2);
    const s2128 = faviconForHref(href, 128);
    if (s2128 && !candidates.includes(s2128)) candidates.push(s2128);
    const s264 = faviconForHref(href, 64);
    if (s264 && !candidates.includes(s264)) candidates.push(s264);

    /* Sync placeholder so the row is never blank while favicons load. */
    appendPhosphorGlyph(plate, "link");
    plate.toggleAttribute("data-bookmark-bitmap", false);

    if (!candidates.length) return "";

    return await new Promise<string>((resolve) => {
        let index = 0;
        const tryNext = (): void => {
            if (index >= candidates.length) {
                resolve("");
                return;
            }
            const url = candidates[index++]!;
            const img = document.createElement("img");
            img.className = "env-shell-app-menu__tile-favicon";
            img.alt = "";
            img.decoding = "async";
            img.loading = "eager";
            img.referrerPolicy = "no-referrer";
            img.draggable = false;
            img.addEventListener(
                "load",
                () => {
                    plate.replaceChildren(img);
                    plate.toggleAttribute("data-bookmark-bitmap", true);
                    resolve(url);
                },
                { once: true }
            );
            img.addEventListener(
                "error",
                () => {
                    tryNext();
                },
                { once: true }
            );
            img.src = url;
        };
        tryNext();
    });
}
