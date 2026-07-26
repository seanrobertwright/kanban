"use client";

import { useEffect, useState } from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "kanban:density";

/**
 * The row/card density setting, applied as `data-density` on the document root
 * and remembered per browser.
 *
 * On the root rather than on a wrapper element because half the surfaces this
 * has to reach — every dialog, every dropdown — render through a portal, and a
 * portal's DOM parent is <body>, not the component that opened it. A wrapper
 * would style the board and quietly miss the task panel.
 *
 * Read in an effect rather than during render: the value lives in localStorage,
 * which the server does not have, so consulting it while rendering would make
 * the first client paint disagree with the markup that was sent.
 */
export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "compact" || stored === "comfortable") setDensity(stored);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  return [
    density,
    (next: Density) => {
      setDensity(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // A browser refusing storage (private mode, a full quota) should cost
        // the setting's persistence, not the click that set it.
      }
    },
  ];
}
