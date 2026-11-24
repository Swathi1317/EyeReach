import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import get_db, Base
from backend.app.db.models import Customer, Product, Shop, Order, Appointment
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

client = TestClient(app)

def test_customer_order_delivery_workflow_and_received_confirmation():
    # 1. Fetch available products
    prod_resp = client.get("/api/customer/products")
    assert prod_resp.status_code == 200
    prods = prod_resp.json()
    assert len(prods) > 0
    p = prods[0]

    # 2. Add to cart
    test_mobile = "9988776655"
    add_resp = client.post("/api/customer/cart", json={
        "product_id": p["id"],
        "quantity": 1,
        "selected_for_trial": False,
        "customer_mobile": test_mobile
    })
    assert add_resp.status_code == 200

    # 3. Checkout
    checkout_resp = client.post("/api/customer/cart/checkout", json={
        "customer_name": "Test Order Customer",
        "customer_phone": test_mobile,
        "customer_email": "testorder@eyereach.app",
        "customer_address": "123 Delivery St, Apt 4B, Chennai 600001",
        "notes": "Testing order delivery progression"
    })
    assert checkout_resp.status_code == 200
    data = checkout_resp.json()
    assert data["status"] == "success"
    assert len(data["orders"]) > 0
    order_num = data["orders"][0]["order_number"]

    # 4. Query Customer Orders
    orders_resp = client.get(f"/api/customer/orders?customer_mobile={test_mobile}")
    assert orders_resp.status_code == 200
    orders_data = orders_resp.json()
    assert orders_data["status"] == "success"
    assert orders_data["total"] > 0
    
    matching_order = next((o for o in orders_data["orders"] if o["order_number"] == order_num), None)
    assert matching_order is not None
    # Initial status is synchronized to "Order Placed"
    assert matching_order["status"] in ["Order Placed", "Pending"]
    order_id = matching_order["id"]

    # 5. Confirm Delivery Receipt by Customer
    recv_resp = client.patch(f"/api/customer/orders/{order_id}/received?customer_mobile={test_mobile}")
    assert recv_resp.status_code == 200
    recv_data = recv_resp.json()
    assert recv_data["status"] == "success"
    assert recv_data["order_status"] == "Customer Received"

    # 6. Re-check orders list to verify status synchronization
    updated_orders = client.get(f"/api/customer/orders?customer_mobile={test_mobile}").json()
    updated_order = next(o for o in updated_orders["orders"] if o["id"] == order_id)
    assert updated_order["status"] == "Customer Received"

def test_home_service_three_distinct_choices():
    test_mobile = "9876543210"
    
    # Choice A: Frame Trial at Home (Only)
    trial_resp = client.post("/api/customer/home-services/book", json={
        "service_type": "frame_trial",
        "appointment_date": "2026-12-01",
        "appointment_time": "10:30 AM",
        "full_name": "Trial Customer",
        "mobile_number": test_mobile,
        "email": "trial@example.com",
        "home_address": "45 Frame Trial Ave, Anna Nagar, Chennai",
        "selected_frames": [{"product_id": 1, "name": "Frame A"}]
    })
    assert trial_resp.status_code == 200
    t_data = trial_resp.json()
    assert t_data["status"] == "success"
    assert t_data["service_type"] == "frame_trial"
    assert t_data["appointment_id"].startswith("HS-FT-")

    # Choice B: Home Vision Test (Only)
    vision_resp = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": "2026-12-02",
        "appointment_time": "02:30 PM",
        "full_name": "Vision Customer",
        "mobile_number": test_mobile,
        "email": "vision@example.com",
        "home_address": "88 Vision Road, T Nagar, Chennai",
        "has_prescription": True,
        "prescription_data": {"sph_od": -1.5, "sph_os": -1.25}
    })
    assert vision_resp.status_code == 200
    v_data = vision_resp.json()
    assert v_data["status"] == "success"
    assert v_data["service_type"] == "vision_test"
    assert v_data["appointment_id"].startswith("HS-VT-")

    # Choice C: Both Services (Creates TWO separate appointments with independent statuses)
    both_resp = client.post("/api/customer/home-services/book", json={
        "service_type": "both",
        "appointment_date": "2026-12-03",
        "appointment_time": "11:00 AM",
        "full_name": "Combo Customer",
        "mobile_number": test_mobile,
        "email": "combo@example.com",
        "home_address": "12 Dual Service Blvd, Adyar, Chennai",
        "selected_frames": [{"product_id": 1, "name": "Frame A"}, {"product_id": 2, "name": "Frame B"}],
        "has_prescription": False
    })
    assert both_resp.status_code == 200
    b_data = both_resp.json()
    assert b_data["status"] == "success"
    assert b_data["service_type"] == "both"
    assert "appointments" in b_data
    assert len(b_data["appointments"]) == 2
    appts = b_data["appointments"]
    trial_appt = next(a for a in appts if a["service_type"] == "frame_trial")
    vision_appt = next(a for a in appts if a["service_type"] == "vision_test")
    assert trial_appt["appointment_id"].startswith("HS-FT-")
    assert vision_appt["appointment_id"].startswith("HS-VT-")
    assert trial_appt["selected_frames_count"] == 2
