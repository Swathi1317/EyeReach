import os
import io
import csv
import json
import openpyxl
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Response
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..db.database import get_db
from ..db.models import Shop, Product, Order, Customer, CustomerFramePick, Appointment
from .shop_auth import get_current_shop

router = APIRouter(prefix="/api/shop", tags=["Shop Inventory & Dashboard"])

# UPLOADS FOLDER FOR PRODUCT IMAGES
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

class ProductCreateRequest(BaseModel):
    product_id: str
    brand: str
    name: str
    shape: str
    material: str
    color: str
    frame_type: str
    size: str
    lens_width_mm: Optional[float] = None
    bridge_width_mm: Optional[float] = None
    temple_length_mm: Optional[float] = None
    frame_width_mm: Optional[float] = None
    lens_height_mm: Optional[float] = None
    price: float
    stock_quantity: int = 1
    gender_category: str = "Unisex"
    description: Optional[str] = None
    front_image: str
    side_image: Optional[str] = None
    angled_image: Optional[str] = None

class ProductUpdateRequest(BaseModel):
    brand: Optional[str] = None
    name: Optional[str] = None
    shape: Optional[str] = None
    material: Optional[str] = None
    color: Optional[str] = None
    frame_type: Optional[str] = None
    size: Optional[str] = None
    lens_width_mm: Optional[float] = None
    bridge_width_mm: Optional[float] = None
    temple_length_mm: Optional[float] = None
    frame_width_mm: Optional[float] = None
    lens_height_mm: Optional[float] = None
    price: Optional[float] = None
    stock_quantity: Optional[int] = None
    gender_category: Optional[str] = None
    description: Optional[str] = None
    front_image: Optional[str] = None
    side_image: Optional[str] = None
    angled_image: Optional[str] = None

class PriceUpdate(BaseModel):
    price: float

class StockUpdate(BaseModel):
    stock_quantity: int

class OrderStatusUpdate(BaseModel):
    status: str

# ----------------- MODULE 2: DASHBOARD STATS -----------------

@router.get("/dashboard/stats")
def get_dashboard_stats(current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.shop_id == current_shop.id).all()
    
    total_products = len(products)
    total_frames = sum(p.stock_quantity for p in products)
    available_stock = sum(p.stock_quantity for p in products if p.stock_quantity > 0)
    out_of_stock = sum(1 for p in products if p.stock_quantity <= 0)

    # Categories breakdown
    category_counts = {}
    for p in products:
        c = p.shape or "Other"
        category_counts[c] = category_counts.get(c, 0) + 1

    # Orders for this shop
    orders = db.query(Order).filter(Order.shop_id == current_shop.id).order_by(Order.created_at.desc()).all()
    total_orders = len(orders)
    total_sales = sum(o.total_amount for o in orders if o.status in ["Completed", "Ready for Pickup", "Confirmed"])
    recent_orders = [
        {
            "id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "product_name": o.product_name,
            "product_code": o.product_code,
            "total_amount": o.total_amount,
            "status": o.status,
            "created_at": o.created_at.strftime("%d %b %Y, %I:%M %p") if o.created_at else ""
        }
        for o in orders[:5]
    ]

    # Customers count
    total_customers = db.query(func.count(Customer.id)).scalar() or 0

    return {
        "shop_name": current_shop.shop_name,
        "owner_name": current_shop.owner_name,
        "total_products": total_products,
        "total_frames": total_frames,
        "available_stock": available_stock,
        "out_of_stock_products": out_of_stock,
        "total_customers": total_customers,
        "total_orders": total_orders,
        "sales_overview": {
            "total_revenue": total_sales,
            "currency": "₹",
            "recent_orders_count": len(recent_orders)
        },
        "product_categories": category_counts,
        "recent_orders": recent_orders
    }

# ----------------- MODULE 3: FRAME INVENTORY CRUD -----------------

@router.get("/products")
def list_shop_products(
    search: Optional[str] = None,
    shape: Optional[str] = None,
    material: Optional[str] = None,
    gender: Optional[str] = None,
    stock_status: Optional[str] = None, # 'in_stock' | 'out_of_stock'
    current_shop: Shop = Depends(get_current_shop),
    db: Session = Depends(get_db)
):
    query = db.query(Product).filter(Product.shop_id == current_shop.id, Product.is_active == True)

    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (Product.name.ilike(s)) |
            (Product.brand.ilike(s)) |
            (Product.product_id.ilike(s)) |
            (Product.color.ilike(s))
        )

    if shape and shape != "All":
        query = query.filter(Product.shape.ilike(shape))

    if material and material != "All":
        query = query.filter(Product.material.ilike(material))

    if gender and gender != "All":
        query = query.filter(Product.gender_category.ilike(gender))

    if stock_status == "in_stock":
        query = query.filter(Product.stock_quantity > 0)
    elif stock_status == "out_of_stock":
        query = query.filter(Product.stock_quantity <= 0)

    products = query.order_by(Product.created_at.desc()).all()

    return {
        "total": len(products),
        "products": [
            {
                "id": p.id,
                "product_id": p.product_id,
                "brand": p.brand,
                "name": p.name,
                "shape": p.shape,
                "material": p.material,
                "color": p.color,
                "frame_type": p.frame_type,
                "size": p.size,
                "lens_width_mm": p.lens_width_mm,
                "bridge_width_mm": p.bridge_width_mm,
                "temple_length_mm": p.temple_length_mm,
                "frame_width_mm": p.frame_width_mm,
                "lens_height_mm": p.lens_height_mm,
                "price": p.price,
                "stock_quantity": p.stock_quantity,
                "gender_category": p.gender_category,
                "description": p.description,
                "front_image": p.front_image,
                "side_image": p.side_image or p.front_image,
                "angled_image": p.angled_image or p.front_image,
                "created_at": p.created_at.strftime("%Y-%m-%d") if p.created_at else ""
            }
            for p in products
        ]
    }

@router.get("/products/{id}")
def get_shop_product(id: int, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found in your inventory.")
    return product

@router.post("/products")
def create_shop_product(req: ProductCreateRequest, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    # Check for duplicate Product ID in this shop
    dup = db.query(Product).filter(
        Product.shop_id == current_shop.id,
        Product.product_id == req.product_id.strip()
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Product ID '{req.product_id}' already exists in your shop.")

    new_prod = Product(
        product_id=req.product_id.strip(),
        shop_id=current_shop.id,
        brand=req.brand.strip(),
        name=req.name.strip(),
        shape=req.shape.strip(),
        material=req.material.strip(),
        color=req.color.strip(),
        frame_type=req.frame_type.strip(),
        size=req.size.strip(),
        lens_width_mm=req.lens_width_mm,
        bridge_width_mm=req.bridge_width_mm,
        temple_length_mm=req.temple_length_mm,
        frame_width_mm=req.frame_width_mm or (2 * (req.lens_width_mm or 50) + (req.bridge_width_mm or 18)),
        lens_height_mm=req.lens_height_mm,
        price=req.price,
        stock_quantity=req.stock_quantity,
        gender_category=req.gender_category.strip(),
        description=req.description,
        front_image=req.front_image.strip(),
        side_image=req.side_image.strip() if req.side_image else req.front_image.strip(),
        angled_image=req.angled_image.strip() if req.angled_image else req.front_image.strip()
    )
    db.add(new_prod)
    db.commit()
    db.refresh(new_prod)

    return {"status": "success", "message": f"Frame '{new_prod.name}' added successfully.", "product": new_prod}

@router.put("/products/{id}")
def update_shop_product(id: int, req: ProductUpdateRequest, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found in your inventory.")

    for field, val in req.model_dump(exclude_unset=True).items():
        setattr(product, field, val)

    db.commit()
    db.refresh(product)
    return {"status": "success", "message": f"Product '{product.name}' updated successfully.", "product": product}

@router.delete("/products/{id}")
def delete_shop_product(id: int, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found in your inventory.")

    db.delete(product)
    db.commit()
    return {"status": "success", "message": f"Product '{product.name}' deleted successfully."}

@router.patch("/products/{id}/price")
def update_product_price(id: int, req: PriceUpdate, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    product.price = req.price
    db.commit()
    return {"status": "success", "message": f"Price updated to ₹{product.price}.", "price": product.price}

@router.patch("/products/{id}/stock")
def update_product_stock(id: int, req: StockUpdate, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    product.stock_quantity = req.stock_quantity
    db.commit()
    return {"status": "success", "message": f"Stock quantity updated to {product.stock_quantity}.", "stock": product.stock_quantity}

# ----------------- MODULE 4: BULK UPLOAD & TEMPLATE -----------------

@router.get("/template")
def download_template(format: str = Query("csv", pattern="^(csv|xlsx)$")):
    headers = [
        "Product ID", "Brand", "Frame Name", "Shape", "Material", "Colour",
        "Frame Type", "Size", "Lens Width (mm)", "Bridge Width (mm)",
        "Temple Length (mm)", "Price", "Stock Quantity", "Gender Category",
        "Product Description", "Front Image URL", "Side Image URL", "Angled Image URL"
    ]
    sample_row = [
        "FR001", "Example Brand", "Classic Round", "Round", "Acetate", "Black",
        "Full Rim", "50-18-140", "50", "18",
        "140", "1800", "10", "Unisex",
        "Classic handcrafted acetate round eyewear with premium gloss finish.",
        "/frames/frame_001.svg", "/frames/frame_001.svg", "/frames/frame_001.svg"
    ]

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerow(sample_row)
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=SmartFrame_Inventory_Template.csv"}
        )
    else:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Frame Inventory"
        ws.append(headers)
        ws.append(sample_row)
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = max(max_len + 4, 14)

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=SmartFrame_Inventory_Template.xlsx"}
        )

@router.post("/products/bulk-upload")
async def bulk_upload_frames(
    file: UploadFile = File(...),
    current_shop: Shop = Depends(get_current_shop),
    db: Session = Depends(get_db)
):
    filename = file.filename.lower()
    contents = await file.read()
    
    rows = []
    if filename.endswith(".csv"):
        text = contents.decode("utf-8-sig", errors="ignore")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
    elif filename.endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(contents))
        ws = wb.active
        for r in ws.iter_rows(values_only=True):
            rows.append(list(r))
    else:
        raise HTTPException(status_code=400, detail="Invalid file format. Please upload a .csv or .xlsx file.")

    if not rows or len(rows) < 2:
        raise HTTPException(status_code=400, detail="Uploaded file is empty or missing data rows.")

    header = [str(c or "").strip().lower() for c in rows[0]]
    data_rows = rows[1:]

    # Map headers to indices
    def find_idx(keywords):
        for i, h in enumerate(header):
            if any(k in h for k in keywords):
                return i
        return None

    idx_pid = find_idx(["product id", "product_id", "code", "id"])
    idx_brand = find_idx(["brand"])
    idx_name = find_idx(["frame name", "name", "title"])
    idx_shape = find_idx(["shape"])
    idx_material = find_idx(["material"])
    idx_color = find_idx(["colour", "color"])
    idx_type = find_idx(["frame type", "type", "rim"])
    idx_size = find_idx(["size"])
    idx_lens_w = find_idx(["lens width", "lens_w", "lens"])
    idx_bridge_w = find_idx(["bridge width", "bridge_w", "bridge"])
    idx_temple_l = find_idx(["temple length", "temple_l", "temple"])
    idx_price = find_idx(["price", "cost", "mrp"])
    idx_stock = find_idx(["stock quantity", "stock", "qty"])
    idx_gender = find_idx(["gender category", "gender"])
    idx_desc = find_idx(["product description", "description", "desc"])
    idx_front_img = find_idx(["front image", "image", "front_img"])
    idx_side_img = find_idx(["side image", "side_img"])
    idx_angled_img = find_idx(["angled image", "angled_img"])

    if idx_pid is None or idx_name is None or idx_price is None:
        raise HTTPException(
            status_code=400,
            detail="Mandatory columns missing: Product ID, Frame Name, and Price are required."
        )

    existing_pids = set(
        r[0] for r in db.query(Product.product_id).filter(Product.shop_id == current_shop.id).all()
    )

    imported_products = []
    errors = []
    seen_in_batch = set()

    for row_num, row in enumerate(data_rows, start=2):
        if not any(row):
            continue

        def get_val(idx, default=""):
            if idx is not None and idx < len(row):
                v = row[idx]
                return str(v).strip() if v is not None else default
            return default

        pid = get_val(idx_pid)
        brand = get_val(idx_brand, "SmartFrame")
        name = get_val(idx_name)
        shape = get_val(idx_shape, "Round")
        material = get_val(idx_material, "Acetate")
        color = get_val(idx_color, "Black")
        frame_type = get_val(idx_type, "Full Rim")
        size = get_val(idx_size, "Medium")
        gender = get_val(idx_gender, "Unisex")
        desc = get_val(idx_desc, "")
        front_img = get_val(idx_front_img, "/frames/frame_001.svg")
        side_img = get_val(idx_side_img, front_img)
        angled_img = get_val(idx_angled_img, front_img)

        # Validations
        if not pid:
            errors.append({"row": row_num, "error": "Missing Product ID."})
            continue

        if pid in seen_in_batch:
            errors.append({"row": row_num, "error": f"Duplicate Product ID '{pid}' in the upload file."})
            continue

        if pid in existing_pids:
            errors.append({"row": row_num, "error": f"Product ID '{pid}' already exists in your inventory."})
            continue

        if not name:
            errors.append({"row": row_num, "error": f"Missing Frame Name for product '{pid}'."})
            continue

        # Price validation
        try:
            raw_p = get_val(idx_price)
            price_val = float(raw_p.replace("₹", "").replace(",", ""))
            if price_val < 0:
                errors.append({"row": row_num, "error": "Price cannot be negative."})
                continue
        except Exception:
            errors.append({"row": row_num, "error": f"Invalid price '{get_val(idx_price)}'."})
            continue

        # Stock validation
        try:
            raw_s = get_val(idx_stock, "1")
            stock_val = int(float(raw_s))
        except Exception:
            stock_val = 1

        # Float dims
        def parse_dim(idx):
            try:
                v = get_val(idx)
                return float(v) if v else None
            except Exception:
                return None

        lw = parse_dim(idx_lens_w)
        bw = parse_dim(idx_bridge_w)
        tl = parse_dim(idx_temple_l)
        fw = (2 * lw + bw) if (lw and bw) else 125.0

        p = Product(
            product_id=pid,
            shop_id=current_shop.id,
            brand=brand,
            name=name,
            shape=shape,
            material=material,
            color=color,
            frame_type=frame_type,
            size=size,
            lens_width_mm=lw,
            bridge_width_mm=bw,
            temple_length_mm=tl,
            frame_width_mm=fw,
            price=price_val,
            stock_quantity=stock_val,
            gender_category=gender,
            description=desc or f"{brand} {name} - Premium {shape} spectacles in {material} {color}.",
            front_image=front_img,
            side_image=side_img,
            angled_image=angled_img
        )
        imported_products.append(p)
        seen_in_batch.add(pid)
        existing_pids.add(pid)

    if imported_products:
        db.add_all(imported_products)
        db.commit()

    return {
        "status": "success" if imported_products else "error",
        "total_rows_processed": len(data_rows),
        "imported_count": len(imported_products),
        "error_count": len(errors),
        "errors": errors,
        "message": f"Successfully imported {len(imported_products)} frames into your inventory."
    }

# ----------------- ORDERS & CUSTOMERS VIEW -----------------

@router.get("/orders")
def list_shop_orders(current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    orders = db.query(Order).filter(Order.shop_id == current_shop.id).order_by(Order.created_at.desc()).all()
    return [
        {
            "id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "customer_email": o.customer_email,
            "product_id": o.product_id,
            "product_code": o.product_code,
            "product_name": o.product_name,
            "quantity": o.quantity,
            "unit_price": o.unit_price,
            "total_amount": o.total_amount,
            "status": o.status,
            "notes": o.notes,
            "created_at": o.created_at.strftime("%d %b %Y, %I:%M %p") if o.created_at else ""
        }
        for o in orders
    ]

@router.patch("/orders/{id}/status")
def update_order_status(id: int, req: OrderStatusUpdate, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == id, Order.shop_id == current_shop.id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    order.status = req.status
    db.commit()
    return {"status": "success", "message": f"Order status updated to '{order.status}'.", "order_status": order.status}

@router.get("/customers")
def list_shop_customers(db: Session = Depends(get_db)):
    customers = db.query(Customer).order_by(Customer.created_at.desc()).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "mobile": c.mobile,
            "email": c.email,
            "address": c.address,
            "face_shape": c.face_shape or "Not scanned",
            "ipd_mm": c.ipd_mm,
            "skin_tone": c.skin_tone,
            "undertone": c.undertone,
            "created_at": c.created_at.strftime("%d %b %Y") if c.created_at else ""
        }
        for c in customers
    ]

# ----------------- CUSTOMER FRAME PREFERENCES (AGGREGATE DEMAND ANALYTICS) -----------------

@router.get("/customer-frame-preferences")
def get_customer_frame_preferences(db: Session = Depends(get_db)):
    """
    Returns aggregate customer frame preference intelligence for optical store owners.
    Exposes popular models, shapes, colors, and shape+color combinations.
    Privacy Protected: Returns only aggregate demand statistics without revealing private customer details.
    """
    total_likes = db.query(CustomerFramePick).count()
    unique_customers = db.query(func.count(func.distinct(CustomerFramePick.customer_id))).scalar() or 0

    # 1. Most liked models
    model_stats = db.query(
        CustomerFramePick.product_id,
        CustomerFramePick.name,
        CustomerFramePick.brand,
        CustomerFramePick.shape,
        CustomerFramePick.color,
        CustomerFramePick.front_image,
        CustomerFramePick.price,
        func.count(CustomerFramePick.id).label("likes_count")
    ).group_by(
        CustomerFramePick.product_id,
        CustomerFramePick.name,
        CustomerFramePick.brand,
        CustomerFramePick.shape,
        CustomerFramePick.color,
        CustomerFramePick.front_image,
        CustomerFramePick.price
    ).order_by(func.count(CustomerFramePick.id).desc()).limit(10).all()

    most_liked_models = [
        {
            "product_id": m.product_id,
            "name": m.name,
            "brand": m.brand or "EyeReach Studio",
            "shape": m.shape or "Standard",
            "color": m.color or "Classic",
            "front_image": m.front_image or "/frames/frame_001.svg",
            "price": m.price,
            "likes_count": m.likes_count,
            "demand_share": round((m.likes_count / total_likes * 100), 1) if total_likes > 0 else 0
        }
        for m in model_stats
    ]

    # 2. Popular frame shapes
    shape_stats = db.query(
        CustomerFramePick.shape,
        func.count(CustomerFramePick.id).label("count")
    ).group_by(CustomerFramePick.shape).order_by(func.count(CustomerFramePick.id).desc()).all()

    popular_shapes = [
        {
            "shape": s.shape or "Other",
            "count": s.count,
            "percentage": round((s.count / total_likes * 100), 1) if total_likes > 0 else 0
        }
        for s in shape_stats if s.shape
    ]

    # 3. Popular frame colours
    color_stats = db.query(
        CustomerFramePick.color,
        func.count(CustomerFramePick.id).label("count")
    ).group_by(CustomerFramePick.color).order_by(func.count(CustomerFramePick.id).desc()).all()

    popular_colors = [
        {
            "color": c.color or "Other",
            "count": c.count,
            "percentage": round((c.count / total_likes * 100), 1) if total_likes > 0 else 0
        }
        for c in color_stats if c.color
    ]

    # 4. Shape + Colour Combinations (e.g. "Black Round – 45 likes", "Brown Square – 30 likes", "Gold Cat Eye – 25 likes")
    combo_stats = db.query(
        CustomerFramePick.shape,
        CustomerFramePick.color,
        func.count(CustomerFramePick.id).label("likes")
    ).group_by(CustomerFramePick.shape, CustomerFramePick.color).order_by(func.count(CustomerFramePick.id).desc()).limit(8).all()

    top_combinations = [
        {
            "combination": f"{c.color} {c.shape}",
            "shape": c.shape,
            "color": c.color,
            "likes": c.likes,
            "label": f"{c.color} {c.shape} – {c.likes} likes"
        }
        for c in combo_stats if c.shape and c.color
    ]

    # Actionable smart stock recommendation
    top_combo_str = top_combinations[0]["combination"] if top_combinations else "Classic Round"
    top_shape_str = popular_shapes[0]["shape"] if popular_shapes else "Round"
    smart_rec = (
        f"High customer demand detected for {top_combo_str} frames ({top_combinations[0]['likes'] if top_combinations else 0} likes). "
        f"{top_shape_str} frames lead overall styling preferences. Maintain robust stock in {top_shape_str} and neutral tones."
    )

    return {
        "status": "success",
        "total_likes": total_likes,
        "unique_customers": unique_customers,
        "most_liked_models": most_liked_models,
        "popular_shapes": popular_shapes,
        "popular_colors": popular_colors,
        "top_combinations": top_combinations,
        "smart_recommendation": smart_rec,
        "privacy_notice": "Customer privacy protected. Figures represent anonymized aggregate preferences across all registered customer accounts."
    }

@router.get("/home-appointments")
def list_shop_home_appointments(db: Session = Depends(get_db)):
    """
    List all customer Home Visit Appointments with selected frames for doorstep trial.
    Helps representatives and optical stores prepare trial frames and vision kits in advance.
    """
    appts = db.query(Appointment).filter(Appointment.appointment_type == "home_testing").order_by(Appointment.id.desc()).all()
    
    results = []
    for a in appts:
        frames = []
        if a.selected_frames_json:
            try:
                frames = json.loads(a.selected_frames_json)
            except Exception:
                frames = []
        results.append({
            "id": a.id,
            "appointment_id": a.appointment_id,
            "full_name": a.full_name,
            "mobile_number": a.mobile_number,
            "email": a.email,
            "appointment_date": a.appointment_date,
            "appointment_time": a.appointment_time,
            "home_address": a.home_address,
            "purpose": a.purpose,
            "additional_message": a.additional_message,
            "status": a.status,
            "created_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if a.created_at else "",
            "face_shape": a.face_shape,
            "ipd_mm": a.ipd_mm,
            "selected_frames": frames,
            "selected_frames_count": len(frames)
        })
    return results
