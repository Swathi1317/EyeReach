import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_recommendations_basic():
    req_data = {
        "face_shape": "Square",
        "face_shape_confidence": 0.8,
        "ipd_mm": 64.0,
        "ipd_method": "estimated",
        "skin_tone": "Medium",
        "undertone": "Neutral"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 5
    
    # Check score limits and sorting
    prev_score = 101.0
    for rec in data["recommendations"]:
        assert 0.0 <= rec["final_score"] <= 100.0
        assert rec["final_score"] <= prev_score
        prev_score = rec["final_score"]
        
        # Check reasons
        assert "Square face" in rec["reason"]
        
def test_recommendations_oval():
    req_data = {
        "face_shape": "Oval",
        "face_shape_confidence": 0.9,
        "ipd_mm": 60.0,
        "ipd_method": "calibrated",
        "skin_tone": "Deep",
        "undertone": "Warm"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    for rec in response.json()["recommendations"]:
        assert "Oval face" in rec["reason"]

def test_recommendations_invalid_input():
    response = client.post("/api/recommendations", json={})
    assert response.status_code == 422 # Validation error

def test_recommendations_preferred_color_prioritization():
    # Test that preferred_color normalizes whitespace & case, and prioritizes matching color
    req_data = {
        "face_shape": "Oval",
        "face_shape_confidence": 0.9,
        "ipd_mm": 63.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "preferred_color": "  bLaCk  " # unnormalized whitespace and case
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert len(recs) > 0
    # The top recommended frame should match the preferred color if present in catalog
    matching_recs = [r for r in recs if r["color_match"]]
    assert len(matching_recs) > 0
    first_match = matching_recs[0]
    assert first_match["color"].lower() == "black"
    assert "preferred Black color" in first_match["reason"]

def test_recommendations_budget_unlisted_price_handling():
    # Test that unlisted prices in catalog are handled transparently without inventing prices
    req_data = {
        "face_shape": "Round",
        "face_shape_confidence": 0.85,
        "ipd_mm": 62.0,
        "ipd_method": "calibrated",
        "skin_tone": "Light",
        "undertone": "Cool",
        "budget": 2500.0
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert len(recs) > 0
    for rec in recs:
        # In Kaggle catalog, prices are unlisted, so price_status must be 'unlisted' and 'price' in missing_measurements
        if rec["price"] in ["N/A", "Unavailable"]:
            assert rec["price_status"] == "unlisted"
            assert "price" in rec["missing_measurements"]

def test_recommendations_budget_known_price_exclusion(monkeypatch):
    # Test that when catalog contains known prices, items exceeding user budget are excluded
    import backend.app.routers.recommendations as rec_mod
    mock_catalog = [
        {"id": "f1", "name": "Budget Frame", "category": "Rectangle", "category_confidence": 0.8, "color": "Black", "price": 1200.0, "width_mm": 134, "lens_width_mm": 54, "bridge_width_mm": 18, "temple_length_mm": 140},
        {"id": "f2", "name": "Affordable Frame", "category": "Wayfarer", "category_confidence": 0.8, "color": "Brown", "price": 1800.0, "width_mm": 134, "lens_width_mm": 54, "bridge_width_mm": 18, "temple_length_mm": 140},
        {"id": "f3", "name": "Expensive Frame", "category": "Rectangle", "category_confidence": 0.8, "color": "Silver", "price": 4500.0, "width_mm": 134, "lens_width_mm": 54, "bridge_width_mm": 18, "temple_length_mm": 140},
    ]
    monkeypatch.setattr(rec_mod, "load_frames", lambda: mock_catalog)

    req_data = {
        "face_shape": "Round",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "budget": 2000.0
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    returned_ids = [r["id"] for r in recs]
    assert "f1" in returned_ids # 1200 <= 2000
    assert "f2" in returned_ids # 1800 <= 2000
    assert "f3" not in returned_ids # 4500 > 2000 excluded!
    # Confirm price_status is verified for known prices
    for r in recs:
        assert r["price_status"] == "verified"
        assert float(r["price"]) <= 2000.0

def test_recommendations_preferred_color_unreliable_metadata(monkeypatch):
    # Test that unreliable color metadata does not trigger false match
    import backend.app.routers.recommendations as rec_mod
    mock_catalog = [
        {"id": "f_unknown", "name": "Mystery Frame", "category": "Rectangle", "category_confidence": 0.8, "color": "Unknown", "price": None, "width_mm": 134, "lens_width_mm": 54, "bridge_width_mm": 18, "temple_length_mm": 140},
        {"id": "f_none", "name": "Empty Color Frame", "category": "Rectangle", "category_confidence": 0.8, "color": "", "price": None, "width_mm": 134, "lens_width_mm": 54, "bridge_width_mm": 18, "temple_length_mm": 140},
    ]
    monkeypatch.setattr(rec_mod, "load_frames", lambda: mock_catalog)

    req_data = {
        "face_shape": "Round",
        "face_shape_confidence": 0.85,
        "ipd_mm": 64.0,
        "ipd_method": "calibrated",
        "skin_tone": "Medium",
        "undertone": "Neutral",
        "preferred_color": "Black"
    }
    response = client.post("/api/recommendations", json=req_data)
    assert response.status_code == 200
    for r in response.json()["recommendations"]:
        assert r["color_match"] is False
        assert "matches your preferred" not in r["reason"]

