import json
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.fit_stability import FitStabilityAnalyzer, fit_stability_analyzer

client = TestClient(app)

@pytest.fixture
def dummy_face_landmarks():
    """Generates 478 mock landmarks representing a frontal face."""
    lms = np.zeros((478, 2), dtype=np.float64)
    # Nose tip (1), glabella (168), chin (152)
    lms[1] = [320.0, 240.0]
    lms[168] = [320.0, 180.0]
    lms[152] = [320.0, 400.0]
    lms[10] = [320.0, 100.0]
    # Eyes
    lms[33] = [260.0, 180.0]   # Right eye outer
    lms[133] = [285.0, 180.0]  # Right eye inner
    lms[263] = [380.0, 180.0]  # Left eye outer
    lms[362] = [355.0, 180.0]  # Left eye inner
    lms[468] = [272.5, 180.0]  # Right iris
    lms[473] = [367.5, 180.0]  # Left iris
    # Cheeks / preauricular (234, 454)
    lms[234] = [200.0, 240.0]
    lms[454] = [440.0, 240.0]
    return lms

def test_front_fit_analysis_with_catalog_data(dummy_face_landmarks):
    frame_data = {
        "id": "frame_1",
        "name": "Classic Aviator",
        "width_mm": 138.0,
        "lens_width_mm": 54.0,
        "bridge_width_mm": 18.0,
        "temple_length_mm": 140.0
    }
    calibrated_mm_per_px = 0.575 # 240px cheek width * 0.575 = 138.0mm
    res = fit_stability_analyzer.analyze_front_fit(
        landmarks=dummy_face_landmarks,
        img_w=640,
        img_h=480,
        frame_data=frame_data,
        user_ipd_mm=63.0,
        calibrated_mm_per_px=calibrated_mm_per_px
    )
    assert res["status"] in ["Looks Well-Aligned", "Looks Aligned", "Possible Fit Concern"]
    assert "observation" in res
    assert "confidence" in res
    assert "frame_width: 138.0mm" in res["data_available"] or "frame_width: 138mm" in res["data_available"]
    assert res["suggested_next_step"] is not None

def test_front_fit_insufficient_product_data(dummy_face_landmarks):
    # Empty frame dimensions should trigger Insufficient Product Data without fabricating numbers
    frame_data = {
        "id": "frame_unknown",
        "name": "Unlisted Model",
        "width_mm": None,
        "lens_width_mm": None,
        "bridge_width_mm": None,
        "temple_length_mm": None
    }
    res = fit_stability_analyzer.analyze_front_fit(
        landmarks=dummy_face_landmarks,
        img_w=640,
        img_h=480,
        frame_data=frame_data,
        user_ipd_mm=62.0,
        calibrated_mm_per_px=None
    )
    assert res["status"] in ["Insufficient Product Data", "Insufficient Data"]
    assert "frame_width_mm" in res["data_missing"]
    assert "lens_width_mm" in res["data_missing"]
    assert "bridge_width_mm" in res["data_missing"]

def test_nose_bridge_fit_standard_and_extreme(dummy_face_landmarks):
    frame_std = {"bridge_width_mm": 18.0}
    res_std = fit_stability_analyzer.analyze_nose_bridge_fit(
        front_landmarks=dummy_face_landmarks,
        down_landmarks=None,
        frame_data=frame_std,
        calibrated_mm_per_px=0.55
    )
    assert res_std["status"] in ["Looks Well-Aligned", "Looks Aligned"]
    assert "cannot measure physical contact pressure" in res_std["observation"]

    frame_narrow = {"bridge_width_mm": 12.0}
    res_narrow = fit_stability_analyzer.analyze_nose_bridge_fit(
        front_landmarks=dummy_face_landmarks,
        down_landmarks=None,
        frame_data=frame_narrow,
        calibrated_mm_per_px=0.55
    )
    assert res_narrow["status"] == "Possible Fit Concern"
    assert "narrow" in res_narrow["possible_fit_concern"].lower()

def test_temple_fit_both_sides(dummy_face_landmarks):
    frame_data = {"temple_length_mm": 140.0}
    res_right = fit_stability_analyzer.analyze_temple_ear_fit(
        side="right",
        side_landmarks=dummy_face_landmarks,
        frame_data=frame_data,
        eye_to_ear_mm=102.0,
        calibrated_mm_per_px=0.55
    )
    assert res_right["status"] in ["Looks Well-Aligned", "Looks Aligned", "Possible Fit Concern", "Possible Loose Fit"]
    assert "right" in res_right["observation"].lower()

    res_left = fit_stability_analyzer.analyze_temple_ear_fit(
        side="left",
        side_landmarks=dummy_face_landmarks,
        frame_data=frame_data,
        eye_to_ear_mm=102.0,
        calibrated_mm_per_px=0.55
    )
    assert res_left["status"] in ["Looks Well-Aligned", "Looks Aligned", "Possible Fit Concern", "Possible Loose Fit"]
    assert "left" in res_left["observation"].lower()

def test_temple_fit_missing_landmarks():
    frame_data = {"temple_length_mm": 140.0}
    res = fit_stability_analyzer.analyze_temple_ear_fit(
        side="right",
        side_landmarks=None,
        frame_data=frame_data
    )
    assert res["status"] == "Unable to Assess"
    assert "right_landmarks" in res["data_missing"]

def test_head_down_stability(dummy_face_landmarks):
    # Simulated downward pitch landmarks
    down_lms = dummy_face_landmarks.copy()
    down_lms[1] = [320.0, 260.0] # nose displaced
    return_lms = dummy_face_landmarks.copy()

    res = fit_stability_analyzer.analyze_head_down_stability(
        front_landmarks=dummy_face_landmarks,
        down_landmarks=down_lms,
        return_landmarks=return_lms,
        motion_displacement_px=5.0,
        tilt_change_deg=4.0
    )
    assert res["status"] in ["Looks Well-Aligned", "Looks Aligned"]
    assert "not physical friction" in res["observation"]

def test_side_profile_uncalibrated_refuses_to_invent_mm(dummy_face_landmarks):
    frame_data = {"temple_length_mm": 140.0}
    # No calibration supplied
    res = fit_stability_analyzer.analyze_temple_ear_fit(
        side="right",
        side_landmarks=dummy_face_landmarks,
        frame_data=frame_data,
        eye_to_ear_mm=None,
        calibrated_mm_per_px=None
    )
    # Must NOT report arbitrary mm
    assert res["measurements"]["eye_to_ear_distance_mm"] is None
    assert res["measurements"]["calibration_status"] == "uncalibrated_px"

def test_dimension_comparison_structure(dummy_face_landmarks):
    frame_data = {
        "id": "frame_sample",
        "name": "Acetate Clubmaster",
        "width_mm": 138.0,
        "lens_width_mm": 51.0,
        "bridge_width_mm": 21.0,
        "temple_length_mm": None # missing in dataset
    }
    front_res = fit_stability_analyzer.analyze_front_fit(dummy_face_landmarks, 640, 480, frame_data, 63.0, 0.55)
    nose_res = fit_stability_analyzer.analyze_nose_bridge_fit(dummy_face_landmarks, None, frame_data, 0.55)
    right_res = fit_stability_analyzer.analyze_temple_ear_fit("right", dummy_face_landmarks, frame_data, 102.0, 0.55)

    comp = fit_stability_analyzer.compare_frame_dimensions(frame_data, front_res, nose_res, right_res)
    assert "front_width" in comp
    assert "lens_width" in comp
    assert "bridge_width" in comp
    assert "temple_length" in comp
    # Since temple_length is None in frame_data, it must be marked as Insufficient Product Data
    assert comp["temple_length"]["status"] == "Insufficient Product Data"

def test_fit_stability_api_endpoint():
    frame_obj = {
        "id": "test_frame_1",
        "name": "Titanium Rectangular",
        "width_mm": 136.0,
        "lens_width_mm": 52.0,
        "bridge_width_mm": 18.0,
        "temple_length_mm": 142.0
    }
    # Create small valid test image
    img = np.ones((100, 100, 3), dtype=np.uint8) * 128
    _, buf = cv2.imencode(".jpg", img)
    img_bytes = buf.tobytes()

    response = client.post(
        "/api/analyze/fit-stability",
        files={
            "front_image": ("front.jpg", img_bytes, "image/jpeg")
        },
        data={
            "frame_json": json.dumps(frame_obj),
            "user_ipd_mm": 63.5,
            "calibrated_mm_per_px": 0.55,
            "motion_displacement_px": 3.2,
            "tilt_change_deg": 2.1
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "sections" in data
    assert "front_fit" in data["sections"]
    assert "nose_bridge_alignment" in data["sections"]
    assert "right_temple_fit" in data["sections"]
    assert "left_temple_fit" in data["sections"]
    assert "head_down_movement" in data["sections"]
    assert "overall_assessment" in data["sections"]
    assert "disclaimer" in data
    assert "Ordinary webcam analysis cannot prove physical comfort" in data["disclaimer"]
