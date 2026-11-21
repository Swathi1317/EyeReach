import os
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.ipd import calculate_ipd, aggregate_ipd
from backend.ml.skin_tone import classify_tone_and_undertone

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def create_mock_landmarks(iris_dist_px=40, iris_dia_px=10):
    landmarks = np.zeros((478, 2))
    
    # Left eye center
    cx_l = 100
    cy_l = 100
    landmarks[468] = [cx_l, cy_l]
    # Boundaries (left, top, right, bottom)
    landmarks[469] = [cx_l - iris_dia_px/2, cy_l]
    landmarks[470] = [cx_l, cy_l - iris_dia_px/2]
    landmarks[471] = [cx_l + iris_dia_px/2, cy_l]
    landmarks[472] = [cx_l, cy_l + iris_dia_px/2]
    
    # Right eye center
    cx_r = 100 + iris_dist_px
    cy_r = 100
    landmarks[473] = [cx_r, cy_r]
    # Boundaries
    landmarks[474] = [cx_r - iris_dia_px/2, cy_r]
    landmarks[475] = [cx_r, cy_r - iris_dia_px/2]
    landmarks[476] = [cx_r + iris_dia_px/2, cy_r]
    landmarks[477] = [cx_r, cy_r + iris_dia_px/2]
    
    return landmarks

def test_ipd_calculation_iris_calibrated():
    # Let iris_dia_px = 10. reference_iris_diameter_mm = 11.7. 
    # mm_per_px = 11.7 / 10 = 1.17
    # If we want IPD ~ 63mm, we need iris_dist_px = 63 / 1.17 = 53.84
    landmarks = create_mock_landmarks(iris_dist_px=53.84, iris_dia_px=10)
    
    result = calculate_ipd(landmarks)
    assert result["status"] == "valid"
    assert result["method"] == "iris-calibrated"
    assert np.isclose(result["ipd_mm"], 63.0, atol=0.1)

def test_ipd_plausibility():
    # 200 mm IPD
    landmarks = create_mock_landmarks(iris_dist_px=200, iris_dia_px=10)
    result = calculate_ipd(landmarks)
    assert result["status"] == "invalid"
    assert "implausible_ipd_value" in result["reasons"]

def test_invalid_iris_detection():
    # missing iris
    landmarks = create_mock_landmarks(iris_dist_px=5, iris_dia_px=1)
    result = calculate_ipd(landmarks)
    assert result["status"] == "invalid"

def test_ipd_aggregation():
    # 10 valid frames
    measurements = [
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 62.1},
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 61.9},
        {"status": "valid", "ipd_mm": 62.2},
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 62.1},
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 70.0}, # Outlier
        {"status": "valid", "ipd_mm": 40.0}  # Outlier
    ]
    
    result = aggregate_ipd(measurements)
    assert result["status"] == "valid"
    assert result["frames_used"] == 8
    assert result["ipd_mm"] == 62.0
    assert result["mad"] == 0.05
    
def test_ipd_aggregation_min_frames():
    # Only 5 frames
    measurements = [
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 62.1},
        {"status": "valid", "ipd_mm": 62.0},
        {"status": "valid", "ipd_mm": 61.9},
        {"status": "valid", "ipd_mm": 62.2}
    ]
    
    result = aggregate_ipd(measurements)
    assert result["status"] == "invalid"
    assert "not_enough_stable_frames" in result["reasons"]


def test_api_phase2_invalid_image():
    response = client.post("/api/analyze/phase2", files={"image": ("test.jpg", b"bad_data", "image/jpeg")})
    assert response.status_code == 400

def test_api_phase2_valid_image():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    _, img_encoded = cv2.imencode('.jpg', img)
    response = client.post(
        "/api/analyze/phase2",
        files={"image": ("test.jpg", img_encoded.tobytes(), "image/jpeg")}
    )
    assert response.status_code == 200
    res = response.json()
    assert "quality" in res

def test_ipd_reference_card_calibration():
    # Mock landmarks with distance 60 px
    landmarks = create_mock_landmarks(iris_dist_px=60.0, iris_dia_px=10)
    # Reference object: card 85.6 mm width spanning 80 px => mm_per_px = 85.6 / 80 = 1.07
    result = calculate_ipd(landmarks, reference_width_mm=85.6, reference_width_px=80.0)
    assert result["status"] == "valid"
    assert result["method"] == "reference-calibrated"
    assert result["calibration_source"] == "reference_object"
    assert result["uncertainty_mm"] == 0.5
    assert np.isclose(result["ipd_mm"], 64.2, atol=0.1)

def test_ipd_turned_head_pose_rejected():
    landmarks = create_mock_landmarks(iris_dist_px=50.0, iris_dia_px=10)
    # Make right iris significantly smaller due to perspective foreshortening
    cx_r = landmarks[473][0]
    cy_r = landmarks[473][1]
    small_dia = 5.0
    landmarks[474] = [cx_r - small_dia/2, cy_r]
    landmarks[475] = [cx_r, cy_r - small_dia/2]
    landmarks[476] = [cx_r + small_dia/2, cy_r]
    landmarks[477] = [cx_r, cy_r + small_dia/2]
    
    result = calculate_ipd(landmarks)
    assert result["status"] == "invalid"
    assert "turned_head_pose" in result["reasons"]

