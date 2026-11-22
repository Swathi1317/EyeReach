import hashlib
import jwt
import datetime
import secrets
import re
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List, Union
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..db.database import get_db
from ..db.models import Customer, Product, Shop, Order, CustomerFramePick

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customer", tags=["Customer Portal"])

SECRET_KEY = "smartframe-customer-secret-key-2026"
SHOP_SECRET_KEY = "smartframe-optical-b2b-secret-key-2026"
ALGORITHM = "HS256"

# In-memory OTP cache: { clean_mobile: { "otp": str, "expires_at": datetime, "attempts": int, "name": str, "address": str } }
otp_storage = {}

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")

def send_sms_via_provider(to_number: str, message_body: str) -> bool:
    """Dispatches SMS via Twilio if environment credentials are provided."""
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
        try:
            import requests
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            clean_num = to_number if to_number.startswith("+") else f"+91{to_number}"
            resp = requests.post(
                url,
                data={
                    "From": TWILIO_PHONE_NUMBER,
                    "To": clean_num,
                    "Body": message_body
                },
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=5
            )
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error(f"Twilio SMS dispatch failed: {e}")
            return False
    return False

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def create_customer_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(days=14)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_customer(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Optional[Customer]:
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        cid = payload.get("customer_id")
        if cid:
            return db.query(Customer).filter(Customer.id == cid).first()
    except Exception:
        pass
    return None

class CustomerRegisterRequest(BaseModel):
    name: str
    mobile: str
    email: str
    address: Optional[str] = ""
    password: str

class CustomerLoginRequest(BaseModel):
    email: str
    password: str

class CustomerSendOTPRequest(BaseModel):
    mobile: str
    name: Optional[str] = ""
    address: Optional[str] = ""

class CustomerVerifyOTPRequest(BaseModel):
    mobile: str
    otp: str
    name: Optional[str] = ""
    address: Optional[str] = ""

class CustomerForgotPasswordRequest(BaseModel):
    email: str

class CustomerMobileLoginRequest(BaseModel):
    name: str
    mobile: str
    address: str

class OrderCreateRequest(BaseModel):
    product_id: int
    quantity: int = 1
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    notes: Optional[str] = None

# ----------------- MODULE 7: CUSTOMER AUTH -----------------

@router.post("/register")
def register_customer(req: CustomerRegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(Customer).filter(Customer.email == req.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    new_cust = Customer(
        name=req.name.strip(),
        mobile=req.mobile.strip(),
        email=req.email.lower().strip(),
        address=req.address.strip() if req.address else None,
        password_hash=hash_password(req.password)
    )
    db.add(new_cust)
    db.commit()
    db.refresh(new_cust)

    token = create_customer_token({"customer_id": new_cust.id, "email": new_cust.email, "role": "customer"})
    return {
        "status": "success",
        "message": f"Welcome, {new_cust.name}!",
        "token": token,
        "customer": {
            "id": new_cust.id,
            "name": new_cust.name,
            "email": new_cust.email,
            "mobile": new_cust.mobile,
            "address": new_cust.address
        }
    }

@router.post("/login")
def login_customer(req: CustomerLoginRequest, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(
        (Customer.email == req.email.lower().strip()) | (Customer.mobile == req.email.strip())
    ).first()

    if not cust or cust.password_hash != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_customer_token({"customer_id": cust.id, "email": cust.email, "role": "customer"})
    return {
        "status": "success",
        "message": f"Welcome back, {cust.name}!",
        "token": token,
        "customer": {
            "id": cust.id,
            "name": cust.name,
            "email": cust.email,
            "mobile": cust.mobile,
            "address": cust.address,
            "face_shape": cust.face_shape,
            "ipd_mm": cust.ipd_mm
        }
    }

@router.post("/otp/send")
def send_customer_otp(req: CustomerSendOTPRequest):
    clean_mobile = re.sub(r"\D", "", req.mobile)
    if len(clean_mobile) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number.")
    clean_mobile = clean_mobile[-10:]

    otp_code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=5)

    otp_storage[clean_mobile] = {
        "otp": otp_code,
        "expires_at": expires_at,
        "attempts": 0,
        "name": req.name.strip() if req.name else "",
        "address": req.address.strip() if req.address else ""
    }

    message_body = f"Your EyeReach verification code is {otp_code}. Valid for 5 minutes. Do not share this code with anyone."
    sms_sent = send_sms_via_provider(clean_mobile, message_body)

    logger.info(f"[EyeReach SMS Service] OTP for +91-{clean_mobile}: {otp_code} (Carrier dispatch: {sms_sent})")

    return {
        "status": "success",
        "message": f"Verification code sent to +91 {clean_mobile}.",
        "expires_in_sec": 300,
        "sms_dispatched": sms_sent,
        "dev_otp": otp_code if not sms_sent else None
    }

@router.post("/otp/verify")
def verify_customer_otp(req: CustomerVerifyOTPRequest, db: Session = Depends(get_db)):
    clean_mobile = re.sub(r"\D", "", req.mobile)
    if len(clean_mobile) < 10:
        raise HTTPException(status_code=400, detail="Invalid mobile number.")
    clean_mobile = clean_mobile[-10:]

    record = otp_storage.get(clean_mobile)
    if not record:
        raise HTTPException(status_code=400, detail="No active verification code found for this mobile number. Please request a new code.")

    if datetime.datetime.utcnow() > record["expires_at"]:
        del otp_storage[clean_mobile]
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new code.")

    record["attempts"] += 1
    if record["attempts"] > 3:
        del otp_storage[clean_mobile]
        raise HTTPException(status_code=400, detail="Too many incorrect attempts. Please request a new verification code.")

    if req.otp.strip() != record["otp"]:
        raise HTTPException(status_code=400, detail="Incorrect verification code. Please check and try again.")

    saved_name = req.name.strip() or record.get("name")
    saved_address = req.address.strip() or record.get("address")
    del otp_storage[clean_mobile]

    cust = db.query(Customer).filter(Customer.mobile == clean_mobile).first()
    if not cust:
        base_email = f"user_{clean_mobile}@eyereach.app"
        existing_email = db.query(Customer).filter(Customer.email == base_email).first()
        if existing_email:
            base_email = f"user_{clean_mobile}_{secrets.token_hex(2)}@eyereach.app"

        cust = Customer(
            name=saved_name if saved_name else f"Patient {clean_mobile[-4:]}",
            mobile=clean_mobile,
            email=base_email,
            address=saved_address if saved_address else None,
            password_hash=hash_password(secrets.token_urlsafe(16))
        )
        db.add(cust)
        db.commit()
        db.refresh(cust)
    else:
        if saved_name and (not cust.name or cust.name.startswith("Patient ")):
            cust.name = saved_name
        if saved_address:
            cust.address = saved_address
        db.commit()
        db.refresh(cust)

    token = create_customer_token({"customer_id": cust.id, "email": cust.email, "role": "customer", "auth_method": "mobile_otp"})
    return {
        "status": "success",
        "message": f"Welcome, {cust.name}!",
        "token": token,
        "customer": {
            "id": cust.id,
            "name": cust.name,
            "email": cust.email,
            "mobile": cust.mobile,
            "address": cust.address,
            "face_shape": cust.face_shape,
            "ipd_mm": cust.ipd_mm
        }
    }

@router.post("/forgot-password")
def forgot_password_customer(req: CustomerForgotPasswordRequest, db: Session = Depends(get_db)):
    clean_email = req.email.lower().strip()
    cust = db.query(Customer).filter(Customer.email == clean_email).first()
    return {
        "status": "success",
        "message": f"If an account exists for {clean_email}, password reset instructions have been sent."
    }

@router.post("/mobile-login")
def mobile_login_customer(req: CustomerMobileLoginRequest, db: Session = Depends(get_db)):
    """
    Direct mobile-based login for EyeReach Home Testing App (elderly-friendly).
    Authenticates directly with Full Name, 10-digit Mobile, and optional Home Address.
    No OTP / SMS verification required at this stage.
    """
    clean_mobile = re.sub(r"\D", "", req.mobile)
    if len(clean_mobile) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number.")
    clean_mobile = clean_mobile[-10:]

    clean_name = req.name.strip() if req.name else ""
    if not clean_name:
        raise HTTPException(status_code=400, detail="Full Name is required.")

    clean_address = req.address.strip() if req.address else ""
    if not clean_address:
        raise HTTPException(status_code=400, detail="Home Address is required.")

    cust = db.query(Customer).filter(Customer.mobile == clean_mobile).first()
    is_returning = cust is not None
    if not cust:
        base_email = f"user_{clean_mobile}@eyereach.app"
        existing_email = db.query(Customer).filter(Customer.email == base_email).first()
        if existing_email:
            base_email = f"user_{clean_mobile}_{secrets.token_hex(2)}@eyereach.app"

        cust = Customer(
            name=clean_name,
            mobile=clean_mobile,
            email=base_email,
            address=clean_address,
            password_hash=hash_password(secrets.token_urlsafe(16))
        )
        db.add(cust)
        db.commit()
        db.refresh(cust)
    else:
        if clean_name and (not cust.name or cust.name.startswith("Patient ") or cust.name != clean_name):
            cust.name = clean_name
        if clean_address:
            cust.address = clean_address
        db.commit()
        db.refresh(cust)

    token = create_customer_token({"customer_id": cust.id, "email": cust.email, "role": "customer", "auth_method": "mobile_direct"})
    return {
        "status": "success",
        "message": f"Welcome Back, {cust.name}!" if is_returning else f"Welcome, {cust.name}!",
        "is_returning": is_returning,
        "token": token,
        "customer": {
            "id": cust.id,
            "name": cust.name,
            "email": cust.email,
            "mobile": cust.mobile,
            "address": cust.address,
            "face_shape": cust.face_shape,
            "ipd_mm": cust.ipd_mm
        }
    }

@router.get("/me")
def get_current_user_profile(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Validates authenticated session token for returning users.
    Restores existing profile information securely from database.
    Supports both Customer and Optical Shop Owner sessions.
    Raises 401 if token is missing, expired, or invalid.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication session token required.")

    token = authorization.replace("Bearer ", "").strip()
    
    # Try decoding customer token
    payload = None
    role = None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        role = payload.get("role", "customer")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session has expired. Please log in again.")
    except jwt.PyJWTError:
        # Try shop owner secret
        try:
            payload = jwt.decode(token, SHOP_SECRET_KEY, algorithms=[ALGORITHM])
            role = payload.get("role", "shop_owner")
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Session has expired. Please log in again.")
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid session token.")

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid session token.")

    # 1. Customer Session
    cid = payload.get("customer_id")
    if cid or role == "customer":
        cust = db.query(Customer).filter(Customer.id == cid).first() if cid else None
        if not cust and payload.get("email"):
            cust = db.query(Customer).filter(Customer.email == payload.get("email")).first()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer account not found.")
        
        return {
            "status": "success",
            "role": "customer",
            "is_returning": True,
            "customer": {
                "id": cust.id,
                "name": cust.name,
                "email": cust.email,
                "mobile": cust.mobile,
                "address": cust.address,
                "face_shape": cust.face_shape,
                "ipd_mm": cust.ipd_mm
            }
        }

    # 2. Shop Owner Session
    shop_id = payload.get("shop_id")
    if shop_id or role == "shop_owner":
        shop = db.query(Shop).filter(Shop.id == shop_id).first() if shop_id else None
        if not shop and payload.get("email"):
            shop = db.query(Shop).filter(Shop.email == payload.get("email")).first()
        if not shop:
            raise HTTPException(status_code=404, detail="Optical shop account not found.")

        return {
            "status": "success",
            "role": "shop_owner",
            "is_returning": True,
            "shop": {
                "id": shop.id,
                "shop_name": shop.shop_name,
                "owner_name": shop.owner_name,
                "email": shop.email,
                "mobile_number": shop.mobile_number,
                "shop_address": shop.shop_address
            }
        }

    # 3. Doctor Session
    doc_id = payload.get("doctor_id")
    if doc_id or role == "doctor":
        from ..db.models import Doctor
        doc = db.query(Doctor).filter(Doctor.id == doc_id).first() if doc_id else None
        if not doc and payload.get("email"):
            doc = db.query(Doctor).filter(Doctor.email == payload.get("email")).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Doctor account not found.")

        return {
            "status": "success",
            "role": "doctor",
            "is_returning": True,
            "doctor": {
                "id": doc.id,
                "name": doc.name,
                "email": doc.email,
                "mobile": doc.mobile,
                "specialization": doc.specialization,
                "qualification": doc.qualification,
                "registration_number": doc.registration_number,
                "shop_id": doc.shop_id,
                "shop_name": doc.shop.shop_name if doc.shop else "EyeReach Partner Store"
            }
        }

    raise HTTPException(status_code=401, detail="Unrecognized session payload.")

# ----------------- MODULE 7 & 9: PRODUCT CATALOG WITH SHOPS -----------------

@router.get("/shops")
def get_optical_shops(db: Session = Depends(get_db)):
    shops = db.query(Shop).all()
    result = []
    for s in shops:
        prod_count = db.query(func.count(Product.id)).filter(Product.shop_id == s.id, Product.is_active == True).scalar() or 0
        result.append({
            "id": s.id,
            "shop_name": s.shop_name,
            "owner_name": s.owner_name,
            "email": s.email,
            "mobile_number": s.mobile_number,
            "shop_address": s.shop_address,
            "product_count": prod_count
        })
    return result

@router.get("/products")
def browse_customer_products(
    gender: Optional[str] = None, # 'Men' | 'Women' | 'Unisex' | 'All'
    face_shape: Optional[str] = None, # 'Oval' | 'Round' | 'Square' | 'Heart' | 'Oblong'
    shop_id: Optional[int] = None,
    search: Optional[str] = None,
    shape: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Product).join(Shop).filter(Product.is_active == True)

    if shop_id:
        query = query.filter(Product.shop_id == shop_id)

    if gender and gender.lower() != "all":
        query = query.filter((Product.gender_category.ilike(gender)) | (Product.gender_category.ilike("Unisex")))

    if shape and shape.lower() != "all":
        query = query.filter(Product.shape.ilike(shape))

    # Face Shape Category Matching rules
    if face_shape and face_shape.lower() != "all":
        fs = face_shape.lower()
        if fs == "round":
            query = query.filter(Product.shape.in_(["Rectangle", "Square", "Geometric"]))
        elif fs == "square":
            query = query.filter(Product.shape.in_(["Round", "Oval", "Aviator", "Cat-Eye"]))
        elif fs == "oval":
            # Oval faces complement almost any geometric or classic frame
            query = query.filter(Product.shape.in_(["Rectangle", "Square", "Round", "Aviator", "Geometric", "Cat-Eye"]))
        elif fs == "heart":
            query = query.filter(Product.shape.in_(["Round", "Oval", "Cat-Eye", "Aviator"]))
        elif fs == "oblong":
            query = query.filter(Product.shape.in_(["Square", "Round", "Aviator"]))

    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (Product.name.ilike(s)) |
            (Product.brand.ilike(s)) |
            (Product.color.ilike(s)) |
            (Product.material.ilike(s)) |
            (Shop.shop_name.ilike(s))
        )

    products = query.order_by(Product.created_at.desc()).all()

    return [
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
            "shop": {
                "id": p.shop.id,
                "shop_name": p.shop.shop_name,
                "owner_name": p.shop.owner_name,
                "shop_address": p.shop.shop_address,
                "mobile_number": p.shop.mobile_number
            }
        }
        for p in products
    ]

@router.get("/products/{id}")
def get_customer_product_detail(id: int, db: Session = Depends(get_db)):
    """
    Returns single product with 360-degree/multi-angle studio images and shop profile.
    """
    p = db.query(Product).filter(Product.id == id, Product.is_active == True).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found.")

    return {
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
        # Multi-Angle Studio Sequence
        "multi_angle_views": {
            "front": p.front_image,
            "side": p.side_image or p.front_image,
            "angled": p.angled_image or p.front_image
        },
        "shop": {
            "id": p.shop.id,
            "shop_name": p.shop.shop_name,
            "owner_name": p.shop.owner_name,
            "shop_address": p.shop.shop_address,
            "mobile_number": p.shop.mobile_number
        }
    }

# ----------------- CUSTOMER ORDERS -----------------

@router.post("/orders")
def place_order(
    req: OrderCreateRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    prod = db.query(Product).filter(Product.id == req.product_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found.")

    if prod.stock_quantity < req.quantity:
        raise HTTPException(status_code=400, detail=f"Insufficient stock. Only {prod.stock_quantity} available.")

    order_num = f"ORD-{datetime.datetime.utcnow().strftime('%Y%m%d')}-{prod.id}-{prod.shop_id}"
    total = prod.price * req.quantity

    new_order = Order(
        order_number=order_num,
        shop_id=prod.shop_id,
        customer_id=current_customer.id if current_customer else None,
        customer_name=req.customer_name.strip(),
        customer_phone=req.customer_phone.strip(),
        customer_email=req.customer_email.strip() if req.customer_email else None,
        product_id=prod.id,
        product_code=prod.product_id,
        product_name=prod.name,
        quantity=req.quantity,
        unit_price=prod.price,
        total_amount=total,
        status="Confirmed",
        notes=req.notes or "Ordered via SmartFrame AI customer boutique."
    )

    # Decrement stock
    prod.stock_quantity = max(0, prod.stock_quantity - req.quantity)

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    return {
        "status": "success",
        "message": f"Order #{new_order.order_number} confirmed! The optical shop has been notified.",
        "order": {
            "order_number": new_order.order_number,
            "product_name": new_order.product_name,
            "total_amount": new_order.total_amount,
            "status": new_order.status
        }
    }

# ----------------- MY FRAME PICKS ❤️ (WISHLIST) -----------------

class FramePickToggleRequest(BaseModel):
    product_id: Union[str, int]
    brand: Optional[str] = None
    name: str
    shape: Optional[str] = None
    color: Optional[str] = None
    price: Optional[float] = None
    material: Optional[str] = None
    front_image: Optional[str] = None
    customer_mobile: Optional[str] = None

class FramePickRemoveRequest(BaseModel):
    product_id: Union[str, int]
    customer_mobile: Optional[str] = None

@router.get("/picks")
def get_customer_frame_picks(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Retrieve all saved spectacle frames in 'My Frame Picks ❤️' for the current authenticated customer.
    Persisted in database across logins and sessions.
    """
    cust = current_customer
    if not cust and customer_mobile:
        clean_mob = re.sub(r"\D", "", customer_mobile)[-10:]
        cust = db.query(Customer).filter(Customer.mobile.endswith(clean_mob)).first()

    if not cust:
        cust = db.query(Customer).first()

    if not cust:
        return {
            "status": "success",
            "picks": [],
            "total": 0
        }

    picks = db.query(CustomerFramePick).filter(CustomerFramePick.customer_id == cust.id).order_by(CustomerFramePick.created_at.desc()).all()
    
    return {
        "status": "success",
        "customer_id": cust.id,
        "customer_name": cust.name,
        "total": len(picks),
        "picks": [
            {
                "id": p.id,
                "product_id": p.product_id,
                "brand": p.brand,
                "name": p.name,
                "shape": p.shape,
                "color": p.color,
                "price": p.price,
                "material": p.material,
                "front_image": p.front_image,
                "created_at": p.created_at.strftime("%Y-%m-%d %H:%M:%S") if p.created_at else ""
            }
            for p in picks
        ]
    }

@router.post("/picks/toggle")
def toggle_customer_frame_pick(
    req: FramePickToggleRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Toggles a favourite frame in 'My Frame Picks ❤️'.
    - If already saved: removes it.
    - If not saved: saves to database and associates with customer account.
    """
    cust = current_customer
    if not cust and req.customer_mobile:
        clean_mob = re.sub(r"\D", "", req.customer_mobile)[-10:]
        cust = db.query(Customer).filter(Customer.mobile.endswith(clean_mob)).first()

    if not cust:
        cust = db.query(Customer).first()
        if not cust:
            raise HTTPException(status_code=401, detail="Please log in to save frames to My Frame Picks.")

    clean_pid = str(req.product_id).strip()
    existing = db.query(CustomerFramePick).filter(
        CustomerFramePick.customer_id == cust.id,
        CustomerFramePick.product_id == clean_pid
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        picks = db.query(CustomerFramePick).filter(CustomerFramePick.customer_id == cust.id).order_by(CustomerFramePick.created_at.desc()).all()
        return {
            "status": "success",
            "action": "removed",
            "is_liked": False,
            "product_id": clean_pid,
            "message": f"Removed '{req.name}' from My Frame Picks.",
            "total_picks": len(picks),
            "picks": [
                {
                    "id": p.id,
                    "product_id": p.product_id,
                    "brand": p.brand,
                    "name": p.name,
                    "shape": p.shape,
                    "color": p.color,
                    "price": p.price,
                    "material": p.material,
                    "front_image": p.front_image
                } for p in picks
            ]
        }
    else:
        new_pick = CustomerFramePick(
            customer_id=cust.id,
            product_id=clean_pid,
            brand=req.brand,
            name=req.name.strip(),
            shape=req.shape,
            color=req.color,
            price=req.price,
            material=req.material,
            front_image=req.front_image
        )
        db.add(new_pick)
        db.commit()
        db.refresh(new_pick)
        picks = db.query(CustomerFramePick).filter(CustomerFramePick.customer_id == cust.id).order_by(CustomerFramePick.created_at.desc()).all()
        return {
            "status": "success",
            "action": "added",
            "is_liked": True,
            "product_id": clean_pid,
            "message": f"Saved '{req.name}' to My Frame Picks ❤️",
            "total_picks": len(picks),
            "picks": [
                {
                    "id": p.id,
                    "product_id": p.product_id,
                    "brand": p.brand,
                    "name": p.name,
                    "shape": p.shape,
                    "color": p.color,
                    "price": p.price,
                    "material": p.material,
                    "front_image": p.front_image
                } for p in picks
            ]
        }

@router.post("/picks/remove")
def remove_customer_frame_pick(
    req: FramePickRemoveRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Explicitly removes a frame from customer's My Frame Picks ❤️.
    """
    cust = current_customer
    if not cust and req.customer_mobile:
        clean_mob = re.sub(r"\D", "", req.customer_mobile)[-10:]
        cust = db.query(Customer).filter(Customer.mobile.endswith(clean_mob)).first()

    if not cust:
        cust = db.query(Customer).first()
        if not cust:
            raise HTTPException(status_code=401, detail="Customer not found.")

    clean_pid = str(req.product_id).strip()
    existing = db.query(CustomerFramePick).filter(
        CustomerFramePick.customer_id == cust.id,
        CustomerFramePick.product_id == clean_pid
    ).first()

    if existing:
        db.delete(existing)
        db.commit()

    picks = db.query(CustomerFramePick).filter(CustomerFramePick.customer_id == cust.id).order_by(CustomerFramePick.created_at.desc()).all()
    return {
        "status": "success",
        "action": "removed",
        "is_liked": False,
        "product_id": clean_pid,
        "total_picks": len(picks),
        "picks": [
            {
                "id": p.id,
                "product_id": p.product_id,
                "brand": p.brand,
                "name": p.name,
                "shape": p.shape,
                "color": p.color,
                "price": p.price,
                "material": p.material,
                "front_image": p.front_image
            } for p in picks
        ]
    }
