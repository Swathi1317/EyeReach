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
    assert len(data["recommendations"]) == 5
    
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
