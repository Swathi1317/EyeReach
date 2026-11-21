import datetime
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_01_toggle_frame_pick_and_persistence():
    """Verify customer can add and remove frames from 'My Frame Picks ❤️' with SQLite persistence."""
    from backend.app.db.database import SessionLocal
    from backend.app.db.models import Customer
    db = SessionLocal()
    first_cust = db.query(Customer).first()
    mobile = first_cust.mobile if first_cust else "9988776655"
    db.close()
    
    # Ensure clean slate for idempotent testing
    client.post("/api/customer/picks/remove", json={"customer_mobile": mobile, "product_id": 901})
    client.post("/api/customer/picks/remove", json={"customer_mobile": mobile, "product_id": 902})
    
    # Toggle 1: Add Black Round frame
    payload1 = {
        "customer_mobile": mobile,
        "product_id": 901,
        "brand": "EyeReach Classic",
        "name": "Oxford Matte",
        "shape": "Round",
        "color": "Black",
        "price": 2499,
        "material": "Acetate",
        "front_image": "/frames/frame_001.svg"
    }
    res1 = client.post("/api/customer/picks/toggle", json=payload1)
    assert res1.status_code == 200, res1.text
    data1 = res1.json()
    assert data1["status"] == "success"
    assert data1["action"] == "added"
    assert any(str(p["product_id"]) == "901" for p in data1["picks"])

    # Verify via GET /api/customer/picks
    get_res1 = client.get("/api/customer/picks", params={"customer_mobile": mobile})
    assert get_res1.status_code == 200
    picks = get_res1.json()["picks"]
    assert any(str(p["product_id"]) == "901" for p in picks)
    saved_pick = next(p for p in picks if str(p["product_id"]) == "901")
    assert saved_pick["name"] == "Oxford Matte"
    assert saved_pick["shape"] == "Round"
    assert saved_pick["color"] == "Black"
    assert saved_pick["price"] == 2499

    # Toggle 2: Add second frame
    payload2 = {
        "customer_mobile": mobile,
        "product_id": 902,
        "brand": "EyeReach Modern",
        "name": "Cambridge Square",
        "shape": "Square",
        "color": "Brown",
        "price": 2899,
        "material": "Acetate",
        "front_image": "/frames/frame_002.svg"
    }
    res2 = client.post("/api/customer/picks/toggle", json=payload2)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["action"] == "added"
    assert len(data2["picks"]) >= 2

    # Toggle 3: Toggle Oxford Matte again -> should remove it
    res3 = client.post("/api/customer/picks/toggle", json=payload1)
    assert res3.status_code == 200
    data3 = res3.json()
    assert data3["action"] == "removed"
    assert not any(str(p["product_id"]) == "901" for p in data3["picks"])
    assert any(str(p["product_id"]) == "902" for p in data3["picks"])

    # Explicit remove endpoint test
    rem_res = client.post("/api/customer/picks/remove", json={"customer_mobile": mobile, "product_id": 902})
    assert rem_res.status_code == 200
    assert not any(str(p["product_id"]) == "902" for p in rem_res.json()["picks"])


def test_02_home_visit_appointment_with_selected_frames():
    """Verify booking Home Visit Appointment with selected frames attached."""
    future_date = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()
    selected_frames = [
        {
            "product_id": 101,
            "brand": "EyeReach Atelier",
            "name": "Nordic Round",
            "shape": "Round",
            "color": "Black",
            "price": 2599,
            "material": "Italian Acetate",
            "front_image": "/frames/frame_001.svg"
        },
        {
            "product_id": 102,
            "brand": "EyeReach Bold",
            "name": "Metropolitan Square",
            "shape": "Square",
            "color": "Brown",
            "price": 3199,
            "material": "TR90 Flex",
            "front_image": "/frames/frame_002.svg"
        }
    ]

    payload = {
        "appointment_type": "Schedule a Home Testing Appointment",
        "full_name": "Meera Krishnan",
        "mobile_number": "9845012345",
        "email": "meera.k@example.com",
        "appointment_date": future_date,
        "appointment_time": "11:00 AM",
        "home_address": "Flat 402, Green Glen Layout, Bellandur, Bengaluru - 560103",
        "purpose": "Doorstep Spectacle Trial & Frame Fitting Verification",
        "additional_message": "Please bring frames suitable for high myopia prescription",
        "selected_frames": selected_frames
    }

    res = client.post("/api/appointments", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["appointment_id"].startswith("ER-")
    assert data["appointment_type"] == "home_testing"
    assert data["appointment_type_label"] == "Home Testing / Home Visit Appointment"
    assert data["home_address"] == "Flat 402, Green Glen Layout, Bellandur, Bengaluru - 560103"
    assert data["meeting_mode"] is None
    
    # Check attached frames in confirmation
    assert len(data["selected_frames"]) == 2
    assert data["selected_frames"][0]["name"] == "Nordic Round"
    assert data["selected_frames"][1]["name"] == "Metropolitan Square"

    # Verify retrieval by ID retains selected_frames
    appt_id = data["appointment_id"]
    get_res = client.get(f"/api/appointments/{appt_id}")
    assert get_res.status_code == 200
    appt_data = get_res.json()
    assert len(appt_data["selected_frames"]) == 2
    assert appt_data["selected_frames"][0]["shape"] == "Round"
    assert appt_data["selected_frames"][1]["shape"] == "Square"


def test_03_shopkeeper_customer_frame_preferences_and_privacy():
    """Verify shopkeeper customer frame preferences API and customer privacy guarantee."""
    res = client.get("/api/shop/customer-frame-preferences")
    assert res.status_code == 200, res.text
    data = res.json()
    
    assert data["status"] == "success"
    assert data["total_likes"] >= 100
    assert data["unique_customers"] >= 40
    assert len(data["most_liked_models"]) > 0
    assert len(data["popular_shapes"]) > 0
    assert len(data["popular_colors"]) > 0
    assert len(data["top_combinations"]) > 0

    # Verify top combinations match demand patterns
    combo_labels = [c["label"] for c in data["top_combinations"]]
    assert any("Black Round" in c for c in combo_labels)
    assert any("Square" in c for c in combo_labels)
    assert any("Cat-Eye" in c or "Cat Eye" in c for c in combo_labels)

    # Privacy Protection Verification:
    # Zero customer names, phone numbers, or residential addresses should be in the preferences output
    response_text = res.text
    assert "mobile_number" not in response_text
    assert "home_address" not in response_text
    assert "customer_name" not in response_text
    assert data["privacy_notice"] is not None
    assert "customer privacy protected" in data["privacy_notice"].lower()
    assert "anonymized aggregate" in data["privacy_notice"].lower()


def test_04_shopkeeper_home_appointments_with_trial_frames():
    """Verify shopkeeper endpoint returns home visit appointments with customer's selected trial frames."""
    res = client.get("/api/shop/home-appointments")
    assert res.status_code == 200, res.text
    data = res.json()
    appointments = data if isinstance(data, list) else data.get("appointments", [])
    assert len(appointments) > 0
    
    # Check that at least one appointment contains selected_frames
    has_frames = any(len(a.get("selected_frames", [])) > 0 for a in appointments)
    assert has_frames
