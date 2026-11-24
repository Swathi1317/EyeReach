import datetime
import json
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import SessionLocal
from backend.app.db.models import Customer, Shop, Product, Order, Appointment, Doctor, CartItem, CustomerFramePick, CustomerNotification

client = TestClient(app)

# =====================================================================
# STEP 1: VERIFY CUSTOMER PORTAL
# =====================================================================

def test_step1_1_customer_profile_persistence():
    """1. Customer profile information is saved correctly in the database."""
    unique_mob = "9900112233"
    email = "step1_profile@eyereach.com"
    
    # Register/Login
    client.post("/api/customer/register", json={
        "name": "Verification User",
        "mobile": unique_mob,
        "email": email,
        "address": "Original Address, 1st Cross, Bengaluru",
        "password": "verifyPassword123"
    })
    
    login_res = client.post("/api/customer/login", json={"email": email, "password": "verifyPassword123"})
    assert login_res.status_code == 200, login_res.text
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Update profile
    new_address = "Villa 42, Palm Meadows, Whitefield, Bengaluru - 560066"
    new_name = "Verification User Updated"
    update_res = client.put("/api/customer/profile", json={
        "name": new_name,
        "mobile": unique_mob,
        "email": email,
        "address": new_address
    }, headers=headers)
    assert update_res.status_code == 200, update_res.text
    res_data = update_res.json()
    assert res_data["status"] == "success"
    assert res_data["customer"]["address"] == new_address
    assert res_data["customer"]["name"] == new_name

    # Directly verify in DB
    db = SessionLocal()
    try:
        cust = db.query(Customer).filter(Customer.mobile == unique_mob).first()
        assert cust is not None
        assert cust.name == new_name
        assert cust.address == new_address
        assert cust.email == email
    finally:
        db.close()

def test_step1_2_customer_browse_products_multiple_shops():
    """2. Customer can browse products from multiple optical shops."""
    res = client.get("/api/customer/products")
    assert res.status_code == 200
    products = res.json()
    assert len(products) > 0

    shop_ids = set()
    for p in products:
        assert "shop_id" in p
        assert "price" in p
        assert "shape" in p
        assert "brand" in p
        assert "shop" in p
        assert "shop_name" in p["shop"]
        shop_ids.add(p["shop_id"])

    # Must contain products from multiple registered optical shops
    assert len(shop_ids) >= 2, f"Expected products from >= 2 shops, found: {shop_ids}"

def test_step1_3_product_details_and_stock_retrieved_from_db():
    """3. Product details and stock are retrieved from actual database records."""
    db = SessionLocal()
    try:
        prod = db.query(Product).first()
        assert prod is not None
        original_stock = prod.stock_quantity
        original_price = prod.price

        # Fetch via API
        api_res = client.get("/api/customer/products")
        assert api_res.status_code == 200
        api_prods = {p["id"]: p for p in api_res.json()}
        assert prod.id in api_prods
        assert api_prods[prod.id]["stock_quantity"] == original_stock
        assert api_prods[prod.id]["price"] == original_price

        # Update stock in DB directly to verify no hardcoding or stale caching
        prod.stock_quantity = 47
        db.commit()

        api_res2 = client.get("/api/customer/products")
        api_prods2 = {p["id"]: p for p in api_res2.json()}
        assert api_prods2[prod.id]["stock_quantity"] == 47

        # Revert
        prod.stock_quantity = original_stock
        db.commit()
    finally:
        db.close()

def test_step1_4_wishlist_and_cart_operations():
    """4. Wishlist and Cart operations work correctly."""
    email = "step1_profile@eyereach.com"
    mob = "9900112233"
    login_res = client.post("/api/customer/login", json={"email": email, "password": "verifyPassword123"})
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Fetch 2 in-stock products
    all_prods = client.get("/api/customer/products").json()
    in_stock = [p for p in all_prods if p.get("stock_quantity", 0) > 0]
    p1 = in_stock[0]
    p2 = in_stock[1]

    # Clean prior cart for this customer
    db = SessionLocal()
    try:
        cust = db.query(Customer).filter(Customer.mobile == mob).first()
        db.query(CartItem).filter(CartItem.customer_id == cust.id).delete()
        db.query(CustomerFramePick).filter(CustomerFramePick.customer_id == cust.id).delete()
        db.commit()
    finally:
        db.close()

    # 1. Add to wishlist
    pick_res = client.post("/api/customer/picks/toggle", json={
        "customer_mobile": mob,
        "product_id": p1["id"],
        "name": p1["name"],
        "price": p1["price"],
        "front_image": p1["front_image"]
    }, headers=headers)
    assert pick_res.status_code == 200

    # Verify wishlist has item
    picks = client.get("/api/customer/my-picks", params={"customer_mobile": mob}, headers=headers).json()
    assert any(str(pick.get("product_id")) == str(p1["id"]) for pick in picks.get("picks", []))

    # 2. Move Wishlist item to Cart
    move_res = client.post("/api/customer/cart/move-from-wishlist", json={
        "product_id": p1["id"],
        "customer_mobile": mob
    }, headers=headers)
    assert move_res.status_code == 200

    # 3. Add second item directly to Cart
    add_res = client.post("/api/customer/cart", json={
        "product_id": p2["id"],
        "quantity": 1,
        "selected_for_trial": True,
        "customer_mobile": mob
    }, headers=headers)
    assert add_res.status_code == 200

    # 4. View Cart
    cart = client.get("/api/customer/cart", params={"customer_mobile": mob}, headers=headers).json()
    assert cart["total_items"] == 2
    item1 = cart["items"][0]

    # 5. Update quantity
    up_qty = client.put(f"/api/customer/cart/{item1['id']}", json={"quantity": 3}, headers=headers)
    assert up_qty.status_code == 200
    assert up_qty.json()["item"]["quantity"] == 3

    # 6. Delete item
    del_res = client.delete(f"/api/customer/cart/{item1['id']}", headers=headers)
    assert del_res.status_code == 200

    cart_after = client.get("/api/customer/cart", params={"customer_mobile": mob}, headers=headers).json()
    assert cart_after["total_items"] == 1

def test_step1_5_maximum_10_frames_home_trial_limit():
    """5. Customers can select a maximum of 10 frames for a home trial."""
    email = "step1_profile@eyereach.com"
    mob = "9900112233"
    login_res = client.post("/api/customer/login", json={"email": email, "password": "verifyPassword123"})
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Selecting 11 frames via set-trial-selection -> Must FAIL (400)
    over_limit = client.post("/api/customer/cart/set-trial-selection", json={
        "selected_product_ids": list(range(1, 12)), # 11 items
        "customer_mobile": mob
    }, headers=headers)
    assert over_limit.status_code == 400
    assert "maximum 10 frames" in over_limit.json()["detail"].lower()

    # Selecting 10 frames -> Must SUCCEED (200)
    valid_limit = client.post("/api/customer/cart/set-trial-selection", json={
        "selected_product_ids": list(range(1, 11)), # exactly 10
        "customer_mobile": mob
    }, headers=headers)
    assert valid_limit.status_code == 200

    # Booking with 11 frames -> Must FAIL (400)
    fut_date = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    over_book = client.post("/api/customer/home-services/book", json={
        "service_type": "frame_trial",
        "appointment_date": fut_date,
        "appointment_time": "10:00 AM",
        "full_name": "Test Customer",
        "mobile_number": mob,
        "email": email,
        "home_address": "Test Address",
        "selected_frames": [{"product_id": f"P{i}", "name": f"Frame {i}", "price": 1000} for i in range(11)]
    })
    assert over_book.status_code == 400
    assert "maximum 10" in over_book.json()["detail"].lower()

    # Booking with 10 frames -> Must SUCCEED (200)
    valid_book = client.post("/api/customer/home-services/book", json={
        "service_type": "frame_trial",
        "appointment_date": fut_date,
        "appointment_time": "10:00 AM",
        "full_name": "Test Customer",
        "mobile_number": mob,
        "email": email,
        "home_address": "Test Address",
        "selected_frames": [{"product_id": f"P{i}", "name": f"Frame {i}", "price": 1000} for i in range(10)]
    })
    assert valid_book.status_code == 200
    assert valid_book.json()["selected_frames_count"] == 10

def test_step1_6_and_8_services_independent_and_together():
    """6 & 8. Frame Selection Home Visit and Home Vision Test work independently and together."""
    fut_date = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()
    mob = "9900112233"
    email = "step1_profile@eyereach.com"

    # Frame Selection Only
    res_a = client.post("/api/customer/home-services/book", json={
        "service_type": "frame_trial",
        "appointment_date": fut_date,
        "appointment_time": "11:00 AM",
        "full_name": "Independent Tester",
        "mobile_number": mob,
        "email": email,
        "home_address": "Indiranagar, Bengaluru",
        "selected_frames": [{"product_id": "FR001", "name": "Trial Frame", "price": 1500}]
    })
    assert res_a.status_code == 200
    assert res_a.json()["service_type"] == "frame_trial"
    assert res_a.json()["has_prescription"] is False

    # Vision Test Only
    res_b = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": fut_date,
        "appointment_time": "02:00 PM",
        "full_name": "Independent Tester",
        "mobile_number": mob,
        "email": email,
        "home_address": "Indiranagar, Bengaluru",
        "has_prescription": False
    })
    assert res_b.status_code == 200
    assert res_b.json()["service_type"] == "vision_test"
    assert res_b.json()["selected_frames_count"] == 0

    # Both Together
    res_both = client.post("/api/customer/home-services/book", json={
        "service_type": "both",
        "appointment_date": fut_date,
        "appointment_time": "04:30 PM",
        "full_name": "Independent Tester",
        "mobile_number": mob,
        "email": email,
        "home_address": "Indiranagar, Bengaluru",
        "has_prescription": False,
        "selected_frames": [{"product_id": "FR002", "name": "Trial Frame 2", "price": 1800}]
    })
    assert res_both.status_code == 200
    assert res_both.json()["service_type"] == "both"
    assert res_both.json()["selected_frames_count"] == 1

def test_step1_7_existing_prescription_entry_and_persistence():
    """7. Existing prescription upload and entry work correctly."""
    fut_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    mob = "9900112233"
    email = "step1_profile@eyereach.com"

    rx_payload = {
        "sph_od": -1.5, "cyl_od": -0.75, "axis_od": 85,
        "sph_os": -1.75, "cyl_os": -0.5, "axis_os": 95
    }
    res = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": fut_date,
        "appointment_time": "03:00 PM",
        "full_name": "Prescription Holder",
        "mobile_number": mob,
        "email": email,
        "home_address": "Jayanagar, Bengaluru",
        "has_prescription": True,
        "prescription_data": rx_payload
    })
    assert res.status_code == 200
    appt_id = res.json()["appointment_id"]

    # Verify in DB
    db = SessionLocal()
    try:
        appt = db.query(Appointment).filter(Appointment.appointment_id == appt_id).first()
        assert appt is not None
        assert appt.has_prescription is True
        saved_rx = json.loads(appt.prescription_data_json)
        assert saved_rx["sph_od"] == -1.5
        assert saved_rx["axis_os"] == 95
    finally:
        db.close()

def test_step1_9_customer_notifications_and_read_state():
    """9. Customer notifications display the correct status and read tracking."""
    email = "step1_profile@eyereach.com"
    mob = "9900112233"
    login_res = client.post("/api/customer/login", json={"email": email, "password": "verifyPassword123"})
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    notifs_res = client.get("/api/customer/notifications", params={"customer_mobile": mob}, headers=headers)
    assert notifs_res.status_code == 200
    data = notifs_res.json()
    assert data["status"] == "success"
    assert len(data["notifications"]) > 0

    first_notif = data["notifications"][0]
    notif_id = first_notif["id"]

    # Mark as read
    read_res = client.patch(f"/api/customer/notifications/{notif_id}/read", headers=headers)
    assert read_res.status_code == 200
    assert read_res.json()["notification"]["is_read"] is True

    # Mark all read
    all_read = client.post("/api/customer/notifications/mark-all-read", params={"customer_mobile": mob}, headers=headers)
    assert all_read.status_code == 200
    assert all_read.json()["status"] == "success"


# =====================================================================
# STEP 2: VERIFY SHOP OWNER PORTAL
# =====================================================================

def test_step2_1_and_2_shop_product_isolation_and_image_dimensions():
    """1 & 2. Each shop manages only its own products with physical dimensions and images."""
    # Login Shop 1 (VisionCraft, shop_id=1)
    s1_login = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"})
    assert s1_login.status_code == 200
    s1_token = s1_login.json()["token"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}

    # Shop 1 creates a new product with full specifications
    create_res = client.post("/api/shop/products", json={
        "product_id": "TEST-ISOLATION-01",
        "brand": "VisionCraft Exclusive",
        "name": "Titanium Zero-Gravity",
        "shape": "Rectangle",
        "material": "Titanium",
        "color": "Brushed Silver",
        "frame_type": "Rimless",
        "size": "52-18-142",
        "lens_width_mm": 52.0,
        "bridge_width_mm": 18.0,
        "temple_length_mm": 142.0,
        "price": 3499.0,
        "stock_quantity": 15,
        "gender_category": "Unisex",
        "description": "Ultra-lightweight Japanese aerospace titanium frame.",
        "front_image": "/frames/kaggle/0_mt6960_0.png",
        "side_image": "/frames/kaggle/0_mt6960_0.png"
    }, headers=s1_headers)
    assert create_res.status_code == 200, create_res.text
    p_id = create_res.json()["product"]["id"]

    # Verify directly in DB
    db = SessionLocal()
    try:
        p_db = db.query(Product).filter(Product.id == p_id).first()
        assert p_db is not None
        assert p_db.shop_id == 1
        assert p_db.lens_width_mm == 52.0
        assert p_db.stock_quantity == 15
        assert p_db.front_image == "/frames/kaggle/0_mt6960_0.png"
    finally:
        db.close()

    # Login Shop 2 (LuxeOptics, shop_id=2)
    s2_login = client.post("/api/shop/login", json={"email": "priya@luxeoptics.com", "password": "admin123"})
    assert s2_login.status_code == 200
    s2_token = s2_login.json()["token"]
    s2_headers = {"Authorization": f"Bearer {s2_token}"}

    # Shop 2 lists products: P1 must NOT be in Shop 2's catalog
    s2_prods = client.get("/api/shop/products", headers=s2_headers).json()["products"]
    assert not any(p["id"] == p_id for p in s2_prods), "Data Leak: Shop 2 saw Shop 1's product!"

    # Shop 2 attempts to edit Shop 1's product -> Must return 404
    s2_edit = client.put(f"/api/shop/products/{p_id}", json={"price": 999.0}, headers=s2_headers)
    assert s2_edit.status_code == 404

    # Shop 2 attempts to delete Shop 1's product -> Must return 404
    s2_del = client.delete(f"/api/shop/products/{p_id}", headers=s2_headers)
    assert s2_del.status_code == 404

    # Cleanup: Shop 1 deletes its own product
    s1_del = client.delete(f"/api/shop/products/{p_id}", headers=s1_headers)
    assert s1_del.status_code == 200

def test_step2_3_and_4_multi_shop_cart_split_and_order_isolation():
    """3 & 4. Multi-shop cart checkout creates separate shop orders; each shop sees only its own orders."""
    # Find one product from Shop 1 and one from Shop 2
    db = SessionLocal()
    try:
        p_shop1 = db.query(Product).filter(Product.shop_id == 1).first()
        p_shop2 = db.query(Product).filter(Product.shop_id == 2).first()
        if p_shop1 and p_shop1.stock_quantity <= 0:
            p_shop1.stock_quantity = 10
            db.commit()
        if p_shop2 and p_shop2.stock_quantity <= 0:
            p_shop2.stock_quantity = 10
            db.commit()
        db.refresh(p_shop1)
        db.refresh(p_shop2)
        assert p_shop1 is not None and p_shop2 is not None
        p1_id, p2_id = p_shop1.id, p_shop2.id
        s1_stock_before = p_shop1.stock_quantity
        s2_stock_before = p_shop2.stock_quantity
    finally:
        db.close()

    # Clean customer cart first
    mob = "9900112233"
    login_res = client.post("/api/customer/login", json={"email": "step1_profile@eyereach.com", "password": "verifyPassword123"})
    headers = {"Authorization": f"Bearer {login_res.json()['token']}"}

    db_clean = SessionLocal()
    try:
        c_obj = db_clean.query(Customer).filter(Customer.mobile == mob).first()
        if c_obj:
            db_clean.query(CartItem).filter(CartItem.customer_id == c_obj.id).delete()
            db_clean.commit()
    finally:
        db_clean.close()

    client.post("/api/customer/cart", json={"product_id": p1_id, "quantity": 1, "customer_mobile": mob}, headers=headers)
    client.post("/api/customer/cart", json={"product_id": p2_id, "quantity": 1, "customer_mobile": mob}, headers=headers)

    # Checkout
    chk_res = client.post("/api/customer/cart/checkout", json={
        "customer_name": "Multi-Shop Tester",
        "customer_phone": mob,
        "customer_address": "123 High Street, Bengaluru",
        "has_prescription": False
    }, headers=headers)
    assert chk_res.status_code == 200, chk_res.text
    chk_data = chk_res.json()
    assert chk_data["status"] == "success"
    created_orders = chk_data["orders"]
    assert len(created_orders) == 2

    order_shop1 = next(o for o in created_orders if o["shop_id"] == 1)
    order_shop2 = next(o for o in created_orders if o["shop_id"] == 2)
    assert order_shop1["order_number"] != order_shop2["order_number"]

    # Verify stocks decremented
    db = SessionLocal()
    try:
        p1_after = db.query(Product).filter(Product.id == p1_id).first()
        p2_after = db.query(Product).filter(Product.id == p2_id).first()
        assert p1_after.stock_quantity == s1_stock_before - 1
        assert p2_after.stock_quantity == s2_stock_before - 1
    finally:
        db.close()

    # Verify Shop 1 sees ONLY Shop 1's order
    s1_token = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"}).json()["token"]
    s1_orders = client.get("/api/shop/orders", headers={"Authorization": f"Bearer {s1_token}"}).json()
    s1_order_nums = [o["order_number"] for o in s1_orders]
    assert order_shop1["order_number"] in s1_order_nums
    assert order_shop2["order_number"] not in s1_order_nums, "Security Breach: Shop 1 saw Shop 2's order!"

    # Verify Shop 2 sees ONLY Shop 2's order
    s2_token = client.post("/api/shop/login", json={"email": "priya@luxeoptics.com", "password": "admin123"}).json()["token"]
    s2_orders = client.get("/api/shop/orders", headers={"Authorization": f"Bearer {s2_token}"}).json()
    s2_order_nums = [o["order_number"] for o in s2_orders]
    assert order_shop2["order_number"] in s2_order_nums
    assert order_shop1["order_number"] not in s2_order_nums, "Security Breach: Shop 2 saw Shop 1's order!"

def test_step2_5_and_6_order_progression_and_rejection_reason():
    """5 & 6. Order acceptance, progression, rejection with mandatory reason, and customer visibility."""
    s1_token = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"}).json()["token"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}

    s1_orders = client.get("/api/shop/orders", headers=s1_headers).json()
    target_order = s1_orders[0]
    o_id = target_order["id"]

    # Progression: Preparing Lenses -> Dispatched -> Delivered
    res_prep = client.patch(f"/api/shop/orders/{o_id}/status", json={"status": "Preparing Lenses"}, headers=s1_headers)
    assert res_prep.status_code == 200
    assert res_prep.json()["order_status"] == "Preparing Lenses"

    res_disp = client.patch(f"/api/shop/orders/{o_id}/status", json={"status": "Dispatched"}, headers=s1_headers)
    assert res_disp.status_code == 200
    assert res_disp.json()["order_status"] == "Dispatched"

    res_deliv = client.patch(f"/api/shop/orders/{o_id}/status", json={"status": "Delivered"}, headers=s1_headers)
    assert res_deliv.status_code == 200
    assert res_deliv.json()["order_status"] == "Delivered"

    # Rejection with mandatory reason
    rejection_msg = "Frame hinge defect observed during optical glazing inspection"
    res_rej = client.patch(f"/api/shop/orders/{o_id}/status", json={
        "status": "Rejected",
        "rejection_reason": rejection_msg
    }, headers=s1_headers)
    assert res_rej.status_code == 200
    assert res_rej.json()["rejection_reason"] == rejection_msg

    # Verify directly in DB
    db = SessionLocal()
    try:
        ord_db = db.query(Order).filter(Order.id == o_id).first()
        assert ord_db.status == "Rejected"
        assert ord_db.rejection_reason == rejection_msg
    finally:
        db.close()

def test_step2_7_and_8_home_trials_details_and_final_frame():
    """7 & 8. Home trial requests display selected frames, and final frame selection is recorded."""
    s1_token = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"}).json()["token"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}

    # Customer books trial specifically with 2 frames
    fut_date = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    book_res = client.post("/api/customer/home-services/book", json={
        "service_type": "frame_trial",
        "appointment_date": fut_date,
        "appointment_time": "01:00 PM",
        "full_name": "Trial Frame Selector",
        "mobile_number": "9988776655",
        "email": "trialselector@eyereach.com",
        "home_address": "Apartment 5B, Prestige Towers, Bengaluru",
        "selected_frames": [
            {"product_id": "FR-SEL-01", "name": "Classic Wayfarer", "price": 2200, "brand": "Ray-Ban"},
            {"product_id": "FR-SEL-02", "name": "Titanium Minimalist", "price": 3100, "brand": "Silhouette"}
        ]
    })
    assert book_res.status_code == 200
    appt_id = book_res.json()["appointment_id"]

    # Shop owner views trials
    trials = client.get("/api/shop/home-trials", headers=s1_headers).json()
    target_trial = next((t for t in trials if t["appointment_id"] == appt_id), None)
    assert target_trial is not None
    assert target_trial["customer_name"] == "Trial Frame Selector"
    assert target_trial["customer_address"] == "Apartment 5B, Prestige Towers, Bengaluru"
    assert target_trial["selected_frames_count"] == 2
    assert target_trial["selected_frames"][0]["name"] == "Classic Wayfarer"

    # Representative records customer's finalized frame selection
    final_res = client.put(f"/api/shop/home-trials/{target_trial['id']}/final-frame", json={
        "final_selected_frame_id": "FR-SEL-02",
        "frame_name": "Titanium Minimalist"
    }, headers=s1_headers)
    assert final_res.status_code == 200
    assert final_res.json()["visit_status"] == "Final Frame Selected"

    # Verify directly in DB
    db = SessionLocal()
    try:
        appt_db = db.query(Appointment).filter(Appointment.id == target_trial["id"]).first()
        assert appt_db.final_selected_frame_id == "FR-SEL-02"
        assert appt_db.visit_status == "Final Frame Selected"
    finally:
        db.close()

def test_step2_9_and_10_optometrist_and_prescription_association():
    """9 & 10. In-shop optometrist availability, assignment, and clinical prescription recording."""
    s1_token = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"}).json()["token"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}

    # 1. Add / Link an In-Shop Optometrist
    doc_res = client.post("/api/shop/optometrists", json={
        "name": "Dr. Kavita Menon",
        "email": f"kavita_{datetime.datetime.now().timestamp()}@visioncraft.com",
        "mobile": "9845012345",
        "qualification": "M.Optom, FAAO",
        "registration_number": "KA-OPT-8812",
        "specialization": "Clinical Refraction & Contact Lenses",
        "available_days": "Mon,Tue,Wed,Thu,Fri,Sat",
        "available_hours": "09:00 AM - 06:00 PM",
        "is_available": True,
        "password": "optomPassword123"
    }, headers=s1_headers)
    assert doc_res.status_code == 200, doc_res.text
    optom_id = doc_res.json()["doctor"]["id"]

    # 2. Update Optometrist Availability
    up_optom = client.put(f"/api/shop/optometrists/{optom_id}", json={
        "available_days": "Mon,Wed,Fri,Sat",
        "available_hours": "10:00 AM - 05:00 PM",
        "is_available": True
    }, headers=s1_headers)
    assert up_optom.status_code == 200
    assert up_optom.json()["optometrist"]["available_days"] == "Mon,Wed,Fri,Sat"

    # 3. Create Vision Test appointment
    fut_date = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()
    vt_res = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": fut_date,
        "appointment_time": "11:30 AM",
        "full_name": "Deepa Sundaram",
        "mobile_number": "9911224455",
        "email": "deepa@gmail.com",
        "home_address": "Malleshwaram 7th Cross, Bengaluru",
        "has_prescription": False
    })
    assert vt_res.status_code == 200
    appt_num = vt_res.json()["appointment_id"]

    # Shop finds appointment
    tests = client.get("/api/shop/vision-tests", headers=s1_headers).json()
    target_vt = next(v for v in tests if v["appointment_id"] == appt_num)

    # 4. Assign Optometrist
    assign_res = client.put(f"/api/shop/vision-tests/{target_vt['id']}/assign", json={
        "doctor_id": optom_id
    }, headers=s1_headers)
    assert assign_res.status_code == 200
    assert assign_res.json()["doctor_name"] == "Dr. Kavita Menon"

    # 5. Record Confirmed Clinical Exam Prescription
    rx_res = client.post(f"/api/shop/vision-tests/{target_vt['id']}/record-prescription", json={
        "sph_od": -2.25,
        "cyl_od": -0.75,
        "axis_od": 95,
        "add_od": 1.5,
        "sph_os": -2.50,
        "cyl_os": -0.50,
        "axis_os": 85,
        "add_os": 1.5,
        "ipd_mm": 62.5,
        "notes": "Full subjective refraction completed. Clear binocular vision achieved.",
        "optometrist_name": "Dr. Kavita Menon"
    }, headers=s1_headers)
    assert rx_res.status_code == 200
    rx_data = rx_res.json()
    assert rx_data["prescription"]["right_eye_od"]["sph"] == -2.25
    assert rx_data["prescription"]["left_eye_os"]["sph"] == -2.50
    assert rx_data["prescription"]["optometrist_name"] == "Dr. Kavita Menon"

    # Verify directly in DB
    db = SessionLocal()
    try:
        appt_db = db.query(Appointment).filter(Appointment.id == target_vt["id"]).first()
        assert appt_db.doctor_id == optom_id
        assert appt_db.has_prescription is True
        assert appt_db.visit_status == "Completed"
        parsed_rx = json.loads(appt_db.prescription_data_json)
        assert parsed_rx["right_eye_od"]["sph"] == -2.25
        assert parsed_rx["ipd_mm"] == 62.5
    finally:
        db.close()

def test_step2_6_optometrist_login_and_role_based_permissions():
    """Verify Optometrist logs in via unified Shop Owner / Optometrist portal and enforces RBAC."""
    # 1. Login Shop Owner 1 to register a fresh optometrist
    s1_token = client.post("/api/shop/login", json={"email": "rajesh@visioncraft.com", "password": "admin123"}).json()["token"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}

    unique_email = f"optom_{datetime.datetime.now().timestamp()}@visioncraft.com"
    pwd = "OptomClinical2026!"
    doc_res = client.post("/api/shop/optometrists", json={
        "name": "Dr. Rohit Deshmukh",
        "email": unique_email,
        "mobile": "9887766554",
        "qualification": "B.Optom, M.Sc Vision Science",
        "registration_number": "KA-OPT-9901",
        "specialization": "Refraction & Low Vision",
        "available_days": "Mon,Tue,Wed,Thu,Fri",
        "available_hours": "09:30 AM - 05:30 PM",
        "is_available": True,
        "password": pwd
    }, headers=s1_headers)
    assert doc_res.status_code == 200, doc_res.text
    optom_id = doc_res.json()["doctor"]["id"]

    # 2. Optometrist Logs in via Unified /api/shop/login
    optom_login = client.post("/api/shop/login", json={
        "email": unique_email,
        "password": pwd
    })
    assert optom_login.status_code == 200, optom_login.text
    data = optom_login.json()
    assert data["role"] == "optometrist"
    assert data["name"] == "Dr. Rohit Deshmukh"
    optom_token = data["token"]
    optom_headers = {"Authorization": f"Bearer {optom_token}"}

    # 3. RBAC: Optometrist CANNOT modify shop inventory or store profile (Must return 403)
    # Attempt to create product -> 403 Forbidden
    prod_add = client.post("/api/shop/products", json={
        "brand": "IllegalBrand",
        "name": "Hacked Frame",
        "shape": "Round",
        "material": "Metal",
        "color": "Black",
        "frame_type": "Full Rim",
        "size": "Medium",
        "price": 1200.0,
        "stock_quantity": 5,
        "gender_category": "Unisex"
    }, headers=optom_headers)
    assert prod_add.status_code == 403
    assert "restricted from modifying shop inventory" in prod_add.text

    # Attempt to update product -> 403 Forbidden
    prod_edit = client.put("/api/shop/products/1", json={"price": 99.0}, headers=optom_headers)
    assert prod_edit.status_code == 403

    # Attempt to delete product -> 403 Forbidden
    prod_del = client.delete("/api/shop/products/1", headers=optom_headers)
    assert prod_del.status_code == 403

    # Attempt to add another optometrist -> 403 Forbidden
    doc_add = client.post("/api/shop/optometrists", json={
        "name": "Another Optom",
        "email": "another@test.com",
        "mobile": "9876543210",
        "specialization": "Clinical",
        "qualification": "B.Optom",
        "password": "pass"
    }, headers=optom_headers)
    assert doc_add.status_code == 403

    # Attempt to update shop profile -> 403 Forbidden
    prof_edit = client.put("/api/shop/profile", json={"shop_name": "New Shop Name"}, headers=optom_headers)
    assert prof_edit.status_code == 403

    # 4. Optometrist Allowed Actions: View vision tests, update exam status, and record clinical prescriptions
    fut_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    vt_res = client.post("/api/customer/home-services/book", json={
        "service_type": "vision_test",
        "appointment_date": fut_date,
        "appointment_time": "02:30 PM",
        "full_name": "Suresh Raina",
        "mobile_number": "9876543210",
        "email": "suresh@example.com",
        "home_address": "Indiranagar 100ft Rd, Bengaluru",
        "has_prescription": False
    })
    assert vt_res.status_code == 200
    appt_id = vt_res.json()["appointment_id"]

    # Shop owner assigns Rohit
    db = SessionLocal()
    try:
        target_appt = db.query(Appointment).filter(Appointment.appointment_id == appt_id).first()
        assert target_appt is not None
        target_appt_id = target_appt.id
    finally:
        db.close()

    assign_res = client.put(f"/api/shop/vision-tests/{target_appt_id}/assign", json={
        "doctor_id": optom_id
    }, headers=s1_headers)
    assert assign_res.status_code == 200

    # Optometrist reads assigned tests
    my_tests = client.get("/api/shop/vision-tests", headers=optom_headers)
    assert my_tests.status_code == 200
    assert any(t["id"] == target_appt_id for t in my_tests.json())

    # Optometrist updates visit status to "In Progress"
    status_res = client.put(f"/api/shop/vision-tests/{target_appt_id}/status", json={
        "status": "In Progress",
        "notes": "Arrived at customer residence. Starting preliminary retinoscopy."
    }, headers=optom_headers)
    assert status_res.status_code == 200
    assert status_res.json()["visit_status"] == "In Progress"

    # Optometrist records confirmed clinical exam prescription
    exam_res = client.post(f"/api/shop/vision-tests/{target_appt_id}/record-prescription", json={
        "sph_od": -1.75,
        "cyl_od": -0.50,
        "axis_od": 100,
        "sph_os": -2.00,
        "cyl_os": -0.25,
        "axis_os": 80,
        "ipd_mm": 63.0,
        "notes": "Accurate subjective refraction conducted in-person. Clear visual acuity achieved.",
        "optometrist_name": "Dr. Rohit Deshmukh"
    }, headers=optom_headers)
    assert exam_res.status_code == 200
    rx_out = exam_res.json()["prescription"]
    assert rx_out["right_eye_od"]["sph"] == -1.75
    assert rx_out["left_eye_os"]["sph"] == -2.00
    assert rx_out["optometrist_name"] == "Dr. Rohit Deshmukh"

