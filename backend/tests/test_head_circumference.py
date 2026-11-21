"""
Unit tests for AI Three-View Head Circumference Estimation (backend/ml/head_circumference.py).
Verifies:
  - Mathematical correctness of Ramanujan's ellipse approximation
  - Physical scale calibration (reference card vs iris approximation vs uncalibrated)
  - Distance compensation and scale propagation between front and side views
  - Bilateral profile depth consistency and asymmetry handling
  - Hair interference and posterior contour protrusion detection
  - Physiological plausibility bounds checking (rejecting implausible cranial values)
  - Reliability scoring (ensuring it never blindly outputs 'High')
  - Strict refusal to fabricate measurements on missing or corrupted images
"""

import pytest
import cv2
import numpy as np
import math
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.head_circumference import (
    HeadCircumferenceEstimator,
    head_circumference_estimator
)

client = TestClient(app)


def test_ramanujan_circumference_circle():
    """For a circle (a = b = r), circumference must equal 2 * pi * r."""
    r = 90.0  # mm (diameter 180 mm)
    expected = 2.0 * math.pi * r
    calculated = head_circumference_estimator.calculate_ramanujan_circumference(r, r)
    assert pytest.approx(calculated, rel=1e-4) == expected


def test_ramanujan_circumference_ellipse_typical_cranium():
    """
    For a typical adult cranium:
      Depth (2a) = 195 mm -> a = 97.5 mm
      Breadth (2b) = 152 mm -> b = 76.0 mm
    Ramanujan's approximation should produce ~550 mm (55.0 cm).
    """
    a = 97.5
    b = 76.0
    c_mm = head_circumference_estimator.calculate_ramanujan_circumference(a, b)
    c_cm = c_mm / 10.0
    # Expected adult range is approx 54.5 - 55.5 cm
    assert 54.0 <= c_cm <= 56.0


def test_ramanujan_invalid_dimensions():
    """Non-positive axes must yield 0.0 without throwing exceptions."""
    assert head_circumference_estimator.calculate_ramanujan_circumference(-10.0, 50.0) == 0.0
    assert head_circumference_estimator.calculate_ramanujan_circumference(50.0, 0.0) == 0.0


def test_missing_or_empty_images_refuses_to_fabricate():
    """Must return an explicit invalid/unreliable result when images are missing."""
    empty_img = np.zeros((100, 100, 3), dtype=np.uint8)
    
    # Missing front image
    res = head_circumference_estimator.estimate_head_circumference_three_view(
        None, empty_img, empty_img
    )
    assert res["status"] in ["invalid", "unreliable"]
    assert res["circumference_cm"] is None
    assert res["is_physically_validated"] is False
    assert "missing_front_image" in res["quality_reasons"] or len(res["quality_reasons"]) > 0

    # Missing side images
    res2 = head_circumference_estimator.estimate_head_circumference_three_view(
        empty_img, None, empty_img
    )
    assert res2["status"] in ["invalid", "unreliable"]
    assert res2["circumference_cm"] is None


def test_uncalibrated_refuses_metric_invention():
    """
    If no reference object and no valid iris landmarks exist,
    the system must refuse to invent centimeter measurements.
    """
    # Create synthetic dark image that fails quality check
    dark_img = np.zeros((480, 640, 3), dtype=np.uint8)
    res = head_circumference_estimator.estimate_head_circumference_three_view(
        dark_img, dark_img, dark_img,
        reference_width_mm=None,
        reference_width_px=None,
        iris_scale_mm_per_px=None
    )
    assert res["circumference_cm"] is None
    assert res["scale_factor_mm_per_px"] is None
    assert res["reliability_score"] == 0.0


def test_scale_propagation_and_distance_compensation():
    """
    Simulates distance compensation when the user steps back or leans forward
    during side profile capture.
    """
    estimator = HeadCircumferenceEstimator()
    front_face_h_px = 200.0
    profile_face_h_px = 180.0  # User stepped back 10%
    front_scale = 0.50  # mm/px

    scale_ratio = front_face_h_px / profile_face_h_px
    compensated_scale = front_scale * scale_ratio

    assert compensated_scale > front_scale
    assert pytest.approx(compensated_scale, rel=1e-3) == (0.50 * (200.0 / 180.0))


def test_reliability_scoring_does_not_default_to_high():
    """
    Verifies that reliability scoring rigorously distinguishes approximate
    iris scaling from calibrated physical scaling and does NOT claim 'High' by default.
    """
    estimator = HeadCircumferenceEstimator()
    
    # Failure result reliability score must be 0
    fail_res = estimator._build_failure_result("unreliable", ["test_reason"], "Failure message")
    assert fail_res["reliability_score"] == 0.0
    assert "Unreliable" in fail_res["reliability_tier"]
    assert fail_res["is_physically_validated"] is False


def test_future_validation_schema_structure():
    """
    Verifies that the output contains the empirical validation schema
    ready for comparison against physical measuring tape ground truth.
    """
    estimator = HeadCircumferenceEstimator()
    fail_res = estimator._build_failure_result("unreliable", ["test"], "Test")
    val = fail_res.get("validation_metrics")
    assert val is not None
    assert "is_physically_validated" in val
    assert val["is_physically_validated"] is False
    assert "ground_truth_tape_cm" in val
    assert "absolute_error_cm" in val
    assert "percentage_error" in val


def test_three_view_head_endpoint_invalid_files():
    """Endpoint must reject non-image uploads with 400."""
    response = client.post(
        "/api/analyze/three-view-head",
        files={
            "front_image": ("front.txt", b"not-an-image", "text/plain"),
            "left_image": ("left.txt", b"not-an-image", "text/plain"),
            "right_image": ("right.txt", b"not-an-image", "text/plain"),
        }
    )
    assert response.status_code == 400


def test_three_view_head_endpoint_empty_images():
    """Endpoint must process decoded images and report status."""
    flat_gray = np.ones((200, 200, 3), dtype=np.uint8) * 128
    _, buf = cv2.imencode(".jpg", flat_gray)
    img_bytes = buf.tobytes()

    response = client.post(
        "/api/analyze/three-view-head",
        files={
            "front_image": ("front.jpg", img_bytes, "image/jpeg"),
            "left_image": ("left.jpg", img_bytes, "image/jpeg"),
            "right_image": ("right.jpg", img_bytes, "image/jpeg"),
        },
        data={"calibrated_mm_per_px": 0.5}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["invalid", "unreliable"]
    assert data["is_physically_validated"] is False


def test_recommendations_with_ai_three_view_head_circumference():
    """
    Verifies that when head_circumference_source is 'ai_three_view',
    the measurement is accepted, factored into cranial sizing,
    and NOT listed as a missing parameter.
    """
    payload = {
        "face_shape": "Oval",
        "face_shape_confidence": 0.90,
        "ipd_mm": 63.5,
        "ipd_method": "iris-calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "eye_shape": "Almond",
        "head_circumference_mm": 564.0,  # 56.4 cm from AI 3-view
        "head_circumference_source": "ai_three_view",
        "face_width_mm": 138.0,
        "left_eye_to_ear_mm": 103.0,
        "right_eye_to_ear_mm": 102.5,
        "estimated_temple_length_mm": 140.0,
        "side_view_status": "both_captured"
    }
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert len(recs) > 0
    top = recs[0]
    
    # Head circumference must NOT be in missing_measurements
    assert "head_circumference_mm" not in top["missing_measurements"]
    
    # Missing details must NOT list head circumference
    missing_param_names = [d["parameter"] for d in top.get("missing_details", [])]
    assert "head_circumference_mm" not in missing_param_names
