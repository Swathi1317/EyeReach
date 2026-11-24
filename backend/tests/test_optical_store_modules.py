import os
import io
import csv
import openpyxl
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import Base, engine, SessionLocal
from backend.app.db.models import Shop, Product, Customer, Order

client = TestClient(app)

def test_01_shop_registration_and_login():
    # 1. Register a new optical shop
    reg_payload = {
        "owner_name": "Vikram Patel",
        "shop_name": "Patel Opticals",
        "mobile_number": "9988776655",
        "email": "vikram@pateloptics.com",
        "shop_address": "Shop 10, Ring Road, Surat, Gujarat",
        "password": "securepassword123",
        "confirm_password": "securepassword123"
    }
    res = client.post("/api/shop/register", json=reg_payload)
    assert res.status_code == 200 or (res.status_code == 400 and "already registered" in res.text)
    
    # 2. Login as the optical shop owner
    login_payload = {
        "email": "rajesh@visioncraft.com", # Pre-seeded store
        "password": "admin123"
    }
    res_login = client.post("/api/shop/login", json=login_payload)
    assert res_login.status_code == 200
    data = res_login.json()
    assert "token" in data
    assert "VisionCraft Opticians" in data["shop"]["shop_name"]

def test_02_dashboard_kpis():
    res = client.get("/api/shop/dashboard/stats")
    assert res.status_code == 200
    data = res.json()
    assert "total_products" in data
    assert "total_frames" in data
    assert "available_stock" in data
    assert "sales_overview" in data
    assert "product_categories" in data
    assert data["total_products"] > 0

def test_03_inventory_crud_operations():
    # 1. Create a product
    new_frame = {
        "product_id": "TEST_FR_99",
        "brand": "SmartFrame Test",
        "name": "Titanium Hexagonal",
        "shape": "Geometric",
        "material": "Titanium",
        "color": "Gold",
        "frame_type": "Full Rim",
        "size": "51-19-142",
        "lens_width_mm": 51.0,
        "bridge_width_mm": 19.0,
        "temple_length_mm": 142.0,
        "frame_width_mm": 125.0,
        "price": 2799.0,
        "stock_quantity": 7,
        "gender_category": "Unisex",
        "description": "Test geometric frame.",
        "front_image": "/frames/frame_017.svg",
        "side_image": "/frames/frame_017.svg",
        "angled_image": "/frames/frame_017.svg"
    }
    res = client.post("/api/shop/products", json=new_frame)
    assert res.status_code in [200, 400]
    
    # 2. List products with search
    res_list = client.get("/api/shop/products?search=Titanium")
    assert res_list.status_code == 200
    prods = res_list.json()["products"]
    assert len(prods) >= 1

    # 3. Quick Price and Stock Update
    first_p = prods[0]
    pid = first_p["id"]
    res_price = client.patch(f"/api/shop/products/{pid}/price", json={"price": 2999.0})
    assert res_price.status_code == 200
    assert res_price.json()["price"] == 2999.0

    res_stock = client.patch(f"/api/shop/products/{pid}/stock", json={"stock_quantity": 14})
    assert res_stock.status_code == 200
    assert res_stock.json()["stock"] == 14

def test_04_bulk_upload_templates_and_import():
    # 1. Download CSV template
    res_csv = client.get("/api/shop/template?format=csv")
    assert res_csv.status_code == 200
    assert "Product ID" in res_csv.text

    # 2. Download Excel template
    res_xlsx = client.get("/api/shop/template?format=xlsx")
    assert res_xlsx.status_code == 200
    assert len(res_xlsx.content) > 100

    # 3. Test Bulk Upload with in-memory CSV
    csv_content = (
        "Product ID,Brand,Frame Name,Shape,Material,Colour,Frame Type,Size,Lens Width (mm),Bridge Width (mm),Temple Length (mm),Price,Stock Quantity,Gender Category,Product Description,Front Image URL,Side Image URL,Angled Image URL\n"
        "BULK_TEST_101,BulkBrand,Urban Classic,Round,Acetate,Tortoise,Full Rim,50-18-140,50,18,140,1650,15,Unisex,Bulk imported classic acetate frame,/frames/frame_002.svg,/frames/frame_002.svg,/frames/frame_002.svg\n"
    )
    files = {"file": ("bulk_test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    res_upload = client.post("/api/shop/products/bulk-upload", files=files)
    assert res_upload.status_code == 200
    data = res_upload.json()
    assert "imported_count" in data

def test_05_ai_description_generation():
    desc_payload = {
        "brand": "Ray-Ban",
        "shape": "Aviator",
        "material": "Titanium",
        "color": "Gold",
        "frame_type": "Full Rim",
        "size": "55-18-140",
        "gender": "Men"
    }
    res = client.post("/api/shop/ai/generate-description", json=desc_payload)
    assert res.status_code == 200
    data = res.json()
    assert "description" in data
    assert len(data["description"]) > 20
    assert "Ray-Ban" in data["description"] or "Aviator" in data["description"]

def test_06_ai_frame_image_generation_and_approval():
    gen_payload = {
        "prompt": "Generate a rectangular spectacle frame, red colour, full rim, acetate material, modern design.",
        "shape": "Rectangle",
        "color": "Red",
        "material": "Acetate",
        "frame_type": "Full Rim",
        "gender": "Women",
        "design_style": "Modern"
    }
    res_gen = client.post("/api/shop/ai/generate-frame-image", json=gen_payload)
    assert res_gen.status_code == 200
    data = res_gen.json()
    assert "image_url" in data
    assert "specs" in data
    assert data["specs"]["shape"] == "Rectangle"

    # Test approving and saving directly into inventory
    appr_payload = {
        "product_id": f"AI_APP_{os.urandom(3).hex()}",
        "brand": "SmartFrame AI Studio",
        "name": "Crimson Executive Rectangle",
        "shape": "Rectangle",
        "material": "Acetate",
        "color": "Red",
        "frame_type": "Full Rim",
        "size": "52-18-140",
        "price": 2899.0,
        "stock_quantity": 5,
        "gender_category": "Women",
        "description": "AI synthesized crimson acetate eyewear.",
        "image_url": data["image_url"]
    }
    res_appr = client.post("/api/shop/ai/approve-and-save", json=appr_payload)
    assert res_appr.status_code == 200
    assert res_appr.json()["status"] == "success"

def test_07_customer_catalog_and_filters():
    # Browse all customer products
    res = client.get("/api/customer/products")
    assert res.status_code == 200
    prods = res.json()
    assert len(prods) > 0
    assert "shop" in prods[0]
    assert "brand" in prods[0]

    # Filter by Face Shape category
    res_oval = client.get("/api/customer/products?face_shape=Oval")
    assert res_oval.status_code == 200
    assert len(res_oval.json()) > 0

    # Test single product with 360 / multi-angle studio view
    pid = prods[0]["id"]
    res_single = client.get(f"/api/customer/products/{pid}")
    assert res_single.status_code == 200
    single_data = res_single.json()
    assert "multi_angle_views" in single_data
    assert "front" in single_data["multi_angle_views"]
    assert "side" in single_data["multi_angle_views"]
    assert "angled" in single_data["multi_angle_views"]

def test_08_customer_order_placement_and_shop_update():
    # 1. Place order as a customer
    res_prods = client.get("/api/customer/products")
    first_prod = res_prods.json()[0]

    order_payload = {
        "product_id": first_prod["id"],
        "quantity": 1,
        "customer_name": "Rohan Deshmukh",
        "customer_phone": "9819283746",
        "notes": "Anti-reflective coating requested."
    }
    res_order = client.post("/api/customer/orders", json=order_payload)
    assert res_order.status_code == 200
    ord_data = res_order.json()
    assert "order_number" in ord_data["order"]

    # 2. Shop Owner views order
    res_shop_orders = client.get("/api/shop/orders")
    assert res_shop_orders.status_code == 200
    orders_list = res_shop_orders.json()
    assert any(o["customer_name"] == "Rohan Deshmukh" for o in orders_list)

def test_09_recommendations_with_shop_products():
    # Verify that recommendations endpoint returns real shop products
    rec_payload = {
        "face_shape": "oval",
        "face_shape_confidence": 0.95,
        "ipd_mm": 63.5,
        "ipd_method": "pupil_landmarks",
        "skin_tone": "Fair",
        "undertone": "neutral",
        "budget": 5000.0
    }
    res = client.post("/api/recommendations", json=rec_payload)
    assert res.status_code == 200
    recs = res.json()["recommendations"]
    assert len(recs) > 0
    # At least one recommendation should have shop_name populated
    assert any(r.get("shop_name") for r in recs)
