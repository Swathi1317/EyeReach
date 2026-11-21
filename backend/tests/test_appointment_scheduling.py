import datetime
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import get_db, SessionLocal
from backend.app.db.models import Appointment

client = TestClient(app)

def test_01_create_meeting_appointment():
    future_date = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    payload = {
        "appointment_type": "Schedule a Meeting",
        "full_name": "Kavita Singhania",
        "mobile_number": "9812345678",
        "email": "kavita.s@example.com",
        "appointment_date": future_date,
        "appointment_time": "11:30 AM",
        "meeting_mode": "Online",
        "purpose": "Frame Styling Consultation & Fit Guidance",
        "additional_message": "Interested in cat-eye acetate frames"
    }
    response = client.post("/api/appointments", json=payload)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["appointment_id"].startswith("ER-")
    assert data["appointment_type"] == "meeting"
    assert data["full_name"] == "Kavita Singhania"
    assert data["meeting_mode"] == "Online"
    assert data["home_address"] is None
    assert data["status"] == "Confirmed"

def test_02_create_home_testing_appointment():
    future_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    payload = {
        "appointment_type": "Schedule a Home Testing Appointment",
        "full_name": "Ramesh Gupta",
        "mobile_number": "9876541230",
        "email": "ramesh.gupta@example.com",
        "appointment_date": future_date,
        "appointment_time": "02:00 PM",
        "home_address": "House No. 58, 4th Cross, Indiranagar, Bengaluru, 560038",
        "purpose": "Comprehensive Home Eye & Vision Exam",
        "additional_message": "Senior citizen examination"
    }
    response = client.post("/api/appointments", json=payload)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["appointment_id"].startswith("ER-")
    assert data["appointment_type"] == "home_testing"
    assert data["full_name"] == "Ramesh Gupta"
    assert data["home_address"] == "House No. 58, 4th Cross, Indiranagar, Bengaluru, 560038"
    assert data["meeting_mode"] is None

def test_03_past_date_rejection():
    past_date = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    payload = {
        "appointment_type": "Schedule a Meeting",
        "full_name": "Past Date Tester",
        "mobile_number": "9999999999",
        "email": "past@example.com",
        "appointment_date": past_date,
        "appointment_time": "10:00 AM",
        "purpose": "Test"
    }
    response = client.post("/api/appointments", json=payload)
    assert response.status_code == 400
    assert "cannot be in the past" in response.json()["detail"].lower()

def test_04_missing_home_address_rejection():
    future_date = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    payload = {
        "appointment_type": "Schedule a Home Testing Appointment",
        "full_name": "No Address Tester",
        "mobile_number": "9999999999",
        "email": "noaddress@example.com",
        "appointment_date": future_date,
        "appointment_time": "10:00 AM",
        "home_address": "", # Missing required address
        "purpose": "Home Eye Exam"
    }
    response = client.post("/api/appointments", json=payload)
    assert response.status_code == 400
    assert "home address is required" in response.json()["detail"].lower()

def test_05_list_and_get_appointment_by_id():
    # 1. List appointments
    list_res = client.get("/api/appointments")
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) >= 2

    # 2. Get specific appointment by ID
    target_id = items[0]["appointment_id"]
    get_res = client.get(f"/api/appointments/{target_id}")
    assert get_res.status_code == 200
    detail = get_res.json()
    assert detail["appointment_id"] == target_id
    assert detail["status"] == "Confirmed"
