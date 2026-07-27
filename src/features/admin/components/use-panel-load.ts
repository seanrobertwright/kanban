"use client";

import { useEffect } from "react";

/**
 * A settings panel's initial fetch, deferred one tick.
 *
 * Each panel mounts the moment its section is chosen, inside the Settings
 * surface's own open transition. Firing the request in the effect body puts the
 * resulting setState in the same commit as the dialog opening — a render-phase
 * update React warns about, and the reason the old admin console deferred the
 * same way. A timeout is also the seam that lets the surface finish animating
 * before the panel's first paint changes under it.
 */
export function usePanelLoad(load: () => void | Promise<unknown>) {
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
}
