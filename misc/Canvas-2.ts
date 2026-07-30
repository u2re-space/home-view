/**
 * WHY: OrientDesktop imports `../../misc/Canvas-2` — thin re-export to fest image layer.
 */
export {
    initializeAppCanvasLayer,
    setAppWallpaper,
    syncAppWallpaperOrient,
    syncCanvasOrient,
    type CanvasLayerState
} from "fest/image";
