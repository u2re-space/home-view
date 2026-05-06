/**
 * Grid/tile interaction helpers for the home/orient workspace.
 *
 * This module centralizes draggable tile behavior, CSS custom-property based
 * animation state, and cell reflection logic so the home view can keep its
 * layout deterministic across HMR, resize, and drag/drop interactions.
 */
import { RAFBehavior, orientOf, setStyleProperty, resolveGridCellFromClientPoint } from "fest/dom";
import { makeObjectAssignable, observe, affected, numberRef } from "fest/object";
import { makeShiftTrigger, LongPressHandler, clampCell, bindDraggable } from "fest/lure";
import { redirectCell } from "fest/core";
import type { GridArgsType, GridItemType } from "fest/core";

export { resolveGridCellFromClientPoint };

// Register CSS custom properties for WAAPI interpolation.
// Tracked per-property to survive HMR without duplicate-registration errors.
const registeredCSSProperties = new Set<string>();
([
    { name: "--drag-x", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--drag-y", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cs-drag-x", syntax: "<length-percentage>", inherits: false, initialValue: "0px" },
    { name: "--cs-drag-y", syntax: "<length-percentage>", inherits: false, initialValue: "0px" },
    { name: "--grid-r", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--grid-c", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--resize-x", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--resize-y", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--shift-x", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--shift-y", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cs-grid-r", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cs-grid-c", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cs-transition-r", syntax: "<length-percentage>", inherits: false, initialValue: "0px" },
    { name: "--cs-transition-c", syntax: "<length-percentage>", inherits: false, initialValue: "0px" },
    { name: "--cs-p-grid-r", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cs-p-grid-c", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--os-grid-r", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--os-grid-c", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--rv-grid-r", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--rv-grid-c", syntax: "<number>", inherits: false, initialValue: "0" },
    { name: "--cell-x", syntax: "<integer>", inherits: false, initialValue: "0" },
    { name: "--cell-y", syntax: "<integer>", inherits: false, initialValue: "0" },
] as PropertyDefinition[]).forEach((prop) => {
    if (typeof CSS !== "undefined" && !registeredCSSProperties.has(prop.name)) {
        try { CSS.registerProperty?.(prop); registeredCSSProperties.add(prop.name); } catch {}
    }
});

// --rv-grid-c always drives --cs-transition-c → X axis of translate3d.
// --rv-grid-r always drives --cs-transition-r → Y axis of translate3d.
// The --cs-* variables are ALREADY orient-aware (CSS custom functions handle the transform).
// NO axis swapping by orientation — that was the root bug.
const depAxis = (axis: "x" | "y"): "c" | "r" => axis === "x" ? "c" : "r";

/** WAAPI keyframes for one axis of the settle animation. */
export const animationSequence = (dragCoord = 0, axis: "x" | "y" = "x") => {
    const drag = "--drag-" + axis;
    const csDrag = "--cs-drag-" + axis;
    const k = depAxis(axis);
    return [
        { [`--rv-grid-${k}`]: `var(--cs-p-grid-${k})`, [drag]: dragCoord, [csDrag]: `${dragCoord}px` },
        { [`--rv-grid-${k}`]: `var(--cs-grid-${k})`, [drag]: 0, [csDrag]: "0px" }
    ];
};

/** Run the single-axis settle animation used after a drag interaction finishes. */
export const doAnimate = async (
    newItem: HTMLElement,
    axis: "x" | "y" = "x",
    animate = false,
    signal?: AbortSignal
): Promise<Animation | null> => {
    const dragCoord = parseFloat(newItem?.style?.getPropertyValue?.("--drag-" + axis) || "0") || 0;
    if (!animate) { await new Promise(r => requestAnimationFrame(r)); return null; }

    const duration = 240;
    const prefersReduced = matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const animation = !prefersReduced
        ? newItem.animate(animationSequence(dragCoord, axis), {
            fill: "forwards",
            duration,
            easing: "cubic-bezier(0.22, 0.8, 0.3, 1)"
        })
        : null;

    let shifted = false;
    const onInterrupt: [EventListener, AddEventListenerOptions] = [() => {
        if (!shifted) { shifted = true; animation?.finish?.(); }
        newItem?.removeEventListener?.("m-dragstart", ...onInterrupt);
        signal?.removeEventListener?.("abort", ...onInterrupt);
    }, { once: true }];

    signal?.addEventListener?.("abort", ...onInterrupt);
    newItem?.addEventListener?.("m-dragstart", ...onInterrupt);
    await animation?.finished?.catch?.(console.warn.bind(console));
    return animation;
};

/** Apply redirected grid coordinates back onto the element's style-driven layout state. */
export const reflectCell = async (newItem: HTMLElement, pArgs: GridArgsType, _withAnimate = false): Promise<void> => {
    const layout: [number, number] = [
        (pArgs?.layout as any)?.columns || pArgs?.layout?.[0] || 4,
        (pArgs?.layout as any)?.rows || pArgs?.layout?.[1] || 8
    ];
    const { item, list, items } = pArgs;
    await new Promise(r => queueMicrotask(() => r(true)));
    return affected?.(item, (_state, property) => {
        const gridSystem = newItem?.parentElement;
        layout[0] = parseInt(gridSystem?.getAttribute?.("data-grid-columns") || "4") || layout[0];
        layout[1] = parseInt(gridSystem?.getAttribute?.("data-grid-rows") || "8") || layout[1];
        const args = { item, list, items, layout, size: [gridSystem?.clientWidth, gridSystem?.clientHeight] };
        if (item && !item?.cell) { item.cell = makeObjectAssignable(observe([0, 0])); }
        if (property === "cell") {
            const nc = redirectCell(item?.cell || [0, 0], args as GridArgsType);
            if (nc[0] !== item?.cell?.[0] && item?.cell) { item.cell[0] = nc?.[0]; }
            if (nc[1] !== item?.cell?.[1] && item?.cell) { item.cell[1] = nc?.[1]; }
            setStyleProperty(newItem, "--p-cell-x", nc?.[0]);
            setStyleProperty(newItem, "--p-cell-y", nc?.[1]);
            setStyleProperty(newItem, "--cell-x", nc?.[0]);
            setStyleProperty(newItem, "--cell-y", nc?.[1]);
        }
    });
};

type InteractionState = "onHover" | "onGrab" | "onMoving" | "onRelax" | "onPlace";
type CoordinateState = "source" | "intermediate" | "destination";

export const makeDragEvents = async (
    newItem: HTMLElement,
    { layout, dragging, currentCell, syncDragStyles }: {
        layout: [number, number],
        dragging: [any, any],
        currentCell: [any, any],
        syncDragStyles: (flush: boolean) => void
    },
    { item, items, list }: {
        item: GridItemType,
        items: Map<string, GridItemType> | Set<GridItemType> | GridItemType[],
        list: Set<string> | string[]
    }
) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const setState = (state: InteractionState, coord: CoordinateState): void => {
        newItem.dataset.interactionState = state;
        newItem.dataset.gridCoordinateState = coord;
    };
    const clearSettleTimer = (): void => {
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    };

    setState("onHover", "source");

    const refreshLayout = (): [number, number] => {
        const grid = newItem?.parentElement as HTMLElement | null;
        if (!grid) return layout;
        layout[0] = parseInt(grid.getAttribute?.("data-grid-columns") as string || "4") || layout[0];
        layout[1] = parseInt(grid.getAttribute?.("data-grid-rows") as string || "8") || layout[1];
        return layout;
    };

    const computeDropCell = (): [number, number] | null => {
        const grid = newItem?.parentElement as HTMLElement | null;
        if (!grid) return null;
        const snap = [...refreshLayout()] as [number, number];
        const args = { layout: { columns: snap[0], rows: snap[1] }, item, list, items };

        const gridRect = grid.getBoundingClientRect();
        const itemRect = newItem.getBoundingClientRect();
        const cx = (itemRect.left + itemRect.right) / 2;
        const cy = (itemRect.top + itemRect.bottom) / 2;
        if (cx < gridRect.left || cx > gridRect.right || cy < gridRect.top || cy > gridRect.bottom) return null;
        return resolveGridCellFromClientPoint(grid, [cx, cy], args, "floor");
    };

    const setCellAxis = (cell: [number, number], axis: 0 | 1): void => {
        if (currentCell?.[axis]?.value !== cell[axis]) {
            try { currentCell[axis].value = cell[axis]; } catch {}
        }
    };

    const commitCell = (cell: [number, number]): void => {
        const args = {
            item, items, list, layout,
            size: [newItem?.clientWidth || 0, newItem?.clientHeight || 0] as [number, number]
        };
        const redirected = redirectCell(cell, args as GridArgsType);
        const clamped = clampCell(redirected, layout as [number, number]);
        const final: [number, number] = [clamped.x.value, clamped.y.value];
        setCellAxis(final, 0);
        setCellAxis(final, 1);
    };

    const resetDragRefs = (): void => {
        try { dragging[0].value = 0; } catch {}
        try { dragging[1].value = 0; } catch {}
    };

    // ── Drag Start ──
    const onGrab = (dragRefs: [any, any]): [number, number] => {
        clearSettleTimer();

        // Anchor to current cell (prevents grab-teleport).
        const stableCell: [number, number] = [
            currentCell?.[0]?.value ?? item?.cell?.[0] ?? 0,
            currentCell?.[1]?.value ?? item?.cell?.[1] ?? 0
        ];
        setStyleProperty(newItem, "--p-cell-x", stableCell[0]);
        setStyleProperty(newItem, "--p-cell-y", stableCell[1]);
        setStyleProperty(newItem, "--cell-x", stableCell[0]);
        setStyleProperty(newItem, "--cell-y", stableCell[1]);

        // Enable [data-dragging] CSS rules for --cs-transition-c/r computation.
        newItem.setAttribute("data-dragging", "");

        // Zero out drag offset.
        if (dragRefs && Array.isArray(dragRefs)) {
            try { dragRefs[0].value = 0; dragRefs[1].value = 0; } catch {}
        }
        setStyleProperty(newItem, "--drag-settle-ms", "0ms");
        syncDragStyles?.(true);
        setState("onGrab", "source");
        return [0, 0];
    };

    // ── Drag End ──
    // `_dragRefs` is the same refs array as outer `dragging` (passed through bindDraggable).
    const onDrop = (_dragRefs: any): [number, number] => {
        clearSettleTimer();

        // 1. Compute destination cell synchronously.
        const cell = computeDropCell();

        requestAnimationFrame(async () => {
            // 2. Anchor --p-cell to where item WAS (animation start point).
            setStyleProperty(newItem, "--p-cell-x", currentCell?.[0]?.value ?? item?.cell?.[0] ?? 0);
            setStyleProperty(newItem, "--p-cell-y", currentCell?.[1]?.value ?? item?.cell?.[1] ?? 0);

            // 3. Snap --cell to destination (triggers CSS --cs-grid-c/r update).
            if (cell) {
                setStyleProperty(newItem, "--cell-x", cell[0]);
                setStyleProperty(newItem, "--cell-y", cell[1]);
            }

            // Calculate exact cell size to prevent animation overshoot due to grid padding
            const grid = newItem.parentElement;
            if (grid) {
                const cs = getComputedStyle(grid);
                const pl = parseFloat(cs.paddingLeft) || 0;
                const pr = parseFloat(cs.paddingRight) || 0;
                const pt = parseFloat(cs.paddingTop) || 0;
                const pb = parseFloat(cs.paddingBottom) || 0;
                const contentW = Math.max(1, grid.clientWidth - pl - pr);
                const contentH = Math.max(1, grid.clientHeight - pt - pb);
                
                const csLayoutC = parseFloat(cs.getPropertyValue("--cs-layout-c")) || 4;
                const csLayoutR = parseFloat(cs.getPropertyValue("--cs-layout-r")) || 8;
                
                setStyleProperty(newItem, "--cs-sw-unit-x", `${contentW / csLayoutC}px`);
                setStyleProperty(newItem, "--cs-sw-unit-y", `${contentH / csLayoutR}px`);
            }

            // Sync drag offset vars before animation reads them.
            syncDragStyles?.(true);
            setStyleProperty(newItem, "--drag-settle-ms", "240ms");
            setStyleProperty(newItem, "will-change", "transform");
            setState("onRelax", "destination");

            // Allow CSS [data-dragging] to compute --cs-transition-c/r from rv-grid vs cs-grid diff.
            newItem.style.removeProperty("--cs-transition-c");
            newItem.style.removeProperty("--cs-transition-r");

            // 4. Single combined settle animation: both axes in one WAAPI call.
            //    --rv-grid-c/r: old cell → new cell (drives --cs-transition-c/r → 0).
            //    --drag-x/y: accumulated offset → 0 (removes pointer tracking offset).
            const dragX = parseFloat(newItem.style.getPropertyValue("--drag-x") || "0") || 0;
            const dragY = parseFloat(newItem.style.getPropertyValue("--drag-y") || "0") || 0;
            const prefersReduced = matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            const shouldAnimate = !prefersReduced && (Math.abs(dragX) > 0.5 || Math.abs(dragY) > 0.5 || cell != null);

            let animation: Animation | null = null;
            if (shouldAnimate) {
                // Force style recalc so --cs-grid-c/r and --cs-p-grid-c/r reflect the
                // --cell-x/y and --p-cell-x/y we just set. Use concrete numbers instead
                // of var() in WAAPI keyframes — var() on registered properties can resolve
                // to stale values when styles haven't been flushed yet.
                const computed = getComputedStyle(newItem);
                const csPGridC = parseFloat(computed.getPropertyValue("--cs-p-grid-c")) || 0;
                const csPGridR = parseFloat(computed.getPropertyValue("--cs-p-grid-r")) || 0;
                const csGridC = parseFloat(computed.getPropertyValue("--cs-grid-c")) || 0;
                const csGridR = parseFloat(computed.getPropertyValue("--cs-grid-r")) || 0;

                animation = newItem.animate([
                    {
                        "--rv-grid-c": csPGridC,
                        "--rv-grid-r": csPGridR,
                        "--drag-x": dragX,
                        "--drag-y": dragY,
                        "--cs-drag-x": `${dragX}px`,
                        "--cs-drag-y": `${dragY}px`
                    },
                    {
                        "--rv-grid-c": csGridC,
                        "--rv-grid-r": csGridR,
                        "--drag-x": 0,
                        "--drag-y": 0,
                        "--cs-drag-x": "0px",
                        "--cs-drag-y": "0px"
                    }
                ], {
                    fill: "forwards",
                    duration: 240,
                    easing: "cubic-bezier(0.22, 0.8, 0.3, 1)"
                });

                // If a new drag starts mid-animation, finish instantly.
                const onInterrupt = () => animation?.finish?.();
                newItem.addEventListener("m-dragstart", onInterrupt, { once: true });
                await animation.finished.catch(console.warn.bind(console));
                newItem.removeEventListener("m-dragstart", onInterrupt);
            }

            // 5. Commit: align underlying values to match animation end state, then cancel.
            requestAnimationFrame(() => {
                setStyleProperty(newItem, "will-change", "auto");

                // Reset drag offset refs and sync to CSS.
                resetDragRefs();
                syncDragStyles?.(true);

                // Commit cell so --p-cell matches --cell (no residual transition offset).
                if (cell) {
                    commitCell(cell);
                    setStyleProperty(newItem, "--p-cell-x", cell[0]);
                    setStyleProperty(newItem, "--p-cell-y", cell[1]);
                    setStyleProperty(newItem, "--cell-x", cell[0]);
                    setStyleProperty(newItem, "--cell-y", cell[1]);
                }

                // Cancel forward-filled animation (underlying values now match target → no flash).
                animation?.cancel?.();
                newItem.removeAttribute("data-dragging");

                setState("onPlace", "destination");
                settleTimer = setTimeout(() => {
                    setState("onHover", "source");
                    settleTimer = null;
                }, 280);

                newItem.dispatchEvent(new CustomEvent("m-dragsettled", {
                    bubbles: true,
                    detail: {
                        cell: cell ? [cell[0], cell[1]] : null,
                        interactionState: "onPlace",
                        coordinateState: "destination"
                    }
                }));
            });
        });

        return [0, 0];
    };

    const customTrigger = (doGrab: (ev: MouseEvent, el: HTMLElement) => void): LongPressHandler =>
        new LongPressHandler(newItem, {
            handler: "*",
            anyPointer: true,
            mouseImmediate: true,
            minHoldTime: 60 * 3600,
            maxHoldTime: 100
        }, makeShiftTrigger((ev) => { onGrab(dragging); doGrab?.(ev, newItem); }));

    return bindDraggable(customTrigger, onDrop, dragging);
};

// ── Public entry point ──
export const ROOT = typeof document !== "undefined" ? document?.documentElement : null;

export const bindInteraction = (newItem: HTMLElement, pArgs: any): [any, any] => {
    reflectCell(newItem, pArgs, true);

    const { item, items, list } = pArgs;
    const layout = [
        pArgs?.layout?.columns || pArgs?.layout?.[0] || 4,
        pArgs?.layout?.rows || pArgs?.layout?.[1] || 8
    ];
    const immediateDragStyles = Boolean(pArgs?.immediateDragStyles);
    const dragging: [any, any] = [numberRef(0, RAFBehavior()), numberRef(0, RAFBehavior())];
    const currentCell: [any, any] = [numberRef(item?.cell?.[0] || 0), numberRef(item?.cell?.[1] || 0)];

    setStyleProperty(newItem, "--cell-x", currentCell?.[0]?.value || 0);
    setStyleProperty(newItem, "--cell-y", currentCell?.[1]?.value || 0);

    const applyDragStyles = (): void => {
        const dx = dragging?.[0]?.value || 0;
        const dy = dragging?.[1]?.value || 0;
        setStyleProperty(newItem, "--drag-x", dx);
        setStyleProperty(newItem, "--cs-drag-x", `${dx}px`);
        setStyleProperty(newItem, "--drag-y", dy);
        setStyleProperty(newItem, "--cs-drag-y", `${dy}px`);
    };

    let pendingRaf: number | null = null;
    const syncDragStyles = (flush = false): void => {
        if (immediateDragStyles || flush) {
            applyDragStyles();
            if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = null; }
        } else if (!pendingRaf) {
            pendingRaf = requestAnimationFrame(() => {
                applyDragStyles();
                pendingRaf = null;
            });
        }
    };

    // React to drag offset changes → sync CSS vars.
    affected([dragging[0], "value"], (_, prop) => { if (prop === "value") syncDragStyles(); });
    affected([dragging[1], "value"], (_, prop) => { if (prop === "value") syncDragStyles(); });

    // Track "moving" state.
    const checkMoving = (): void => {
        if (Math.abs(dragging[0]?.value || 0) > 0.5 || Math.abs(dragging[1]?.value || 0) > 0.5) {
            newItem.dataset.interactionState = "onMoving";
            newItem.dataset.gridCoordinateState = "intermediate";
        }
    };
    affected([dragging[0], "value"], (_, prop) => { if (prop === "value") checkMoving(); });
    affected([dragging[1], "value"], (_, prop) => { if (prop === "value") checkMoving(); });
    syncDragStyles(true);

    // Sync reactive cell to CSS and model.
    affected([currentCell[0], "value"], (val, prop) => {
        if (prop === "value" && item.cell != null && val != null) {
            setStyleProperty(newItem, "--cell-x", (item.cell[0] = val) || 0);
        }
    });
    affected([currentCell[1], "value"], (val, prop) => {
        if (prop === "value" && item.cell != null && val != null) {
            setStyleProperty(newItem, "--cell-y", (item.cell[1] = val) || 0);
        }
    });

    // Prevent stale settle offsets from bleeding into the next drag.
    if (!newItem.dataset.dragResetBound) {
        newItem.dataset.dragResetBound = "1";
        newItem.addEventListener("m-dragstart", () => {
            setStyleProperty(newItem, "--drag-settle-ms", "0ms");
            newItem.style.removeProperty("--cs-transition-c");
            newItem.style.removeProperty("--cs-transition-r");
        });
    }

    makeDragEvents(newItem, { layout: layout as [number, number], currentCell, dragging, syncDragStyles }, { item, items, list });
    return currentCell as [any, any];
};
