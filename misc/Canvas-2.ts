/**
 * WHY: OrientDesktop imports `../../misc/Canvas-2` — thin re-export to fest image layer.
 */
export {
    initializeAppCanvasLayer,
    setAppWallpaper,
    syncAppWallpaperOrient,
    syncCanvasOrient,
    applyThemeFromWallpaper,
    applyWallpaperThemeSeeds,
    restoreWallpaperThemeCache,
    type CanvasLayerState,
    type WallpaperThemeSeeds,
} from "fest/image";
