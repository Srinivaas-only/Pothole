import { useEffect, useState } from "react";

/**
 * Live phone orientation as "portrait" | "landscape". Uses the
 * `(orientation: portrait)` media query, which works on iOS Safari, Android
 * Chrome, and desktop browsers (where it follows window aspect ratio).
 */
export function useOrientation(): "portrait" | "landscape" {
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(orientation: portrait)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    // Sync once in case the value changed between SSR and mount
    setIsPortrait(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isPortrait ? "portrait" : "landscape";
}
