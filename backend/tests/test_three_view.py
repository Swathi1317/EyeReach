import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.side_profile import SideProfileAnalyzer, side_profile_analyzer

client = TestClient(app)

def test_side_profile_analyzer_invalid_side_spec():
    dummy = np.ones((200, 200, 3), dtype=np.uint8) * 120
    res = side_profile_analyzer.analyze_side_view(dummy, expected_side="overhead")
    assert res["status"] == "invalid"
    assert "invalid_side_specification" in res["quality"]["reasons"]

def test_side_profile_analyzer_empty_image():
    res = side_profile_analyzer.analyze_side_view(None, expected_side="left")
    assert res["status"] == "invalid"
    assert "invalid_image" in res["quality"]["reasons"]

def test_side_profile_analyzer_too_dark():
    dark_img = np.zeros((200, 200, 3), dtype=np.uint8) # brightness 0
    res = side_profile_analyzer.analyze_side_view(dark_img, expected_side="left")
    assert res["status"] == "invalid"
    assert "too_dark" in res["quality"]["reasons"]

def test_side_profile_analyzer_too_bright():
    bright_img = np.ones((200, 200, 3), dtype=np.uint8) * 250 # brightness 250
    res = side_profile_analyzer.analyze_side_view(bright_img, expected_side="left")
    assert res["status"] == "invalid"
    assert "too_bright" in res["quality"]["reasons"]

def test_side_profile_analyzer_blur():
    # Uniform gray image has Laplacian variance 0 < 10
    flat_gray = np.ones((200, 200, 3), dtype=np.uint8) * 128
    res = side_profile_analyzer.analyze_side_view(flat_gray, expected_side="left")
    assert res["status"] == "invalid"
    assert "blur" in res["quality"]["reasons"]

def test_side_profile_analyzer_no_face():
    # Noise image that is not blurry, but has no face
    np.random.seed(42)
    noise_img = np.random.randint(40, 200, (300, 300, 3), dtype=np.uint8)
    res = side_profile_analyzer.analyze_side_view(noise_img, expected_side="left")
    assert res["status"] == "invalid"
    assert "no_face" in res["quality"]["reasons"]

def test_side_view_endpoint_quality_failure():
    # Post a flat gray image to /api/analyze/side-view
    flat_gray = np.ones((200, 200, 3), dtype=np.uint8) * 128
    _, buf = cv2.imencode(".jpg", flat_gray)
    
    response = client.post(
        "/api/analyze/side-view",
        files={"image": ("test.jpg", buf.tobytes(), "image/jpeg")},
        data={"side": "left"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "invalid"
    assert "blur" in data["quality"]["reasons"]

def test_side_view_endpoint_invalid_file():
    response = client.post(
        "/api/analyze/side-view",
        files={"image": ("bad.txt", b"not-an-image", "text/plain")},
        data={"side": "left"}
    )
    assert response.status_code == 400

def test_recommendations_with_side_view_measurements():
    payload = {
        "face_shape": "oval",
        "face_shape_confidence": 0.88,
        "ipd_mm": 63.5,
        "ipd_method": "iris-calibrated",
        "skin_tone": "Medium",
        "undertone": "Warm",
        "eye_shape": "Almond",
        "eye_shape_confidence": 0.80,
        "face_width_mm": 138.0,
        "left_eye_to_ear_mm": 103.2,
        "right_eye_to_ear_mm": 102.8,
        "estimated_temple_length_mm": 139.0,
        "side_view_status": "both_captured"
    }
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert len(recs) > 0
    
    top = recs[0]
    # Verify all four distinct physical fit indicators exist
    assert "front_width_compatibility" in top
    assert top["front_width_compatibility"] in ["Optimal", "Compatible", "Slightly Wide", "Slightly Narrow", "Insufficient Data"]
    assert "bridge_compatibility" in top
    assert top["bridge_compatibility"] in ["Compatible", "Narrow Bridge", "Wide Bridge", "Insufficient Data"]
    assert "temple_length_compatibility" in top
    assert "optical_alignment" in top

    # Verify Boxing dimensions are present and preserved
    assert "frame_width_mm" in top
    assert "lens_width_mm" in top
    assert "bridge_width_mm" in top
    assert "temple_length_mm" in top
    assert "lens_height_mm" in top
    # In kaggle frames catalog, temple_length_mm is null in dataset
    # Must preserve null rather than fabricating numbers
    assert "temple_length_mm" in top["missing_measurements"]

def test_recommendations_fit_indicators_without_side_view():
    payload = {
        "face_shape": "round",
        "face_shape_confidence": 0.75,
        "ipd_mm": 62.0,
        "ipd_method": "iris-calibrated",
        "skin_tone": "Light",
        "undertone": "Cool"
    }
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert len(recs) > 0
    top = recs[0]
    assert top["front_width_compatibility"] is not None
    assert top["bridge_compatibility"] is not None
    assert top["temple_length_compatibility"] in ["Partially assessed", "Acceptable", "Compatible", "Review Fit", "Unsuitable", "Temple length unavailable"]
    assert top["optical_alignment"] is not None

def test_side_profile_strict_yaw_rejections():
    """Verify that slight turns (<48 deg) and excessive turns (>88 deg) are strictly rejected."""
    analyzer = SideProfileAnalyzer()
    
    # Create a synthetic image with valid lighting and texture
    np.random.seed(42)
    test_img = np.random.randint(50, 200, (480, 640, 3), dtype=np.uint8)
    
    # Create synthetic landmarks
    class MockLandmark:
        def __init__(self, x, y):
            self.x = x
            self.y = y
            
    mock_lms = [MockLandmark(0.5, 0.5) for _ in range(478)]
    # Set key points
    mock_lms[1] = MockLandmark(0.5, 0.45)   # nose tip
    mock_lms[152] = MockLandmark(0.5, 0.80) # chin
    mock_lms[33] = MockLandmark(0.35, 0.35) # right eye
    mock_lms[263] = MockLandmark(0.65, 0.35)# left eye
    mock_lms[234] = MockLandmark(0.20, 0.40)# right ear
    mock_lms[454] = MockLandmark(0.80, 0.40)# left ear
    mock_lms[162] = MockLandmark(0.22, 0.30)# right apex
    mock_lms[389] = MockLandmark(0.78, 0.30)# left apex
    mock_lms[468] = MockLandmark(0.35, 0.35)# right iris
    mock_lms[473] = MockLandmark(0.65, 0.35)# left iris
    mock_lms[168] = MockLandmark(0.5, 0.35) # glabella
    mock_lms[10] = MockLandmark(0.5, 0.15)  # forehead
    mock_lms[132] = MockLandmark(0.25, 0.70)# right jaw
    mock_lms[361] = MockLandmark(0.75, 0.70)# left jaw

    class MockMultiFaceResult:
        def __init__(self):
            self.multi_face_landmarks = [type("Face", (), {"landmark": mock_lms})()]

    # Test 1: Partial turn (e.g. 28 degrees) -> rejected with insufficient_head_turn
    analyzer.face_mesh.process = lambda img: MockMultiFaceResult()
    analyzer.estimate_head_pose = lambda mapped, w, h: (0.0, 28.0, 0.0) # slight right turn
    res = analyzer.analyze_side_view(test_img, expected_side="right")
    assert res["status"] == "invalid"
    assert "insufficient_head_turn" in res["quality"]["reasons"]

    # Test 2: Orientation mismatch (turned left when expected right)
    analyzer.estimate_head_pose = lambda mapped, w, h: (0.0, -75.0, 0.0)
    res = analyzer.analyze_side_view(test_img, expected_side="right")
    assert res["status"] == "invalid"
    assert "orientation_mismatch" in res["quality"]["reasons"]

    # Test 3: Excessive head turn (>88 degrees)
    analyzer.estimate_head_pose = lambda mapped, w, h: (0.0, 92.0, 0.0)
    res = analyzer.analyze_side_view(test_img, expected_side="right")
    assert res["status"] == "invalid"
    assert "excessive_head_turn" in res["quality"]["reasons"]

def test_side_profile_calibrated_vs_uncalibrated():
    """Verify calibrated physical measurements vs explicit uncalibrated pixel estimates."""
    analyzer = SideProfileAnalyzer()
    np.random.seed(42)
    test_img = np.random.randint(50, 200, (480, 640, 3), dtype=np.uint8)

    class MockLandmark:
        def __init__(self, x, y):
            self.x = x
            self.y = y

    mock_lms = [MockLandmark(0.5, 0.5) for _ in range(478)]
    mock_lms[1] = MockLandmark(0.5, 0.45)   # nose tip
    mock_lms[152] = MockLandmark(0.5, 0.80) # chin
    mock_lms[33] = MockLandmark(0.35, 0.35) # right eye
    mock_lms[263] = MockLandmark(0.65, 0.35)# left eye
    mock_lms[234] = MockLandmark(0.20, 0.40)# right ear
    mock_lms[454] = MockLandmark(0.80, 0.40)# left ear
    mock_lms[162] = MockLandmark(0.22, 0.30)# right apex
    mock_lms[389] = MockLandmark(0.78, 0.30)# left apex
    mock_lms[468] = MockLandmark(0.35, 0.35)# right iris
    mock_lms[473] = MockLandmark(0.65, 0.35)# left iris
    mock_lms[168] = MockLandmark(0.5, 0.35) # glabella
    mock_lms[10] = MockLandmark(0.5, 0.15)  # forehead
    mock_lms[132] = MockLandmark(0.25, 0.70)# right jaw
    mock_lms[361] = MockLandmark(0.75, 0.70)# left jaw

    class MockMultiFaceResult:
        def __init__(self):
            self.multi_face_landmarks = [type("Face", (), {"landmark": mock_lms})()]

    analyzer.face_mesh.process = lambda img: MockMultiFaceResult()
    analyzer.estimate_head_pose = lambda mapped, w, h: (0.0, 76.5, 0.0) # valid near-profile right turn

    # Case A: Calibrated with front iris mm_per_px scale
    calibrated_res = analyzer.analyze_side_view(test_img, expected_side="right", mm_per_px=0.65)
    assert calibrated_res["status"] == "valid"
    assert calibrated_res["head_pose"]["yaw_deg"] == 76.5
    assert calibrated_res["measurements"]["eye_to_ear_distance_mm"] is not None
    assert calibrated_res["measurements"]["hinge_to_apex_mm"] is not None
    assert calibrated_res["measurements"]["estimated_temple_length_mm"] is not None
    assert "temple_geometry_note" in calibrated_res["measurements"]
    assert calibrated_res["measurements"]["measurement_type"] == "calibrated_physical_mm"
    assert calibrated_res["measurements"]["calibration_source"] == "front_view_iris"
    assert calibrated_res["annotated_image"].startswith("data:image/jpeg;base64,")

    # Case B: Uncalibrated scale
    uncalibrated_res = analyzer.analyze_side_view(test_img, expected_side="right", mm_per_px=None)
    assert uncalibrated_res["status"] == "valid"
    assert uncalibrated_res["measurements"]["eye_to_ear_distance_mm"] is None
    assert uncalibrated_res["measurements"]["estimated_temple_length_mm"] is None
    assert uncalibrated_res["measurements"]["measurement_type"] == "uncalibrated_px"
    assert uncalibrated_res["measurements"]["calibration_source"] == "uncalibrated"

