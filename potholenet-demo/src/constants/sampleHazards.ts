import type { HazardItem } from "../lib/api";

// Pure UI sample data — drawn on the map when there are no real hazards.
// Centered near KL city centre; tweak coordinates if you want a different scene.
const NOW = Date.now();
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

export const SAMPLE_CENTER: [number, number] = [3.139, 101.6869];

export const SAMPLE_HAZARDS: HazardItem[] = [
  {
    report_id: "sample-1",
    latitude: 3.1395,
    longitude: 101.6875,
    severity_score: 5,
    distance_m: 78,
    last_seen: ago(8),
  },
  {
    report_id: "sample-2",
    latitude: 3.1387,
    longitude: 101.6863,
    severity_score: 3,
    distance_m: 65,
    last_seen: ago(34),
  },
  {
    report_id: "sample-3",
    latitude: 3.1402,
    longitude: 101.6861,
    severity_score: 1,
    distance_m: 145,
    last_seen: ago(120),
  },
  {
    report_id: "sample-4",
    latitude: 3.1378,
    longitude: 101.6881,
    severity_score: 4,
    distance_m: 195,
    last_seen: ago(56),
  },
  {
    report_id: "sample-5",
    latitude: 3.1408,
    longitude: 101.6878,
    severity_score: 2,
    distance_m: 240,
    last_seen: ago(220),
  },
  {
    report_id: "sample-6",
    latitude: 3.1385,
    longitude: 101.6852,
    severity_score: 5,
    distance_m: 215,
    last_seen: ago(15),
  },
  {
    report_id: "sample-7",
    latitude: 3.1397,
    longitude: 101.6892,
    severity_score: 2,
    distance_m: 280,
    last_seen: ago(180),
  },
  {
    report_id: "sample-8",
    latitude: 3.1372,
    longitude: 101.6869,
    severity_score: 3,
    distance_m: 305,
    last_seen: ago(95),
  },
];
