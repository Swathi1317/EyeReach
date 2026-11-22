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
from ..db.models import Shop, Product, Order, Customer, CustomerFramePick, Appointment, Doctor, FrameView
from .shop_auth import get_current_shop, hash_password

router = APIRouter(prefix="/api/shop", tags=["Shop Inventory & Dashboard"])

# UPLOADS FOLDER FOR PRODUCT IMAGES
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

class ProductCreateRequest(BaseModel):
    product_id: Optional[str] = None
    brand: str
    name: str
    shape: str
    material: str
    color: str
    frame_type: str = "Full Rim"
    size: str = "Medium"
    lens_width_mm: Optional[float] = None
    bridge_width_mm: Optional[float] = None
    temple_length_mm: Optional[float] = None
    frame_width_mm: Optional[float] = None
    lens_height_mm: Optional[float] = None
    price: float
    stock_quantity: int = 1
    gender_category: str = "Unisex"
    description: Optional[str] = None
    front_image: Optional[str] = None
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
    # Auto-generate Product ID if missing
    pid = (req.product_id or "").strip()
    if not pid:
        highest_prod = db.query(Product).order_by(Product.id.desc()).first()
        next_num = (highest_prod.id + 1) if highest_prod else 1
        pid = f"FR{next_num:03d}"
    
    # Check for duplicate Product ID in this shop
    dup = db.query(Product).filter(
        Product.shop_id == current_shop.id,
        Product.product_id == pid,
        Product.is_active == True
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Product ID '{pid}' already exists in your shop.")

    # Default to a real optical frame image if not provided
    front_img = (req.front_image or "").strip()
    if not front_img or front_img.endswith(".svg"):
        front_img = "/frames/kaggle/0_mt6960_0.png"

    side_img = (req.side_image or "").strip() or front_img
    angled_img = (req.angled_image or "").strip() or front_img

    new_prod = Product(
        product_id=pid,
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
        front_image=front_img,
        side_image=side_img,
        angled_image=angled_img,
        view_count=0,
        selection_count=0,
        is_active=True
    )
    db.add(new_prod)
    db.commit()
    db.refresh(new_prod)

    return {"status": "success", "message": f"Frame '{new_prod.name}' added successfully to inventory.", "product": new_prod}

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
    # Find product by id
    product = db.query(Product).filter(Product.id == id, Product.shop_id == current_shop.id).first()
    if not product:
        # Fallback to any shop ID matching in demo mode
        product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found in your inventory.")

    prod_name = product.name
    prod_code = product.product_id

    # 1. Clean up from CustomerFramePick if referenced
    db.query(CustomerFramePick).filter(
        (CustomerFramePick.product_id == prod_code) | 
        (CustomerFramePick.product_id == str(product.id))
    ).delete(synchronize_session=False)

    # 2. Check if order references this product
    order_count = db.query(Order).filter(Order.product_id == product.id).count()
    if order_count > 0:
        # Soft-delete to preserve business order history, while removing from inventory & catalog
        product.is_active = False
        db.commit()
        return {"status": "success", "message": f"Frame '{prod_name}' has been successfully deleted from inventory."}
    else:
        # Hard delete if no orders exist
        db.delete(product)
        db.commit()
        return {"status": "success", "message": f"Frame '{prod_name}' has been successfully deleted from inventory."}

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

# ----------------- REAL FRAMES GALLERY & VIEW TRACKING -----------------

@router.get("/real-frames-gallery")
def get_real_frames_gallery():
    """Returns real transparent spectacle frame photos from the catalog for owner frame addition/editing."""
    kaggle_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "frames", "kaggle")
    if not os.path.exists(kaggle_dir):
        return {"status": "success", "images": [], "total": 0}
    files = sorted([f for f in os.listdir(kaggle_dir) if f.endswith(".png")])
    return {
        "status": "success",
        "images": [f"/frames/kaggle/{f}" for f in files[:80]],
        "total": len(files)
    }

@router.post("/products/{id}/view")
def track_product_view(id: int, db: Session = Depends(get_db)):
    """Records a customer view event for a frame, incrementing actual view counts."""
    prod = db.query(Product).filter(Product.id == id).first()
    if prod:
        prod.view_count = (prod.view_count or 0) + 1
        db.commit()
        return {"status": "success", "product_id": prod.product_id, "view_count": prod.view_count}
    return {"status": "not_found", "view_count": 0}

# ----------------- DOCTOR MANAGEMENT FOR OPTICAL STORE OWNERS -----------------

class DoctorCreateRequest(BaseModel):
    name: str
    email: str
    mobile: str
    password: str
    specialization: str = "Consultant Optometrist"
    qualification: str = "B.Optom / M.Optom"
    registration_number: Optional[str] = None

class AppointmentAssignRequest(BaseModel):
    doctor_id: int

@router.get("/doctors")
def list_shop_doctors(current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    """List all optometrists and doctors linked to this optical store."""
    docs = db.query(Doctor).filter(
        (Doctor.shop_id == current_shop.id) | (Doctor.shop_id == None),
        Doctor.is_active == True
    ).all()
    return {
        "status": "success",
        "doctors": [
            {
                "id": d.id,
                "name": d.name,
                "email": d.email,
                "mobile": d.mobile,
                "specialization": d.specialization,
                "qualification": d.qualification,
                "registration_number": d.registration_number,
                "created_at": d.created_at.strftime("%d %b %Y") if d.created_at else ""
            }
            for d in docs
        ]
    }

@router.post("/doctors")
def add_shop_doctor(req: DoctorCreateRequest, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    """Allow optical shop owner to link a new optometrist/doctor."""
    existing = db.query(Doctor).filter(Doctor.email == req.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="A doctor with this email is already registered.")

    new_doc = Doctor(
        name=req.name.strip(),
        email=req.email.lower().strip(),
        mobile=req.mobile.strip(),
        specialization=req.specialization.strip(),
        qualification=req.qualification.strip(),
        registration_number=req.registration_number.strip() if req.registration_number else None,
        password_hash=hash_password(req.password),
        shop_id=current_shop.id,
        is_active=True
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    return {
        "status": "success",
        "message": f"Doctor '{new_doc.name}' linked to {current_shop.shop_name} successfully.",
        "doctor": {
            "id": new_doc.id,
            "name": new_doc.name,
            "email": new_doc.email,
            "mobile": new_doc.mobile,
            "specialization": new_doc.specialization,
            "qualification": new_doc.qualification,
            "registration_number": new_doc.registration_number
        }
    }

@router.put("/appointments/{id}/assign")
def assign_appointment_doctor(id: int, req: AppointmentAssignRequest, db: Session = Depends(get_db)):
    """Owner assigns/reassigns an appointment to a linked doctor."""
    appt = db.query(Appointment).filter(Appointment.id == id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")
    doc = db.query(Doctor).filter(Doctor.id == req.doctor_id, Doctor.is_active == True).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Doctor not found or inactive.")
    appt.doctor_id = doc.id
    db.commit()
    db.refresh(appt)
    return {
        "status": "success",
        "message": f"Appointment {appt.appointment_id} assigned to {doc.name}.",
        "doctor_name": doc.name,
        "doctor_id": doc.id
    }

# ----------------- CUSTOMER FRAME PREFERENCES (AGGREGATE DEMAND ANALYTICS) -----------------

@router.get("/customer-frame-preferences")
def get_customer_frame_preferences(db: Session = Depends(get_db)):
    """
    Returns actual customer frame preference intelligence for optical store owners.
    Calculates MOST VIEWED and MOST SELECTED separately from real database records.
    """
    total_views = db.query(func.sum(Product.view_count)).filter(Product.is_active == True).scalar() or 0
    total_selections = db.query(func.sum(Product.selection_count)).filter(Product.is_active == True).scalar() or 0
    unique_customers = db.query(func.count(Customer.id)).scalar() or 0

    # 1. Most Viewed Frames (ranked strictly by views)
    viewed_query = db.query(Product).filter(
        Product.is_active == True
    ).order_by(Product.view_count.desc()).limit(8).all()

    most_viewed_frames = [
        {
            "id": p.id,
            "product_id": p.product_id,
            "name": p.name,
            "brand": p.brand,
            "shape": p.shape,
            "color": p.color,
            "front_image": p.front_image,
            "price": p.price,
            "views_count": p.view_count or 0,
            "selections_count": p.selection_count or 0,
            "view_share": round(((p.view_count or 0) / max(1, total_views) * 100), 1)
        }
        for p in viewed_query
    ]

    # 2. Most Selected Frames (ranked strictly by customer selections/likes)
    selected_query = db.query(Product).filter(
        Product.is_active == True
    ).order_by(Product.selection_count.desc()).limit(8).all()

    most_selected_frames = [
        {
            "id": p.id,
            "product_id": p.product_id,
            "name": p.name,
            "brand": p.brand,
            "shape": p.shape,
            "color": p.color,
            "front_image": p.front_image,
            "price": p.price,
            "selections_count": p.selection_count or 0,
            "views_count": p.view_count or 0,
            "conversion_rate": round(((p.selection_count or 0) / max(1, p.view_count or 1) * 100), 1),
            "selection_share": round(((p.selection_count or 0) / max(1, total_selections) * 100), 1)
        }
        for p in selected_query
    ]

    # 3. Most Preferred Frame Shapes
    shape_rows = db.query(
        Product.shape,
        func.sum(Product.selection_count).label("total_sel"),
        func.sum(Product.view_count).label("total_v")
    ).filter(Product.is_active == True).group_by(Product.shape).order_by(func.sum(Product.selection_count).desc()).all()

    most_preferred_shapes = [
        {
            "shape": s.shape or "Classic",
            "selections_count": int(s.total_sel or 0),
            "views_count": int(s.total_v or 0),
            "percentage": round(((s.total_sel or 0) / max(1, total_selections) * 100), 1)
        }
        for s in shape_rows if s.shape
    ]

    # 4. Most Preferred Frame Colours
    color_rows = db.query(
        Product.color,
        func.sum(Product.selection_count).label("total_sel"),
        func.sum(Product.view_count).label("total_v")
    ).filter(Product.is_active == True).group_by(Product.color).order_by(func.sum(Product.selection_count).desc()).all()

    most_preferred_colors = [
        {
            "color": c.color or "Black",
            "selections_count": int(c.total_sel or 0),
            "views_count": int(c.total_v or 0),
            "percentage": round(((c.total_sel or 0) / max(1, total_selections) * 100), 1)
        }
        for c in color_rows if c.color
    ]

    # Actionable smart stock recommendation
    top_shape = most_preferred_shapes[0]["shape"] if most_preferred_shapes else "Round"
    top_color = most_preferred_colors[0]["color"] if most_preferred_colors else "Black"
    top_selected = most_selected_frames[0]["name"] if most_selected_frames else "Classic Round"
    top_viewed = most_viewed_frames[0]["name"] if most_viewed_frames else "Classic Round"

    smart_rec = (
        f"Actual demand analytics show '{top_selected}' leads customer selections ({most_selected_frames[0]['selections_count'] if most_selected_frames else 0} selections), "
        f"while '{top_viewed}' receives highest customer curiosity ({most_viewed_frames[0]['views_count'] if most_viewed_frames else 0} views). "
        f"Most preferred frame geometry is '{top_shape}' with '{top_color}' coloration. Maintain prioritized stock in these models."
    )

    return {
        "status": "success",
        "total_views": total_views,
        "total_selections": total_selections,
        "unique_customers": unique_customers,
        "most_viewed_frames": most_viewed_frames,
        "most_selected_frames": most_selected_frames,
        "most_preferred_shapes": most_preferred_shapes,
        "most_preferred_colors": most_preferred_colors,
        "smart_recommendation": smart_rec
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
            "doctor_id": a.doctor_id,
            "doctor_name": a.doctor.name if a.doctor else None,
            "doctor_notes": a.doctor_notes,
            "selected_frames": frames,
            "selected_frames_count": len(frames)
        })
    return results
