import { useState, useEffect, useRef, useCallback } from "react";
import { getHazards } from "../lib/api";
import type { HazardItem } from "../lib/api";

/**
 * Polls GET /hazards every 5 seconds using GPS coords.
 * Falls back gracefully if no GPS or backend is unreachable.
 */
export function useHazards(
  gpsCoords: { lat: number; lng: number } | null,
  enabled: boolean = true
) {
  const [hazards, setHazards] = useState<HazardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef = useRef(gpsCoords);
  coordsRef.current = gpsCoords;

  const fetchOnce = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;
    setLoading(true);
    try {
      // Wide radius so demo seeds within ~5 km still show up
      const result = await getHazards(c.lat, c.lng, 5000, 1);
      setHazards(result.hazards);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch hazards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !gpsCoords) {
      setHazards([]);
      return;
    }
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [gpsCoords?.lat, gpsCoords?.lng, enabled, fetchOnce]);

  const nearbyCount = hazards.length;

  return { hazards, nearbyCount, loading, error, refetch: fetchOnce };
}