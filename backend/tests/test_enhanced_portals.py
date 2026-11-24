import datetime
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_01_customer_profile_update():
    """Verify customer profile can be updated at any time (name, mobile, email, address)."""
    # 1. Login or register a test customer
    reg_payload = {
        "name": "Dev Test Customer",
        "mobile": "9876543299",
        "email": "devtestcust@eyereach.com",
        "address": "Initial Address 101, Indiranagar",
        "password": "password123"
    }
    client.post("/api/customer/register", json=reg_payload)

    login_res = client.post("/api/customer/login", json={"email": "devtestcust@eyereach.com", "password": "password123"})
    assert login_res.status_code == 200, login_res.text
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Update profile
    update_payload = {
        "name": "Dev Test Customer Updated",
        "mobile": "9876543299",
        "email": "devtestcust@eyereach.com",
        "address": "Penthouse 909, UB City, Vittal Mallya Road, Bengaluru"
    }
    up_res = client.put("/api/customer/profile", json=update_payload, headers=headers)
    assert up_res.status_code == 200, up_res.text
    up_data = up_res.json()
    assert up_data["status"] == "success"
    assert up_data["customer"]["name"] == "Dev Test Customer Updated"
    assert up_data["customer"]["address"] == "Penthouse 909, UB City, Vittal Mallya Road, Bengaluru"

    # 3. Verify via /api/customer/me
    me_res = client.get("/api/customer/me", headers={"Authorization": f"Bearer {up_data['token']}"})
    assert me_res.status_code == 200
    assert me_res.json()["customer"]["name"] == "Dev Test Customer Updated"
    assert me_res.json()["customer"]["address"] == "Penthouse 909, UB City, Vittal Mallya Road, Bengaluru"

def test_02_wishlist_and_cart_multi_shop_and_max_10_trial():
    """Verify wishlist to cart transfer, max 10 trial frames enforcement, and multi-shop split checkout."""
    login_res = client.post("/api/customer/login", json={"email": "devtestcust@eyereach.com", "password": "password123"})
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Get available products
    prods_res = client.get("/api/customer/products")
    products = [p for p in prods_res.json() if p.get("stock_quantity", 0) > 0]
    assert len(products) >= 2, "Expected at least 2 in-stock products in catalog"

    p1 = products[0]
    p2 = products[1]

    # Save p1 to wishlist picks
    client.post("/api/customer/picks/toggle", json={
        "customer_mobile": "9876543299",
        "product_id": p1["id"],
        "name": p1["name"],
        "price": p1["price"],
        "front_image": p1["front_image"]
    }, headers=headers)

    # Move from wishlist to cart
    move_res = client.post("/api/customer/cart/move-from-wishlist", json={
        "product_id": p1["id"],
        "customer_mobile": "9876543299"
    }, headers=headers)
    assert move_res.status_code == 200, move_res.text
    assert move_res.json()["status"] == "success"

    # Add p2 to cart directly
    add_res = client.post("/api/customer/cart", json={
        "product_id": p2["id"],
        "quantity": 1,
        "selected_for_trial": True,
        "customer_mobile": "9876543299"
    }, headers=headers)
    assert add_res.status_code == 200, add_res.text

    # View cart
    cart_res = client.get("/api/customer/cart", params={"customer_mobile": "9876543299"}, headers=headers)
    assert cart_res.status_code == 200
    cart_data = cart_res.json()
    assert cart_data["status"] == "success"
    assert cart_data["total_items"] >= 2
    # Verify each item displays optical shop supplier name and clear prices
    for item in cart_data["items"]:
        assert "shop" in item
        assert "shop_name" in item["shop"]
        assert item["price"] > 0
        assert item["line_total"] > 0

    # Test max 10 trial frames validation
    over_limit_ids = [i for i in range(1, 13)] # 12 items > 10
    limit_res = client.post("/api/customer/cart/set-trial-selection", json={
        "selected_product_ids": over_limit_ids,
        "customer_mobile": "9876543299"
    }, headers=headers)
    assert limit_res.status_code == 400
    assert "maximum 10 frames" in limit_res.json()["detail"].lower()

    # Checkout cart with multi-shop split
    checkout_res = client.post("/api/customer/cart/checkout", json={
        "customer_name": "Dev Test Customer Updated",
        "customer_phone": "9876543299",
        "customer_address": "Penthouse 909, UB City, Bengaluru",
        "has_prescription": True,
        "prescription_text": "OD: -1.50 SPH, OS: -1.25 SPH",
        "is_home_trial": True
    }, headers=headers)
    assert checkout_res.status_code == 200, checkout_res.text
    check_data = checkout_res.json()
    assert check_data["status"] == "success"
    assert check_data["total_orders"] >= 2
    # Orders are divided so each shop receives only its own frames
    shop_ids_in_order = [o["shop_id"] for o in check_data["orders"]]
    assert len(shop_ids_in_order) >= 1

    # Verify cart is cleared after checkout
    after_cart = client.get("/api/customer/cart", params={"customer_mobile": "9876543299"}, headers=headers)
    assert after_cart.json()["total_items"] == 0

def test_03_two_distinct_home_services():
    """Verify Service A (Frame Trial Only), Service B (Vision Test Only), and Combined service requests."""
    future_date = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()

    # 1. Service A: Frame Selection Home Visit Only
    service_a_payload = {
        "service_type": "frame_trial",
        "appointment_date": future_date,
        "appointment_time": "11:00 AM",
        "full_name": "Aarav Mehta",
        "mobile_number": "9811223344",
        "email": "aarav@gmail.com",
        "home_address": "Koramangala 4th Block, Bengaluru",
        "purpose": "Doorstep Frame Selection & Fitting",
        "selected_frames": [
            {"product_id": "FR001", "name": "Classic Round Acetate", "price": 1800.0, "brand": "Ray-Ban"},
            {"product_id": "FR002", "name": "Executive Rectangle Titanium", "price": 2499.0, "brand": "Oakley"}
        ]
    }
    res_a = client.post("/api/customer/home-services/book", json=service_a_payload)
    assert res_a.status_code == 200, res_a.text
    data_a = res_a.json()
    assert data_a["status"] == "success"
    assert data_a["service_type"] == "frame_trial"
    assert data_a["selected_frames_count"] == 2

    # 2. Service B - Option 1: Existing prescription provided (no test required)
    service_b_opt1 = {
        "service_type": "vision_test",
        "appointment_date": future_date,
        "appointment_time": "02:30 PM",
        "full_name": "Ananya Iyer",
        "mobile_number": "9822334455",
        "email": "ananya@gmail.com",
        "home_address": "Indiranagar, Bengaluru",
        "has_prescription": True,
        "prescription_data": {
            "sph_od": -2.0, "cyl_od": -0.5, "axis_od": 90, "sph_os": -2.25, "cyl_os": -0.25, "axis_os": 85
        },
        "purpose": "Frame Fitting with Existing Valid Prescription"
    }
    res_b1 = client.post("/api/customer/home-services/book", json=service_b_opt1)
    assert res_b1.status_code == 200, res_b1.text
    data_b1 = res_b1.json()
    assert data_b1["has_prescription"] is True

    # 3. Service B - Option 2: New Vision Test Requested with in-shop Optometrist
    service_b_opt2 = {
        "service_type": "vision_test",
        "appointment_date": future_date,
        "appointment_time": "04:00 PM",
        "full_name": "Rohan Gupta",
        "mobile_number": "9833445566",
        "email": "rohan@eyereach.com",
        "home_address": "Whitefield, Bengaluru",
        "has_prescription": False,
        "purpose": "Comprehensive Home Eye & Vision Exam"
    }
    res_b2 = client.post("/api/customer/home-services/book", json=service_b_opt2)
    assert res_b2.status_code == 200, res_b2.text
    data_b2 = res_b2.json()
    assert data_b2["appointment_id"].startswith("HS-")

    # 4. Enforce Max 10 frames rule
    over_10_frames = [{"product_id": f"FR{i}", "name": f"Frame {i}", "price": 1000} for i in range(12)]
    invalid_frames_payload = service_a_payload.copy()
    invalid_frames_payload["selected_frames"] = over_10_frames
    res_invalid = client.post("/api/customer/home-services/book", json=invalid_frames_payload)
    assert res_invalid.status_code == 400
    assert "maximum 10" in res_invalid.json()["detail"].lower()

def test_04_optical_shop_portal_workflow():
    """Verify Optical Shop Owner Portal profile, orders, home trial management, and optometrist prescription entry."""
    # 1. Login as Shop Owner (VisionCraft)
    login_res = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"})
    assert login_res.status_code == 200, login_res.text
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Update Shop Profile with operating hours & home visit availability
    up_prof = client.put("/api/shop/profile", json={
        "operating_hours": "08:30 AM - 09:00 PM, All 7 Days",
        "home_visit_available": True
    }, headers=headers)
    assert up_prof.status_code == 200
    assert up_prof.json()["shop"]["operating_hours"] == "08:30 AM - 09:00 PM, All 7 Days"
    assert up_prof.json()["shop"]["home_visit_available"] is True

    # 3. List Orders
    orders_res = client.get("/api/shop/orders", headers=headers)
    assert orders_res.status_code == 200
    orders = orders_res.json()
    assert len(orders) > 0
    first_order = orders[0]

    # 4. Progress Order: Accept -> Preparing Lenses -> Dispatched -> Delivered
    patch_res = client.patch(f"/api/shop/orders/{first_order['id']}/status", json={"status": "Preparing Lenses"}, headers=headers)
    assert patch_res.status_code == 200
    assert patch_res.json()["order_status"] == "Preparing Lenses"

    # Test rejection with reason
    rej_res = client.patch(f"/api/shop/orders/{first_order['id']}/status", json={
        "status": "Rejected",
        "rejection_reason": "Requested lens power out of raw cylinder range for this frame size"
    }, headers=headers)
    assert rej_res.status_code == 200
    assert rej_res.json()["rejection_reason"] == "Requested lens power out of raw cylinder range for this frame size"

    # 5. Home Frame Selection Management
    trials_res = client.get("/api/shop/home-trials", headers=headers)
    assert trials_res.status_code == 200
    trials = trials_res.json()
    assert len(trials) > 0
    target_trial = trials[0]

    # Accept home trial
    trial_up = client.put(f"/api/shop/home-trials/{target_trial['id']}/status", json={"status": "Accepted"}, headers=headers)
    assert trial_up.status_code == 200
    assert trial_up.json()["visit_status"] == "Accepted"

    # Record final frame selection by customer
    final_res = client.put(f"/api/shop/home-trials/{target_trial['id']}/final-frame", json={
        "final_selected_frame_id": "FR001",
        "frame_name": "Classic Round Acetate"
    }, headers=headers)
    assert final_res.status_code == 200
    assert final_res.json()["visit_status"] == "Final Frame Selected"

    # 6. Vision Test & Optometrist Management
    optoms_res = client.get("/api/shop/optometrists", headers=headers)
    assert optoms_res.status_code == 200
    optoms = optoms_res.json()["optometrists"]
    assert len(optoms) > 0
    optom = optoms[0]

    # Update optometrist availability
    optom_up = client.put(f"/api/shop/optometrists/{optom['id']}", json={
        "available_days": "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
        "available_hours": "09:00 AM - 07:00 PM",
        "is_available": True
    }, headers=headers)
    assert optom_up.status_code == 200
    assert optom_up.json()["optometrist"]["available_hours"] == "09:00 AM - 07:00 PM"

    # List vision test appointment requests
    tests_res = client.get("/api/shop/vision-tests", headers=headers)
    assert tests_res.status_code == 200
    vtests = tests_res.json()
    assert len(vtests) > 0
    vtest = vtests[0]

    # Assign optometrist
    assign_res = client.put(f"/api/shop/vision-tests/{vtest['id']}/assign", json={"doctor_id": optom["id"]}, headers=headers)
    assert assign_res.status_code == 200
    assert assign_res.json()["doctor_id"] == optom["id"]

    # Record actual confirmed exam prescription (real values from actual exam, never fabricated)
    rx_record_res = client.post(f"/api/shop/vision-tests/{vtest['id']}/record-prescription", json={
        "sph_od": -1.75,
        "cyl_od": -0.50,
        "axis_od": 90,
        "add_od": 1.25,
        "sph_os": -2.00,
        "cyl_os": -0.25,
        "axis_os": 80,
        "add_os": 1.25,
        "ipd_mm": 63.5,
        "notes": "Subjective refraction completed with cross-cylinder refinement. Best corrected visual acuity 6/6 OU."
    }, headers=headers)
    assert rx_record_res.status_code == 200
    rx_data = rx_record_res.json()
    assert rx_data["status"] == "success"
    assert rx_data["prescription"]["right_eye_od"]["sph"] == -1.75
    assert rx_data["prescription"]["left_eye_os"]["sph"] == -2.00

def test_05_customer_notifications_and_reminders():
    """Verify customer receives notifications for orders, home visits, and periodic eye checkup reminders."""
    login_res = client.post("/api/customer/login", json={"email": "devtestcust@eyereach.com", "password": "password123"})
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    notifs_res = client.get("/api/customer/notifications", params={"customer_mobile": "9876543299"}, headers=headers)
    assert notifs_res.status_code == 200
    notifs_data = notifs_res.json()
    assert notifs_data["status"] == "success"
    assert len(notifs_data["notifications"]) > 0

    # Schedule a 6-month checkup reminder
    rem_res = client.post("/api/customer/reminders/checkup", params={"months": 6, "customer_mobile": "9876543299"}, headers=headers)
    assert rem_res.status_code == 200
    assert rem_res.json()["status"] == "success"
