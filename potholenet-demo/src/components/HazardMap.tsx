import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { HazardItem } from "../lib/api";

const DEFAULT_CENTER: [number, number] = [3.139, 101.6869]; // KL fallback
const DEFAULT_ZOOM = 16;

function severityColor(score: number): string {
  if (score >= 5) return "#ef4444";
  if (score >= 3) return "#f59e0b";
  return "#22d3ee";
}

function potholeIcon(score: number): L.DivIcon {
  const color = severityColor(score);
  return L.divIcon({
    className: "pothole-marker",
    html: `
      <div style="
        width: 26px; height: 26px; border-radius: 50%;
        background: ${color}; border: 3px solid #0a0a0a;
        box-shadow: 0 0 0 2px ${color}, 0 4px 10px rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
        color: #0a0a0a; font-weight: 700; font-size: 12px;
        font-family: system-ui, -apple-system, sans-serif;
      ">${score}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

const userIcon: L.DivIcon = L.divIcon({
  className: "user-marker",
  html: `
    <div style="
      width: 18px; height: 18px; border-radius: 50%;
      background: #22d3ee; border: 3px solid #fff;
      box-shadow: 0 0 0 2px #22d3ee44, 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export function HazardMap({
  gpsCoords, hazards, initialCenter,
}: {
  gpsCoords: { lat: number; lng: number } | null;
  hazards: HazardItem[];
  initialCenter?: [number, number] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const hazardLayerRef = useRef<L.LayerGroup | null>(null);
  const hasRecentredRef = useRef(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initial: [number, number] = gpsCoords
      ? [gpsCoords.lat, gpsCoords.lng]
      : (initialCenter ?? DEFAULT_CENTER);

    const map = L.map(containerRef.current, {
      center: initial,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    hazardLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      hazardLayerRef.current = null;
      userMarkerRef.current = null;
      hasRecentredRef.current = false;
    };
  }, []);

  // Track user position; recenter on first fix only (don't fight user panning)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gpsCoords) return;
    const ll: [number, number] = [gpsCoords.lat, gpsCoords.lng];

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker(ll, { icon: userIcon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup("You are here");
    } else {
      userMarkerRef.current.setLatLng(ll);
    }

    if (!hasRecentredRef.current) {
      map.setView(ll, DEFAULT_ZOOM);
      hasRecentredRef.current = true;
    }
  }, [gpsCoords?.lat, gpsCoords?.lng]);

  // Redraw hazards whenever the list changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = hazardLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const h of hazards) {
      const marker = L.marker([h.latitude, h.longitude], {
        icon: potholeIcon(h.severity_score),
      }).bindPopup(`
        <div style="font-family: system-ui; font-size: 13px; min-width: 160px;">
          <div style="font-weight: 700; color: #ef4444; margin-bottom: 4px;">
            ⚠ Pothole
          </div>
          <div>Severity: <b>${h.severity_score}</b></div>
          <div>Distance: <b>${Math.round(h.distance_m)} m</b></div>
          <div>Last seen: ${new Date(h.last_seen).toLocaleString()}</div>
        </div>
      `);
      marker.addTo(layer);
    }
  }, [hazards]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 280,
        borderRadius: 12,
        overflow: "hidden",
        background: "#111",
      }}
    />
  );
}
