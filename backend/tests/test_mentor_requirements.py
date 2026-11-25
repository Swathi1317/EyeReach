import pytest
import datetime
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import SessionLocal
from backend.app.db.models import Customer, Product, Shop, Order, CartItem, Appointment, Doctor, CustomerNotification
from backend.app.routers.shop_auth import create_access_token

client = TestClient(app)

@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_next_working_date(offset_days=1):
    """Returns a date string for a future working day (Mon-Sat)."""
    d = datetime.date.today() + datetime.timedelta(days=offset_days)
    while d.weekday() == 6: # Skip Sunday
        d += datetime.timedelta(days=1)
    return d.strftime("%Y-%m-%d")

def test_available_slots_endpoint():
    """Requirement 5: Test dynamic available slots generation."""
    working_date = get_next_working_date(1)
    res = client.get(f"/api/customer/available-slots?date={working_date}")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["date"] == working_date
    assert len(data["slots"]) >= 5
    first_slot = data["slots"][0]
    assert "slot_time" in first_slot
    assert "is_available" in first_slot
    assert "remaining_capacity" in first_slot
    assert "total_capacity" in first_slot

    # Test past date
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    res_past = client.get(f"/api/customer/available-slots?date={yesterday}")
    assert res_past.status_code == 200
    data_past = res_past.json()
    assert data_past["is_past"] is True
    assert all(s["is_available"] is False for s in data_past["slots"])

def test_booking_and_double_booking_prevention(db_session):
    """Requirement 5: Double-booking prevention for same slot and customer."""
    test_mob = "9888877771"
    target_date = get_next_working_date(2)
    target_slot = "10:30 AM"

    # Cleanup any prior test appointments on this slot and customer
    db_session.query(Appointment).filter(
        (Appointment.mobile_number == test_mob) |
        ((Appointment.appointment_date == target_date) & (Appointment.appointment_time == target_slot))
    ).delete()
    db_session.commit()

    # 1. Book first appointment
    payload = {
        "service_type": "vision_test",
        "appointment_date": target_date,
        "appointment_time": target_slot,
        "full_name": "Test Customer One",
        "mobile_number": test_mob,
        "email": "testcustomer1@eyereach.com",
        "home_address": "Flat 101, Test Apartments, Bangalore",
        "has_prescription": False
    }
    res1 = client.post("/api/customer/home-services/book", json=payload)
    assert res1.status_code == 200
    appt_id = res1.json()["appointment_id"]
    assert "HS-VT" in appt_id

    # 2. Same customer attempts to book the exact same slot again -> Rejection
    res_duplicate = client.post("/api/customer/home-services/book", json=payload)
    assert res_duplicate.status_code == 400
    assert "already have an active" in res_duplicate.json()["detail"].lower()

def test_customer_cancellation_and_rescheduling(db_session):
    """Requirement 5: Customer can reschedule and cancel appointments, freeing capacity."""
    test_mob = "9888877772"
    d1 = get_next_working_date(1)
    d2 = get_next_working_date(3)
    slot = "10:30 AM"

    # Clean up prior appointments for this test number
    db_session.query(Appointment).filter(Appointment.mobile_number == test_mob).delete()
    db_session.commit()

    # Book an appointment
    res = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": d1,
        "appointment_time": slot,
        "full_name": "Reschedule Customer",
        "mobile_number": test_mob,
        "email": "reschedule@eyereach.com",
        "home_address": "123 Residency Road, Bengaluru",
        "has_prescription": False
    })
    assert res.status_code == 200

    appt = db_session.query(Appointment).filter(Appointment.mobile_number == test_mob).order_by(Appointment.id.desc()).first()
    assert appt is not None

    # Reschedule to d2
    res_resched = client.put(f"/api/customer/appointments/{appt.id}/reschedule", json={
        "new_date": d2,
        "new_time": slot,
        "reason": "Traveling on earlier date"
    })
    assert res_resched.status_code == 200
    data_resched = res_resched.json()
    assert data_resched["status"] == "Rescheduled"
    assert data_resched["appointment_date"] == d2

    # Cancel the appointment
    res_cancel = client.put(f"/api/customer/appointments/{appt.id}/cancel", json={
        "reason": "Need to change plans"
    })
    assert res_cancel.status_code == 200
    data_cancel = res_cancel.json()
    assert data_cancel["status"] == "Cancelled"

    # Verify db status
    db_session.refresh(appt)
    assert appt.status == "Cancelled"

def test_optometrist_isolation_and_role_security(db_session):
    """Requirement 6 & 9: Optometrists see only assigned appointments; owner endpoints return 403."""
    # Find or seed a doctor linked to shop 1
    doc = db_session.query(Doctor).filter(Doctor.is_active == True).first()
    assert doc is not None
    shop_id = doc.shop_id or 1

    # Generate an Optometrist token
    optom_token = create_access_token({
        "shop_id": shop_id,
        "optometrist_id": doc.id,
        "email": doc.email,
        "role": "optometrist"
    })
    headers = {"Authorization": f"Bearer {optom_token}"}

    # 1. Optometrist accessing vision tests: must be filtered to their doctor_id
    res_vts = client.get("/api/shop/vision-tests", headers=headers)
    assert res_vts.status_code == 200
    vts = res_vts.json()
    for v in vts:
        assert v["doctor_id"] == doc.id

    # 2. Optometrist accessing home trials: must be filtered to their doctor_id
    res_trials = client.get("/api/shop/home-trials", headers=headers)
    assert res_trials.status_code == 200
    trials = res_trials.json()
    for t in trials:
        assert t["doctor_id"] == doc.id

    # 3. Owner-only endpoints must return 403 Forbidden for Optometrist
    # Product price update
    res_price = client.patch("/api/shop/products/1/price", json={"price": 1999.0}, headers=headers)
    assert res_price.status_code == 403

    # Product stock update
    res_stock = client.patch("/api/shop/products/1/stock", json={"stock_quantity": 25}, headers=headers)
    assert res_stock.status_code == 403

    # Orders list
    res_orders = client.get("/api/shop/orders", headers=headers)
    assert res_orders.status_code == 403

    # Customer list
    res_custs = client.get("/api/shop/customers", headers=headers)
    assert res_custs.status_code == 403

    # Add new doctor
    res_add_doc = client.post("/api/shop/doctors", json={
        "name": "Dr. Hacker",
        "email": "hacker@test.com",
        "mobile": "9999900000",
        "password": "pass"
    }, headers=headers)
    assert res_add_doc.status_code == 403

    # Optometrist dashboard stats: hides store revenue
    res_stats = client.get("/api/shop/dashboard/stats", headers=headers)
    assert res_stats.status_code == 200
    stats = res_stats.json()
    assert stats["caller_role"] == "optometrist"
    assert stats["sales_overview"]["total_revenue"] == 0.0

def test_vision_test_approval_and_rejection_workflow(db_session):
    """Requirement 7: Shop owner can Approve or Reject vision tests with rejection reason."""
    shop = db_session.query(Shop).first()
    assert shop is not None
    owner_token = create_access_token({
        "shop_id": shop.id,
        "email": shop.email,
        "role": "shop_owner"
    })
    headers = {"Authorization": f"Bearer {owner_token}"}

    # Create a fresh pending vision test
    tomorrow = get_next_working_date(1)
    appt = Appointment(
        appointment_id=f"HS-VT-TEST-{datetime.date.today().strftime('%Y%m%d')}-9999",
        appointment_type="home_testing",
        service_type="vision_test",
        shop_id=shop.id,
        full_name="Approval Workflow Customer",
        mobile_number="9888877773",
        email="approval_test@eyereach.com",
        appointment_date=tomorrow,
        appointment_time="12:00 PM",
        home_address="100 Commercial Street, Bangalore",
        purpose="Home Vision Examination",
        status="Pending",
        visit_status="Pending"
    )
    db_session.add(appt)
    db_session.commit()
    db_session.refresh(appt)

    # 1. Shop Owner approves the request
    res_appr = client.put(f"/api/shop/vision-tests/{appt.id}/status", json={"status": "Approved"}, headers=headers)
    assert res_appr.status_code == 200
    db_session.refresh(appt)
    assert appt.status == "Confirmed"
    assert appt.visit_status == "Approved"

    # 2. Shop Owner rejects the request with a reason
    reason_text = "Optometrist on emergency medical leave"
    res_rej = client.put(f"/api/shop/vision-tests/{appt.id}/status", json={
        "status": "Rejected",
        "rejection_reason": reason_text
    }, headers=headers)
    assert res_rej.status_code == 200
    db_session.refresh(appt)
    assert appt.status == "Rejected"
    assert appt.visit_status == "Rejected"
    assert appt.rejection_reason == reason_text

def test_automated_reminders_and_suggestions(db_session):
    """Requirement 8: Automated reminders and in-stock personalized suggestions."""
    # Find or create a test customer
    cust = db_session.query(Customer).filter(Customer.mobile == "9888877774").first()
    if not cust:
        cust = Customer(
            name="Reminder Test Customer",
            mobile="9888877774",
            email="reminder_test@eyereach.com",
            password_hash="testpasshash123",
            face_shape="Oval",
            last_exam_date=datetime.datetime.utcnow() - datetime.timedelta(days=400),
            reminder_interval_months=12
        )
        db_session.add(cust)
        db_session.commit()
        db_session.refresh(cust)

    # 1. Update reminder interval settings
    res_settings = client.post("/api/customer/reminders/settings", json={"reminder_interval_months": 6}, params={"customer_mobile": cust.mobile})
    assert res_settings.status_code == 200
    assert res_settings.json()["reminder_interval_months"] == 6

    # 2. Fetch notifications (triggers automated reminder synchronization)
    res_notifs = client.get("/api/customer/notifications", params={"customer_mobile": cust.mobile})
    assert res_notifs.status_code == 200
    notifs = res_notifs.json()["notifications"]
    assert len(notifs) > 0
    types = [n["notification_type"] for n in notifs]
    assert any(t in ["checkup_reminder", "reminder"] for t in types)

    # 3. Personalized In-Stock Suggestions
    res_sugg = client.get("/api/customer/personalized-suggestions", params={"customer_mobile": cust.mobile})
    assert res_sugg.status_code == 200
    data_sugg = res_sugg.json()
    assert data_sugg["status"] == "success"
    assert len(data_sugg["suggestions"]) > 0
    for s in data_sugg["suggestions"]:
        assert s["in_stock"] is True
        assert s["stock_quantity"] > 0
        assert "match_reason" in s
        assert "dimensions" in s
