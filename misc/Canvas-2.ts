/**
 * WHY: OrientDesktop imports `../../misc/Canvas-2` — thin re-export to fest image layer.
 */
export {
    initializeAppCanvasLayer,
    setAppWallpaper,
    setAppWallpaperFromBlob,
    resolveAppWallpaperUrl,
    getWallpaperStoragePointer,
    WALLPAPER_IDB_MARKER,
    syncAppWallpaperOrient,
    syncCanvasOrient,
    applyThemeFromWallpaper,
    applyWallpaperThemeSeeds,
    restoreWallpaperThemeCache,
    type CanvasLayerState,
    type WallpaperThemeSeeds,
} from "fest/image";
