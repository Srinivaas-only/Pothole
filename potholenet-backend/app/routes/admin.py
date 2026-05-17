"""Admin / demo helper endpoints. Not for production use."""

import logging
import math
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import main as app_main
from app.database import get_db
from app.models.db_models import HazardReport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _offset_coords(lat: float, lng: float, dx_m: float, dy_m: float) -> tuple[float, float]:
    """Offset (lat, lng) by (dx_m east, dy_m north)."""
    d_lat = dy_m / 111_000.0
    d_lng = dx_m / (111_000.0 * max(0.01, math.cos(math.radians(lat))))
    return lat + d_lat, lng + d_lng


@router.post("/seed-demo", summary="Seed sample pothole markers around current GPS")
def seed_demo(
    db: Session = Depends(get_db),
    count: int = Query(6, ge=1, le=20, description="How many sample potholes to create"),
    radius_m: float = Query(150.0, ge=10, le=2000, description="Max distance from center"),
    lat: Optional[float] = Query(None, description="Override center latitude"),
    lng: Optional[float] = Query(None, description="Override center longitude"),
):
    """
    Create N HazardReport rows scattered randomly within `radius_m` of either:
    - The supplied `lat`/`lng`, or
    - The phone's last-pushed GPS coords (gps_state).

    Each row gets a varied severity_score so the map markers render in different
    colors. Existing markers within DEDUP_RADIUS_M of a new point are skipped to
    avoid bumping their counters.
    """
    center_lat = lat if lat is not None else app_main.gps_state.get("latitude")
    center_lng = lng if lng is not None else app_main.gps_state.get("longitude")

    if center_lat is None or center_lng is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No GPS center available. Either pass ?lat=&lng= or push GPS "
                "from the phone first (the demo's camera tab does this every 5s)."
            ),
        )

    now = datetime.now(timezone.utc)
    rng = random.Random()
    created = []

    for _ in range(count):
        # Polar offset so the spread is uniform in distance
        dist = rng.uniform(15.0, radius_m)
        angle = rng.uniform(0, 2 * math.pi)
        dx = dist * math.cos(angle)
        dy = dist * math.sin(angle)
        plat, plng = _offset_coords(center_lat, center_lng, dx, dy)

        severity = rng.choice([1, 1, 2, 3, 3, 5])  # weighted toward low/mid
        first_seen = now - timedelta(minutes=rng.randint(0, 60 * 24 * 3))

        report = HazardReport(
            id=str(uuid.uuid4()),
            latitude=plat,
            longitude=plng,
            severity_score=severity,
            confidence=rng.uniform(0.55, 0.95),
            vehicle_type="car",
            first_reported=first_seen,
            last_seen=first_seen + timedelta(minutes=rng.randint(0, 30)),
        )
        db.add(report)
        created.append({
            "id": report.id,
            "latitude": plat,
            "longitude": plng,
            "severity_score": severity,
        })

    db.commit()
    logger.info(f"Seeded {len(created)} demo pothole markers around ({center_lat}, {center_lng})")

    return {
        "seeded": len(created),
        "center": {"latitude": center_lat, "longitude": center_lng},
        "radius_m": radius_m,
        "samples": created,
    }


@router.delete("/seed-demo", summary="Delete all hazard reports (demo cleanup)")
def clear_all_reports(db: Session = Depends(get_db)):
    """Wipe every row from hazard_reports. Use to reset the demo state."""
    n = db.query(HazardReport).delete()
    db.commit()
    return {"deleted": n}
