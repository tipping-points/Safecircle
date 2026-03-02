"""
2D Kalman Filter for GPS/network location smoothing.

Nokia NaC returns network-based locations with ±1000m accuracy that
jump between cell towers. The Kalman filter fuses successive readings
and converges toward the true position, dramatically reducing noise.

Theory:
  - State: [lat, lon] — our best estimate of the real position
  - Measurement: Nokia reported [lat, lon] with uncertainty R
  - Process noise Q: how much we expect the device to move between readings
  - Kalman gain K: weight between prediction and new measurement

Usage:
  f = LocationKalmanFilter()
  smooth_lat, smooth_lon = f.update(raw_lat, raw_lon, accuracy_meters=1000)
"""

import math
import logging

logger = logging.getLogger(__name__)


class KalmanFilter1D:
    """1-dimensional Kalman filter for a single coordinate."""

    def __init__(self, process_noise: float = 1e-5, measurement_noise: float = 1.0):
        # Q: process noise — how fast can the device move (in degrees²/step)
        # At walking speed (~1.4 m/s, ~1.3e-5 deg/s) → Q ≈ 1e-8 per second
        self.q = process_noise
        # R: measurement noise covariance (in degrees²)
        self.r = measurement_noise
        # P: estimation error covariance
        self.p = 1.0
        # x: current state estimate (None until first measurement)
        self.x: float | None = None

    def update(self, measurement: float, measurement_variance: float | None = None) -> float:
        """Feed a new measurement, return smoothed estimate."""
        if measurement_variance is not None:
            self.r = measurement_variance

        # Bootstrap: first reading is accepted as truth
        if self.x is None:
            self.x = measurement
            return self.x

        # --- Predict step ---
        # State doesn't change (constant position model)
        # but uncertainty grows with process noise
        self.p = self.p + self.q

        # --- Update step ---
        k = self.p / (self.p + self.r)          # Kalman gain (0=ignore measurement, 1=trust it)
        self.x = self.x + k * (measurement - self.x)  # fuse prediction + measurement
        self.p = (1.0 - k) * self.p              # reduce uncertainty

        return self.x

    def reset(self) -> None:
        self.x = None
        self.p = 1.0


class LocationKalmanFilter:
    """
    2D location smoother using independent 1D Kalman filters for lat and lon.

    Process noise tuned for a slow-moving person (walking speed).
    Measurement noise is derived from Nokia's reported accuracy radius.
    """

    # Walking speed ≈ 1.4 m/s → in degrees ≈ 1.26e-5 deg/s
    # Polling every 10s → max displacement ≈ 1.26e-4 deg
    # Q = displacement² ≈ 1.6e-8 (conservative — device may be stationary)
    _PROCESS_NOISE = 1.6e-8

    def __init__(self):
        self._lat = KalmanFilter1D(process_noise=self._PROCESS_NOISE)
        self._lon = KalmanFilter1D(process_noise=self._PROCESS_NOISE)
        self._reading_count = 0

    def update(
        self,
        lat: float,
        lon: float,
        accuracy_meters: float = 1000.0,
    ) -> tuple[float, float, float]:
        """
        Smooth a raw Nokia location reading.

        Args:
            lat, lon: raw coordinates from Nokia NaC
            accuracy_meters: Nokia's reported accuracy radius (default 1000m)

        Returns:
            (smooth_lat, smooth_lon, confidence_0_to_1)
            confidence grows as more readings are accumulated (max ~0.95 after 20 readings)
        """
        # Convert accuracy from metres to degrees² for measurement variance
        # 1 degree ≈ 111,000 m  →  accuracy_deg = accuracy_m / 111_000
        accuracy_deg = accuracy_meters / 111_000.0
        variance = accuracy_deg ** 2

        smooth_lat = self._lat.update(lat, variance)
        smooth_lon = self._lon.update(lon, variance)

        self._reading_count += 1
        # Confidence: sigmoid-like curve, reaches ~0.90 after 15 readings
        confidence = 1.0 - math.exp(-self._reading_count / 8.0)
        confidence = round(min(confidence, 0.97), 3)

        logger.debug(
            f"Kalman update #{self._reading_count}: "
            f"raw=({lat:.5f},{lon:.5f}) → smooth=({smooth_lat:.5f},{smooth_lon:.5f}) "
            f"conf={confidence:.2f}"
        )
        return smooth_lat, smooth_lon, confidence

    def reset(self) -> None:
        self._lat.reset()
        self._lon.reset()
        self._reading_count = 0

    @property
    def is_initialized(self) -> bool:
        return self._reading_count > 0

    @property
    def reading_count(self) -> int:
        return self._reading_count


# ── Per-phone filter registry ──────────────────────────────────────────────────
# Each phone number keeps its own filter state so estimates don't cross-contaminate
_filters: dict[str, LocationKalmanFilter] = {}


def get_filter(phone_number: str) -> LocationKalmanFilter:
    """Return (or create) the Kalman filter for a given phone number."""
    if phone_number not in _filters:
        _filters[phone_number] = LocationKalmanFilter()
        logger.info(f"Kalman filter created for {phone_number}")
    return _filters[phone_number]


def smooth_location(
    phone_number: str,
    lat: float,
    lon: float,
    accuracy_meters: float = 1000.0,
) -> dict:
    """
    High-level helper: feed a raw Nokia reading and return smoothed result.

    Returns a dict with:
      - latitude, longitude: Kalman-smoothed coordinates
      - raw_latitude, raw_longitude: original Nokia values
      - accuracy_meters: original accuracy
      - smoothed_accuracy_meters: estimated accuracy after smoothing
      - kalman_confidence: 0–1, grows with number of readings
      - kalman_readings: total readings fed to the filter
    """
    kf = get_filter(phone_number)
    smooth_lat, smooth_lon, confidence = kf.update(lat, lon, accuracy_meters)

    # Smoothed accuracy estimate: original accuracy shrinks as confidence grows
    smoothed_accuracy = max(50, round(accuracy_meters * (1.0 - confidence * 0.85)))

    return {
        "latitude":              round(smooth_lat, 7),
        "longitude":             round(smooth_lon, 7),
        "raw_latitude":          round(lat, 7),
        "raw_longitude":         round(lon, 7),
        "accuracy_meters":       int(smoothed_accuracy),
        "raw_accuracy_meters":   int(accuracy_meters),
        "kalman_confidence":     confidence,
        "kalman_readings":       kf.reading_count,
    }


def reset_filter(phone_number: str) -> None:
    """Reset the filter for a phone number (e.g. after SIM swap detected)."""
    if phone_number in _filters:
        _filters[phone_number].reset()
        logger.info(f"Kalman filter reset for {phone_number}")
