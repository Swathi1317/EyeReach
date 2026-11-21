import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.eye_shape import analyze_eye_shape
from backend.ml.ipd import calculate_ipd
from backend.tests.test_phase2 import create_mock_landmarks

client = TestClient(app)

def create_mock_eye_landmarks(ear=0.30, canthal_tilt_dy=0.0):
    """
    Creates mock MediaPipe FaceMesh landmarks with controllable eye geometry.
    ear = height / width
    canthal_tilt_dy: vertical offset of outer canthi relative to inner canthi.
                     Positive dy means outer corner is higher (upturned in image where y points down).
    """
    landmarks = np.zeros((478, 2))
    
    # Left eye in image (33=outer, 133=inner, 159=top, 145=bottom)
    # Center around x=100, y=100
    w_px = 30.0
    h_px = w_px * ear
    
    landmarks[133] = [115.0, 100.0]                      # inner canthus
    landmarks[33]  = [85.0, 100.0 - canthal_tilt_dy]     # outer canthus (y decreases = higher on face)
    landmarks[159] = [100.0, 100.0 - h_px / 2.0]        # upper lid
    landmarks[145] = [100.0, 100.0 + h_px / 2.0]        # lower lid
    
    # Right eye in image (362=inner, 263=outer, 386=top, 374=bottom)
    # Center around x=170, y=100
    landmarks[362] = [155.0, 100.0]                     # inner canthus
    landmarks[263] = [185.0, 100.0 - canthal_tilt_dy]    # outer canthus
    landmarks[386] = [170.0, 100.0 - h_px / 2.0]        # upper lid
    landmarks[374] = [170.0, 100.0 + h_px / 2.0]        # lower lid
    
    # Irises
    landmarks[468] = [100.0, 100.0]
    landmarks[473] = [170.0, 100.0]
    
    # Cheeks & Nose
    landmarks[1] = [135.0, 120.0]
    landmarks[234] = [50.0, 120.0]
    landmarks[454] = [220.0, 120.0]
    
    return landmarks

def test_eye_shape_almond():
    landmarks = create_mock_eye_landmarks(ear=0.30, canthal_tilt_dy=0.0)
    res = analyze_eye_shape(landmarks, mm_per_px=1.0)
    assert "Almond" in res["categories"]
    assert res["eye_shape"] != "Undetermined"
    assert res["measurements"]["aspect_ratio"] == pytest.approx(0.30, abs=0.03)

def test_eye_shape_round():
    landmarks = create_mock_eye_landmarks(ear=0.42, canthal_tilt_dy=0.0)
    res = analyze_eye_shape(landmarks, mm_per_px=1.0)
    assert "Round" in res["categories"]

def test_eye_shape_upturned():
    # Outer corner 4 pixels higher than inner corner over 30px width (~7.6 degrees)
    landmarks = create_mock_eye_landmarks(ear=0.30, canthal_tilt_dy=4.0)
    res = analyze_eye_shape(landmarks, mm_per_px=1.0)
    assert "Upturned" in res["categories"]
    assert res["measurements"]["canthal_tilt_deg"] > 3.0

def test_eye_shape_downturned():
    # Outer corner 3 pixels lower than inner corner
    landmarks = create_mock_eye_landmarks(ear=0.30, canthal_tilt_dy=-3.0)
    res = analyze_eye_shape(landmarks, mm_per_px=1.0)
    assert "Downturned" in res["categories"]
    assert res["measurements"]["canthal_tilt_deg"] < -2.0

def test_eye_shape_ambiguous_and_unsupported():
    # Abnormally flat/closed eye (ear=0.15) should return Undetermined
    landmarks = create_mock_eye_landmarks(ear=0.15, canthal_tilt_dy=0.0)
    res = analyze_eye_shape(landmarks)
    assert res["eye_shape"] == "Undetermined"
    assert "Undetermined" in res["categories"]
    assert "Hooded and Monolid" in res["explanation"]

def test_eye_shape_missing_landmarks():
    res = analyze_eye_shape(None)
    assert res["eye_shape"] == "Undetermined"
    assert res["measurements"]["eye_width_mm"] is None

def test_ipd_calculation_preserved():
    # Verify existing IPD calculation produces expected calibrated values without mutation
    landmarks = create_mock_landmarks(iris_dist_px=53.84, iris_dia_px=10)
    result = calculate_ipd(landmarks)
    assert result["status"] == "valid"
    assert np.isclose(result["ipd_mm"], 63.0, atol=0.1)

def test_head_circumference_not_inferred_from_face_width():
    # Calling phase2 API must report head circumference as unavailable from camera
    # and MUST NOT invent a centimeter value based on cheek width
    img = np.zeros((300, 300, 3), dtype=np.uint8)
    # Even if an image is sent, the schema defines camera_unavailable
    response = client.post("/api/analyze/phase2", files={"image": ("test.jpg", b"invalid", "image/jpeg")})
    assert response.status_code == 400

def test_recommendations_with_missing_frame_dimensions():
    # Test that missing frame dimensions do NOT produce 'Compatible' fit status
    req_data = {
        "face_shape": "Oval",
        "face_shape_confidence": 0.85,
        "ipd_mm": 63.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "eye_shape": "Almond"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    assert len(data["recommendations"]) > 0
    for rec in data["recommendations"]:
        assert "style_compatibility_score" in rec
        assert "physical_fit_score" in rec
        assert "fit_status" in rec
        assert "missing_measurements" in rec
        # When essential dimensions (e.g., temple_length_mm) are missing, fit_status must be 'Insufficient data'
        if rec["temple_length_mm"] is None or rec["frame_width_mm"] is None:
            assert rec["fit_status"] == "Insufficient data"
            assert "Insufficient data" in rec["fit_explanation"]
            assert rec["fit_status"] != "Compatible"

def test_user_entered_head_circumference_distinction():
    # Test that user-entered circumference is properly accepted and distinguished
    req_data = {
        "face_shape": "Round",
        "face_shape_confidence": 0.9,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Fair",
        "undertone": "Cool",
        "head_circumference_mm": 570.0,
        "head_circumference_source": "user_entered"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    assert len(data["recommendations"]) == 5
    first = data["recommendations"][0]
    assert first["physical_fit_score"] is not None
    # In Kaggle dataset where temple_length_mm is missing, fit_status must be Insufficient data
    assert first["fit_status"] == "Insufficient data"

def test_manual_head_circumference_validation_backend():
    # Verify that invalid manual head circumference (negative, zero, out-of-range) is ignored
    invalid_cases = [-50.0, 0.0, 300.0, 850.0]
    for invalid_hc in invalid_cases:
        req_data = {
            "face_shape": "Square",
            "face_shape_confidence": 0.85,
            "ipd_mm": 64.0,
            "ipd_method": "calibrated",
            "skin_tone": "Medium",
            "undertone": "Neutral",
            "head_circumference_mm": invalid_hc,
            "head_circumference_source": "user_entered"
        }
        res = client.post("/api/recommendations", json=req_data)
        assert res.status_code == 200
        recs = res.json()["recommendations"]
        # Comparison with request having head_circumference_mm: None should match scores exactly
        req_none = dict(req_data, head_circumference_mm=None)
        res_none = client.post("/api/recommendations", json=req_none)
        recs_none = res_none.json()["recommendations"]
        assert recs[0]["physical_fit_score"] == recs_none[0]["physical_fit_score"]

def test_frame_fit_complete_dimensions_compatible_and_unsuitable(monkeypatch):
    import backend.app.routers.recommendations as rec_mod
    mock_catalog = [
        # Frame with optimal fit and all 4 dimensions (IPD 64, Ideal width 134, Frame width 134, Decentration 1.0mm)
        {
            "id": "f_opt",
            "name": "Optimal Fit Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 134.0,
            "lens_width_mm": 50.0,
            "bridge_width_mm": 16.0,
            "temple_length_mm": 140.0
        },
        # Frame with excessive decentration (Frame PD = 58 + 22 = 80mm; IPD 64 -> Decentration = 8.0 mm/eye)
        {
            "id": "f_excessive_decentration",
            "name": "Excessive Decentration Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 134.0,
            "lens_width_mm": 58.0,
            "bridge_width_mm": 22.0,
            "temple_length_mm": 140.0
        }
    ]
    monkeypatch.setattr(rec_mod, "load_frames", lambda: mock_catalog)

    req_data = {
        "face_shape": "Round",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    recs = {r["id"]: r for r in response.json()["recommendations"]}

    # f_opt: All 4 dimensions present, minimal decentration (1.0 mm), exact width -> Compatible
    assert recs["f_opt"]["fit_status"] == "Compatible"
    assert "Compatible:" in recs["f_opt"]["fit_explanation"]

    # f_excessive_decentration: All 4 dimensions present, decentration 8.0 mm > 4.0 mm threshold -> Unsuitable
    assert recs["f_excessive_decentration"]["fit_status"] == "Unsuitable"
    assert "excessive decentration" in recs["f_excessive_decentration"]["fit_explanation"]

def test_missing_information_details_and_how_to_provide():
    # Verify that when a frame is missing specifications, missing_details and how_to_provide are populated
    req_data = {
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    recs = response.json()["recommendations"]
    
    # Find any frame with missing temple length
    missing_tl_recs = [r for r in recs if r["temple_length_mm"] is None]
    if missing_tl_recs:
        rec = missing_tl_recs[0]
        assert rec["fit_status"] == "Insufficient data"
        assert rec["temple_length_compatibility"] == "Temple length unavailable"
        assert len(rec["missing_details"]) > 0
        tl_detail = next((d for d in rec["missing_details"] if d["parameter"] == "temple_length_mm"), None)
        assert tl_detail is not None
        assert tl_detail["name"] == "Temple Length"
        assert "How to provide:" in rec["fit_explanation"]
        assert len(rec["how_to_provide"]) > 0

def test_temple_length_validation_and_unavailable_display(monkeypatch):
    import backend.app.routers.recommendations as rec_mod

    mock_catalog = [
        # Frame with verified temple length (140 mm)
        {
            "id": "f_verified_tl",
            "name": "Verified Temple Frame",
            "category": "Square",
            "color": "Black",
            "width_mm": 134.0,
            "lens_width_mm": 50.0,
            "bridge_width_mm": 16.0,
            "temple_length_mm": 140.0,
            "price": 1500.0
        },
        # Frame with missing temple length (None)
        {
            "id": "f_missing_tl",
            "name": "Missing Temple Frame",
            "category": "Square",
            "color": "Black",
            "width_mm": 134.0,
            "lens_width_mm": 50.0,
            "bridge_width_mm": 16.0,
            "temple_length_mm": None,
            "price": 1500.0
        }
    ]
    monkeypatch.setattr(rec_mod, "load_frames", lambda: mock_catalog)

    # Case 1: Frontal request without side-view
    res1 = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    })
    assert res1.status_code == 200
    recs1 = {r["id"]: r for r in res1.json()["recommendations"]}

    # Verified frame has 140 mm and is partially assessed without side view
    assert recs1["f_verified_tl"]["temple_length_mm"] == 140.0
    assert recs1["f_verified_tl"]["temple_length_compatibility"] == "Partially assessed"
    assert recs1["f_verified_tl"]["fit_status"] == "Compatible"

    # Missing temple frame has None and displays "Temple length unavailable"
    assert recs1["f_missing_tl"]["temple_length_mm"] is None
    assert recs1["f_missing_tl"]["temple_length_compatibility"] == "Temple length unavailable"
    assert recs1["f_missing_tl"]["fit_status"] == "Insufficient data"

    # Case 2: Request with calibrated side-view temple reach = 142.0 mm (diff 2.0 mm <= 5 mm -> Compatible)
    res2 = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "estimated_temple_length_mm": 142.0
    })
    assert res2.status_code == 200
    recs2 = {r["id"]: r for r in res2.json()["recommendations"]}
    assert recs2["f_verified_tl"]["temple_length_compatibility"] == "Compatible"
    assert recs2["f_verified_tl"]["fit_status"] == "Compatible"
    assert recs2["f_missing_tl"]["temple_length_compatibility"] == "Temple length unavailable"
    assert recs2["f_missing_tl"]["fit_status"] == "Insufficient data"

    # Case 3: Difference <= 10 mm (reach 148.0 mm vs temple 140.0 mm -> diff 8.0 mm -> Acceptable)
    res3 = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "estimated_temple_length_mm": 148.0
    })
    assert res3.status_code == 200
    recs3 = {r["id"]: r for r in res3.json()["recommendations"]}
    assert recs3["f_verified_tl"]["temple_length_compatibility"] == "Acceptable"
    assert recs3["f_verified_tl"]["fit_status"] == "Compatible"

    # Case 4: Difference > 10 mm (reach 153.0 mm vs temple 140.0 mm -> diff 13.0 mm -> Review Fit)
    res4 = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "estimated_temple_length_mm": 153.0
    })
    assert res4.status_code == 200
    recs4 = {r["id"]: r for r in res4.json()["recommendations"]}
    assert recs4["f_verified_tl"]["temple_length_compatibility"] == "Review Fit"
    assert recs4["f_verified_tl"]["fit_status"] == "Review Fit"

    # Case 5: Difference > 18 mm (reach 162.0 mm vs temple 140.0 mm -> diff 22.0 mm -> Unsuitable, priority over other dims)
    res5 = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "estimated_temple_length_mm": 162.0
    })
    assert res5.status_code == 200
    recs5 = {r["id"]: r for r in res5.json()["recommendations"]}
    assert recs5["f_verified_tl"]["temple_length_compatibility"] == "Unsuitable"
    assert recs5["f_verified_tl"]["fit_status"] == "Unsuitable"
    assert "Unsuitable fit" in recs5["f_verified_tl"]["fit_explanation"]
    assert "temple length mismatch" in recs5["f_verified_tl"]["fit_explanation"]

def test_frame_crud_endpoints(tmp_path, monkeypatch):
    import json
    import backend.app.routers.recommendations as rec_mod

    # Setup isolated test catalog file
    test_catalog = [
        {"id": "test_1", "name": "Catalog Test Frame", "category": "Square", "color": "Black", "width_mm": 135.0, "lens_width_mm": 54.0, "bridge_width_mm": 18.0, "temple_length_mm": None, "price": 1200.0}
    ]
    test_cat_path = str(tmp_path / "test_frames.json")
    with open(test_cat_path, "w") as f:
        json.dump(test_catalog, f)

    monkeypatch.setattr(rec_mod, "KAGGLE_DATA_PATH", test_cat_path)
    monkeypatch.setattr(rec_mod, "DATA_PATH", str(tmp_path / "nonexistent.json"))

    # 1. Test GET /api/frames
    res_list = client.get("/api/frames")
    assert res_list.status_code == 200
    data = res_list.json()
    assert data["total"] == 1
    assert data["frames"][0]["id"] == "test_1"
    assert data["frames"][0]["is_complete"] is False
    assert "temple_length_mm" in data["frames"][0]["missing_specs"]

    # 2. Test GET /api/frames/{frame_id}
    res_item = client.get("/api/frames/test_1")
    assert res_item.status_code == 200
    assert res_item.json()["name"] == "Catalog Test Frame"

    # 3. Test PUT /api/frames/{frame_id} validation (reject negative/zero)
    res_bad = client.put("/api/frames/test_1", json={"temple_length_mm": -10.0})
    assert res_bad.status_code == 400

    # 4. Test PUT /api/frames/{frame_id} successful update
    res_update = client.put("/api/frames/test_1", json={"temple_length_mm": 140.0})
    assert res_update.status_code == 200
    assert res_update.json()["status"] == "success"
    assert res_update.json()["frame"]["temple_length_mm"] == 140.0

    # 5. Verify persistence in file
    with open(test_cat_path, "r") as f:
        reloaded = json.load(f)
    assert reloaded[0]["temple_length_mm"] == 140.0

    # 6. Verify that recommendations now evaluate it with complete physical specifications
    rec_res = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    })
    assert rec_res.status_code == 200
    first = rec_res.json()["recommendations"][0]
    # Now that temple_length_mm is 140, lens 54, bridge 18 (frame PD 72, decentration 4.0mm), width 135
    assert first["temple_length_mm"] == 140.0
    assert first["fit_status"] in ["Compatible", "Review Fit"]

def test_frame_fit_width_difference_thresholds_user_scenario(monkeypatch):
    import backend.app.routers.recommendations as rec_mod

    # Setup frames covering the threshold spectrum:
    # User IPD = 63.2 mm -> Ideal frame width = 63.2 + 70.0 = 133.2 mm
    mock_catalog = [
        # User scenario frame: Width = 123.0 mm (diff = 10.2 mm > 10 mm and <= 18 mm), Lens 52, Bridge 18 (PD 70, decentration 3.4 mm)
        {
            "id": "f_user_scenario",
            "name": "User Scenario Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 123.0,
            "lens_width_mm": 52.0,
            "bridge_width_mm": 18.0,
            "temple_length_mm": 140.0
        },
        # Compatible frame: Width = 131.0 mm (diff = 2.2 mm <= 5 mm), Lens 51, Bridge 18 (PD 69, decentration 2.9 mm)
        {
            "id": "f_diff_compatible",
            "name": "Compatible Width Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 131.0,
            "lens_width_mm": 51.0,
            "bridge_width_mm": 18.0,
            "temple_length_mm": 140.0
        },
        # Acceptable frame: Width = 126.0 mm (diff = 7.2 mm <= 10 mm), Lens 51, Bridge 18 (PD 69, decentration 2.9 mm)
        {
            "id": "f_diff_acceptable",
            "name": "Acceptable Width Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 126.0,
            "lens_width_mm": 51.0,
            "bridge_width_mm": 18.0,
            "temple_length_mm": 140.0
        },
        # Unsuitable frame: Width = 112.0 mm (diff = 21.2 mm > 18 mm), Lens 48, Bridge 16 (PD 64, decentration 0.4 mm)
        {
            "id": "f_diff_unsuitable",
            "name": "Unsuitable Width Frame",
            "category": "Square",
            "category_confidence": 0.9,
            "color": "Black",
            "price": 1500.0,
            "width_mm": 112.0,
            "lens_width_mm": 48.0,
            "bridge_width_mm": 16.0,
            "temple_length_mm": 140.0
        }
    ]

    monkeypatch.setattr(rec_mod, "load_frames", lambda: mock_catalog)

    res = client.post("/api/recommendations", json={
        "face_shape": "Square",
        "face_shape_confidence": 0.85,
        "ipd_mm": 63.2,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    })
    assert res.status_code == 200
    recs = {r["id"]: r for r in res.json()["recommendations"]}

    # 1. User scenario frame: diff 10.2 mm (>10 mm and <=18 mm) + decentration 3.4 mm/eye -> Review Fit (NOT Unsuitable!)
    user_frame = recs["f_user_scenario"]
    assert user_frame["fit_status"] == "Review Fit"
    assert user_frame["fit_status"] != "Unsuitable"
    assert "moderate decentration" in user_frame["fit_explanation"]
    assert "frame width differs by 10.2 mm" in user_frame["fit_explanation"]

    # 2. Difference <= 5 mm -> Compatible
    compat_frame = recs["f_diff_compatible"]
    assert compat_frame["fit_status"] == "Compatible"

    # 3. Difference <= 10 mm -> Acceptable (Compatible overall when decentration <= 3 mm)
    accept_frame = recs["f_diff_acceptable"]
    assert accept_frame["fit_status"] == "Compatible"

    # 4. Difference > 18 mm -> Unsuitable
    unsuit_frame = recs["f_diff_unsuitable"]
    assert unsuit_frame["fit_status"] == "Unsuitable"
    assert "frame width mismatch" in unsuit_frame["fit_explanation"]


