import hashlib
import jwt
import datetime
import secrets
import re
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
import json
import random
from typing import Optional, List, Union
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..db.database import get_db
from ..db.models import Customer, Product, Shop, Order, CustomerFramePick, CartItem, CustomerNotification, Appointment, Doctor

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
            query = query.filter(Product.shape.in_(["Rectangle", "Square", "Geometric", "Wayfarer", "Browline"]))
        elif fs == "square":
            query = query.filter(Product.shape.in_(["Round", "Oval", "Aviator", "Cat-Eye", "Cat Eye", "Browline"]))
        elif fs == "oval":
            # Oval faces complement almost any geometric or classic frame
            query = query.filter(Product.shape.in_(["Rectangle", "Square", "Round", "Aviator", "Geometric", "Cat-Eye", "Cat Eye", "Oval", "Browline"]))
        elif fs == "heart":
            query = query.filter(Product.shape.in_(["Round", "Oval", "Cat-Eye", "Cat Eye", "Aviator", "Browline"]))
        elif fs == "diamond":
            query = query.filter(Product.shape.in_(["Browline", "Cat-Eye", "Cat Eye", "Oval", "Round"]))
        elif fs == "oblong":
            query = query.filter(Product.shape.in_(["Square", "Round", "Aviator", "Rectangle", "Wayfarer"]))

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
            "shop_id": p.shop_id,
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
        "shop_id": p.shop_id,
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

@router.get("/my-picks")
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

# ----------------- CUSTOMER PROFILE MANAGEMENT -----------------

class CustomerProfileUpdateRequest(BaseModel):
    name: str
    mobile: str
    email: str
    address: Optional[str] = ""

@router.put("/profile")
def update_customer_profile(
    req: CustomerProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Update customer profile details: full name, mobile number, email, and residential address.
    """
    cust = current_customer
    if not cust and authorization:
        try:
            token = authorization.replace("Bearer ", "").strip()
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            cid = payload.get("customer_id")
            if cid:
                cust = db.query(Customer).filter(Customer.id == cid).first()
        except Exception:
            pass

    if not cust and req.mobile:
        clean_mob = re.sub(r"\D", "", req.mobile)[-10:]
        cust = db.query(Customer).filter(Customer.mobile.endswith(clean_mob)).first()

    if not cust and req.email:
        cust = db.query(Customer).filter(Customer.email == req.email.lower().strip()).first()

    if not cust:
        cust = db.query(Customer).first()

    if not cust:
        raise HTTPException(status_code=401, detail="Authentication session required to update profile.")

    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Full Name is required.")

    clean_mobile = re.sub(r"\D", "", req.mobile)
    if len(clean_mobile) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number.")
    clean_mobile = clean_mobile[-10:]

    clean_email = req.email.lower().strip()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    # Check email conflict
    conflict = db.query(Customer).filter(Customer.email == clean_email, Customer.id != cust.id).first()
    if conflict:
        raise HTTPException(status_code=400, detail="Another account is already using this email address.")

    cust.name = req.name.strip()
    cust.mobile = clean_mobile
    cust.email = clean_email
    cust.address = req.address.strip() if req.address else ""
    db.commit()
    db.refresh(cust)

    # Issue renewed token
    token = create_customer_token({"customer_id": cust.id, "email": cust.email, "role": "customer"})

    # Record notification
    notif = CustomerNotification(
        customer_id=cust.id,
        title="Profile Updated",
        message="Your profile information and residential address have been saved successfully.",
        notification_type="reminder"
    )
    db.add(notif)
    db.commit()

    return {
        "status": "success",
        "message": "Profile updated successfully!",
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

# ----------------- SHOPPING CART & MULTI-SHOP MANAGEMENT -----------------

class CartItemAddRequest(BaseModel):
    product_id: int
    quantity: int = 1
    selected_for_trial: bool = False
    customer_mobile: Optional[str] = None

class CartItemUpdateRequest(BaseModel):
    quantity: Optional[int] = None
    selected_for_trial: Optional[bool] = None

class CartMoveFromWishlistRequest(BaseModel):
    product_id: Union[str, int]
    customer_mobile: Optional[str] = None

class CartTrialSelectionRequest(BaseModel):
    selected_product_ids: List[Union[str, int]]
    customer_mobile: Optional[str] = None

class CartCheckoutRequest(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    notes: Optional[str] = None
    has_prescription: bool = False
    prescription_url: Optional[str] = None
    prescription_text: Optional[str] = None
    is_home_trial: bool = False
    is_vision_test_required: bool = False

def resolve_customer(current_customer: Optional[Customer], customer_mobile: Optional[str], db: Session) -> Optional[Customer]:
    if current_customer:
        return current_customer
    if customer_mobile:
        clean_mob = re.sub(r"\D", "", customer_mobile)[-10:]
        c = db.query(Customer).filter(Customer.mobile.endswith(clean_mob)).first()
        if c:
            return c
    return db.query(Customer).first()

@router.get("/cart")
def get_customer_cart(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, customer_mobile, db)
    if not cust:
        return {
            "status": "success",
            "items": [],
            "total_items": 0,
            "total_amount": 0.0,
            "trial_frames_count": 0
        }

    items = db.query(CartItem).filter(CartItem.customer_id == cust.id).all()
    formatted = []
    total_amount = 0.0
    trial_count = 0

    for item in items:
        p = item.product
        if not p or not p.is_active:
            continue
        line_total = round(p.price * item.quantity, 2)
        total_amount += line_total
        if item.selected_for_trial:
            trial_count += 1
        formatted.append({
            "id": item.id,
            "product_id": p.id,
            "product_code": p.product_id,
            "name": p.name,
            "brand": p.brand,
            "shape": p.shape,
            "material": p.material,
            "color": p.color,
            "frame_type": p.frame_type,
            "size": p.size,
            "lens_width_mm": p.lens_width_mm,
            "bridge_width_mm": p.bridge_width_mm,
            "temple_length_mm": p.temple_length_mm,
            "price": p.price,
            "quantity": item.quantity,
            "line_total": line_total,
            "stock_quantity": p.stock_quantity,
            "in_stock": p.stock_quantity > 0,
            "front_image": p.front_image,
            "selected_for_trial": item.selected_for_trial,
            "shop": {
                "id": p.shop.id,
                "shop_name": p.shop.shop_name,
                "owner_name": p.shop.owner_name,
                "shop_address": p.shop.shop_address,
                "mobile_number": p.shop.mobile_number,
                "operating_hours": p.shop.operating_hours,
                "home_visit_available": p.shop.home_visit_available
            }
        })

    return {
        "status": "success",
        "customer_id": cust.id,
        "customer_name": cust.name,
        "items": formatted,
        "total_items": len(formatted),
        "total_amount": round(total_amount, 2),
        "trial_frames_count": trial_count,
        "max_trial_frames": 10
    }

@router.post("/cart")
def add_to_cart(
    req: CartItemAddRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, req.customer_mobile, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Please log in to add items to your cart.")

    prod = db.query(Product).filter(Product.id == req.product_id, Product.is_active == True).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found or inactive.")

    if prod.stock_quantity <= 0:
        raise HTTPException(status_code=400, detail=f"'{prod.name}' is currently out of stock.")

    # Check trial frames count limit (max 10)
    if req.selected_for_trial:
        current_trial_count = db.query(CartItem).filter(
            CartItem.customer_id == cust.id,
            CartItem.selected_for_trial == True
        ).count()
        if current_trial_count >= 10:
            raise HTTPException(status_code=400, detail="You can select a maximum of 10 frames for home trial.")

    existing_item = db.query(CartItem).filter(
        CartItem.customer_id == cust.id,
        CartItem.product_id == prod.id
    ).first()

    if existing_item:
        existing_item.quantity += max(1, req.quantity)
        if req.selected_for_trial:
            existing_item.selected_for_trial = True
    else:
        new_item = CartItem(
            customer_id=cust.id,
            product_id=prod.id,
            quantity=max(1, req.quantity),
            selected_for_trial=req.selected_for_trial
        )
        db.add(new_item)

    db.commit()
    return {
        "status": "success",
        "message": f"Added '{prod.name}' to your cart.",
        "product_name": prod.name,
        "shop_name": prod.shop.shop_name
    }

@router.put("/cart/{item_id}")
def update_cart_item(
    item_id: int,
    req: CartItemUpdateRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    item = db.query(CartItem).filter(CartItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Cart item not found.")

    if req.quantity is not None:
        if req.quantity <= 0:
            db.delete(item)
            db.commit()
            return {"status": "success", "message": "Item removed from cart."}
        item.quantity = req.quantity

    if req.selected_for_trial is not None:
        if req.selected_for_trial and not item.selected_for_trial:
            current_trial_count = db.query(CartItem).filter(
                CartItem.customer_id == item.customer_id,
                CartItem.selected_for_trial == True
            ).count()
            if current_trial_count >= 10:
                raise HTTPException(status_code=400, detail="Maximum 10 frames can be selected for home trial.")
        item.selected_for_trial = req.selected_for_trial

    db.commit()
    return {
        "status": "success",
        "message": "Cart updated successfully.",
        "item": {
            "id": item.id,
            "quantity": item.quantity,
            "selected_for_trial": item.selected_for_trial
        }
    }

@router.delete("/cart/{item_id}")
def remove_from_cart(
    item_id: int,
    db: Session = Depends(get_db)
):
    item = db.query(CartItem).filter(CartItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Cart item not found.")
    db.delete(item)
    db.commit()
    return {"status": "success", "message": "Item removed from cart."}

@router.post("/cart/move-from-wishlist")
def move_wishlist_to_cart(
    req: CartMoveFromWishlistRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, req.customer_mobile, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Please log in to manage your cart.")

    clean_pid = str(req.product_id).strip()
    if clean_pid.isdigit():
        prod = db.query(Product).filter((Product.id == int(clean_pid)) | (Product.product_id == clean_pid)).first()
    else:
        prod = db.query(Product).filter(Product.product_id == clean_pid).first()

    if not prod:
        raise HTTPException(status_code=404, detail="Product not found.")

    # Add to cart
    existing_item = db.query(CartItem).filter(
        CartItem.customer_id == cust.id,
        CartItem.product_id == prod.id
    ).first()
    if existing_item:
        existing_item.quantity += 1
    else:
        new_item = CartItem(customer_id=cust.id, product_id=prod.id, quantity=1)
        db.add(new_item)

    # Remove from wishlist picks
    wishlist_pick = db.query(CustomerFramePick).filter(
        CustomerFramePick.customer_id == cust.id,
        (CustomerFramePick.product_id == clean_pid) | (CustomerFramePick.product_id == str(prod.id))
    ).first()
    if wishlist_pick:
        db.delete(wishlist_pick)

    db.commit()
    return {
        "status": "success",
        "message": f"Moved '{prod.name}' from Wishlist to Cart.",
        "product_name": prod.name,
        "shop_name": prod.shop.shop_name
    }

@router.post("/cart/set-trial-selection")
def set_trial_selection(
    req: CartTrialSelectionRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Select up to 10 frames from cart for home trial.
    """
    cust = resolve_customer(current_customer, req.customer_mobile, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Customer login required.")

    if len(req.selected_product_ids) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 frames can be selected for home trial.")

    cart_items = db.query(CartItem).filter(CartItem.customer_id == cust.id).all()
    target_ids = set(str(pid) for pid in req.selected_product_ids)

    for item in cart_items:
        is_selected = (str(item.product_id) in target_ids) or (str(item.product.product_id) in target_ids)
        item.selected_for_trial = is_selected

    db.commit()
    selected_count = sum(1 for item in cart_items if item.selected_for_trial)
    return {
        "status": "success",
        "message": f"Updated home trial selection ({selected_count}/10 frames selected).",
        "selected_count": selected_count
    }

@router.post("/cart/checkout")
def checkout_cart(
    req: CartCheckoutRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Multi-Shop Order Placement:
    Separates items in the customer's cart so each optical shop receives only its own frames.
    Preserves prescription details, home trial flag, and delivery address.
    """
    cust = resolve_customer(current_customer, req.customer_phone, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Please log in to place an order.")

    cart_items = db.query(CartItem).filter(CartItem.customer_id == cust.id).all()
    if not cart_items:
        raise HTTPException(status_code=400, detail="Your cart is empty. Add frames before checking out.")

    cust_name = req.customer_name.strip() if req.customer_name else cust.name
    cust_phone = req.customer_phone.strip() if req.customer_phone else cust.mobile
    cust_email = req.customer_email.strip() if req.customer_email else cust.email
    cust_address = req.customer_address.strip() if req.customer_address else (cust.address or "Address provided on delivery")

    # Update customer profile address if newly provided
    if req.customer_address and not cust.address:
        cust.address = req.customer_address.strip()

    created_orders = []
    # Group items by shop
    for item in cart_items:
        prod = item.product
        if not prod or not prod.is_active:
            continue

        # Check stock
        qty = min(item.quantity, max(1, prod.stock_quantity))
        prod.stock_quantity = max(0, prod.stock_quantity - qty)

        order_num = f"ORD-{datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{prod.id}-{prod.shop_id}-{secrets.token_hex(2)}"
        new_order = Order(
            order_number=order_num,
            shop_id=prod.shop_id,
            customer_id=cust.id,
            customer_name=cust_name,
            customer_phone=cust_phone,
            customer_email=cust_email,
            customer_address=cust_address,
            product_id=prod.id,
            product_code=prod.product_id,
            product_name=prod.name,
            quantity=qty,
            unit_price=prod.price,
            total_amount=round(prod.price * qty, 2),
            status="Order Placed",
            has_prescription=req.has_prescription,
            prescription_url=req.prescription_url,
            prescription_text=req.prescription_text,
            is_home_trial=req.is_home_trial or item.selected_for_trial,
            is_vision_test_required=req.is_vision_test_required,
            notes=req.notes or f"Order placed via EyeReach Multi-Shop Boutique. Supplier: {prod.shop.shop_name}."
        )
        db.add(new_order)
        created_orders.append({
            "order_number": order_num,
            "product_name": prod.name,
            "shop_name": prod.shop.shop_name,
            "shop_id": prod.shop_id,
            "total_amount": round(prod.price * qty, 2)
        })

        # Notify customer
        notif = CustomerNotification(
            customer_id=cust.id,
            shop_id=prod.shop_id,
            title="Order Placed",
            message=f"Your order #{order_num} for '{prod.name}' has been placed with {prod.shop.shop_name}.",
            notification_type="order",
            reference_id=order_num
        )
        db.add(notif)

    # Clear customer cart
    for item in cart_items:
        db.delete(item)

    db.commit()
    return {
        "status": "success",
        "message": f"Successfully placed {len(created_orders)} item order(s) across optical shop partners!",
        "orders": created_orders,
        "total_orders": len(created_orders)
    }

# ----------------- CUSTOMER ORDERS & DELIVERY STATUS -----------------

@router.get("/orders")
def get_customer_orders(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Retrieves all orders placed by the current customer, ordered by newest first.
    Preserves live backend status synchronization with shop inventory updates.
    """
    cust = resolve_customer(current_customer, customer_mobile, db)
    if not cust:
        return {"status": "success", "orders": [], "total": 0}

    clean_mob = re.sub(r"\D", "", cust.mobile)[-10:] if cust.mobile else ""
    orders = db.query(Order).filter(
        (Order.customer_id == cust.id) |
        (Order.customer_phone.endswith(clean_mob) if clean_mob else False)
    ).order_by(Order.created_at.desc()).all()

    results = []
    for o in orders:
        results.append({
            "id": o.id,
            "order_number": o.order_number,
            "product_id": o.product_id,
            "product_code": o.product_code,
            "product_name": o.product_name,
            "quantity": o.quantity,
            "unit_price": o.unit_price,
            "total_amount": o.total_amount,
            "status": o.status,
            "rejection_reason": o.rejection_reason,
            "shop_id": o.shop_id,
            "shop_name": o.shop.shop_name if o.shop else "Optical Boutique",
            "shop_phone": o.shop.mobile_number if o.shop else None,
            "shop_address": o.shop.shop_address if o.shop else None,
            "created_at": o.created_at.strftime("%d %b %Y, %I:%M %p") if o.created_at else "",
            "customer_address": o.customer_address,
            "has_prescription": o.has_prescription,
            "prescription_text": o.prescription_text,
            "is_home_trial": o.is_home_trial,
            "notes": o.notes,
            "front_image": o.product.front_image if o.product else None
        })

    return {"status": "success", "orders": results, "total": len(results)}

@router.patch("/orders/{id}/received")
def confirm_order_received(
    id: int,
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Customer Delivery Confirmation endpoint.
    Transitions order status from Delivered to Customer Received.
    Synchronizes status with optical shop dashboard and logs confirmation notification.
    """
    cust = resolve_customer(current_customer, customer_mobile, db)
    order = db.query(Order).filter(Order.id == id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    # Update status to Customer Received
    order.status = "Customer Received"

    notif = CustomerNotification(
        customer_id=order.customer_id or (cust.id if cust else 1),
        shop_id=order.shop_id,
        title="Delivery Received Confirmed",
        message=f"You have confirmed delivery receipt for order #{order.order_number} ('{order.product_name}'). Thank you for choosing EyeReach!",
        notification_type="order",
        reference_id=order.order_number
    )
    db.add(notif)
    db.commit()
    db.refresh(order)

    return {
        "status": "success",
        "message": f"Delivery confirmed! Order #{order.order_number} marked as Customer Received.",
        "order_status": order.status
    }

# ----------------- TWO DISTINCT HOME SERVICES (TRIAL & VISION TEST) -----------------

STANDARD_HOME_SERVICE_SLOTS = [
    {"slot_time": "09:00 AM", "label": "09:00 AM - Morning Slot", "period": "Morning"},
    {"slot_time": "10:30 AM", "label": "10:30 AM - Morning Slot", "period": "Morning"},
    {"slot_time": "12:00 PM", "label": "12:00 PM - Midday Slot", "period": "Midday"},
    {"slot_time": "02:30 PM", "label": "02:30 PM - Afternoon Slot", "period": "Afternoon"},
    {"slot_time": "04:00 PM", "label": "04:00 PM - Evening Slot", "period": "Evening"},
    {"slot_time": "05:30 PM", "label": "05:30 PM - Evening Slot", "period": "Evening"}
]

def parse_time_to_minutes(time_str: str) -> Optional[int]:
    """Converts '09:00 AM', '14:30', '2:30 PM' etc. to minutes from midnight."""
    if not time_str:
        return None
    clean = time_str.strip().upper()
    try:
        if "AM" in clean or "PM" in clean:
            t = datetime.datetime.strptime(clean, "%I:%M %p")
            return t.hour * 60 + t.minute
        elif ":" in clean:
            t = datetime.datetime.strptime(clean, "%H:%M")
            return t.hour * 60 + t.minute
    except Exception:
        pass
    return None

def is_slot_within_hours(slot_time: str, hours_range_str: str) -> bool:
    """Checks if a slot falls within doctor/store operating hours."""
    if not hours_range_str:
        return True
    parts = hours_range_str.split("-")
    if len(parts) != 2:
        return True
    start_min = parse_time_to_minutes(parts[0])
    end_min = parse_time_to_minutes(parts[1])
    slot_min = parse_time_to_minutes(slot_time)
    if start_min is not None and end_min is not None and slot_min is not None:
        return start_min <= slot_min <= end_min
    return True

def is_doctor_on_duty_day(doctor: Doctor, target_date: datetime.date) -> bool:
    """Checks if doctor works on the day of week corresponding to target_date."""
    if not doctor.available_days:
        return True
    weekday_map = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
    day_abbr = weekday_map.get(target_date.weekday())
    days = [d.strip() for d in doctor.available_days.split(",")]
    return any(day_abbr.lower() in d.lower() for d in days)

def calculate_slot_capacity(db: Session, shop_id: Optional[int], target_date_str: str, slot_time: str):
    """
    Calculates active on-duty optometrists vs non-cancelled overlapping bookings.
    Returns: (remaining_capacity: int, total_capacity: int, booked_count: int, available_doctors: List[Doctor])
    """
    try:
        t_date = datetime.date.fromisoformat(target_date_str.strip())
    except Exception:
        return 0, 0, 0, []

    doc_query = db.query(Doctor).filter(Doctor.is_active == True)
    if shop_id:
        doc_query = doc_query.filter((Doctor.shop_id == shop_id) | (Doctor.shop_id == None if shop_id == 1 else False))
    doctors = doc_query.all()
    if not doctors:
        doctors = db.query(Doctor).filter(Doctor.is_active == True).all()

    on_duty_doctors = []
    for d in doctors:
        if (d.is_available is None or d.is_available == True) and is_doctor_on_duty_day(d, t_date) and is_slot_within_hours(slot_time, d.available_hours or "09:00 AM - 06:00 PM"):
            on_duty_doctors.append(d)

    total_capacity = max(1, len(on_duty_doctors))

    # Query active bookings (exclude Cancelled and Rejected)
    existing_query = db.query(Appointment).filter(
        Appointment.appointment_date == target_date_str.strip(),
        Appointment.appointment_time == slot_time.strip(),
        ~Appointment.status.in_(["Cancelled", "Rejected"])
    )
    if shop_id:
        existing_query = existing_query.filter((Appointment.shop_id == shop_id) | (Appointment.shop_id == None if shop_id == 1 else False))

    existing_appts = existing_query.all()
    booked_count = len(existing_appts)
    booked_doc_ids = {a.doctor_id for a in existing_appts if a.doctor_id}

    available_doctors = [d for d in on_duty_doctors if d.id not in booked_doc_ids]
    remaining = max(0, total_capacity - booked_count)
    return remaining, total_capacity, booked_count, available_doctors

@router.get("/available-slots")
def get_available_appointment_slots(
    date: str = Query(..., description="Target date in YYYY-MM-DD"),
    shop_id: Optional[int] = Query(None, description="Optical store ID"),
    db: Session = Depends(get_db)
):
    """
    Dynamically generates appointment slots for a given date and optical shop.
    Considers store operating hours, active optometrists on duty, and existing bookings.
    Slots with 0 remaining capacity are marked as booked/unavailable to prevent double-booking.
    """
    try:
        t_date = datetime.date.fromisoformat(date.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    is_past = t_date < datetime.date.today()
    day_name = t_date.strftime("%A")

    slots_result = []
    for s in STANDARD_HOME_SERVICE_SLOTS:
        rem, tot, bkd, avail_docs = calculate_slot_capacity(db, shop_id, date.strip(), s["slot_time"])
        is_avail = (not is_past) and (rem > 0)
        slots_result.append({
            "slot_time": s["slot_time"],
            "label": s["label"],
            "period": s["period"],
            "is_available": is_avail,
            "remaining_capacity": rem if not is_past else 0,
            "total_capacity": tot,
            "booked_count": bkd,
            "available_optometrists_count": len(avail_docs),
            "status": "Available" if is_avail else ("Past Date" if is_past else "Fully Booked")
        })

    return {
        "status": "success",
        "date": date,
        "day_name": day_name,
        "is_past": is_past,
        "shop_id": shop_id,
        "slots": slots_result,
        "available_slots_count": sum(1 for s in slots_result if s["is_available"])
    }

class HomeServiceBookRequest(BaseModel):
    service_type: str = "both" # "frame_trial" | "vision_test" | "both"
    shop_id: Optional[int] = None
    appointment_date: str
    appointment_time: str
    full_name: str
    mobile_number: str
    email: str
    home_address: str
    purpose: Optional[str] = None
    additional_message: Optional[str] = None
    selected_frames: Optional[List[dict]] = None # Max 10 frames
    has_prescription: bool = False
    prescription_data: Optional[dict] = None
    prescription_file: Optional[str] = None
    face_analysis: Optional[dict] = None

@router.post("/home-services/book")
def book_home_service(
    req: HomeServiceBookRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Supports two separate independent services or both together:
    - Service A: Frame Selection Home Visit (up to 10 frames tried at home)
    - Service B: Home Vision Test (Option 1: existing prescription entered/uploaded; Option 2: new vision test requested)
    - Combined: Frame selection + Home vision examination
    Never forces vision testing if existing prescription is provided.
    Never claims camera measurements determine actual eye power.
    """
    cust = resolve_customer(current_customer, req.mobile_number, db)

    # 1. Validate frames count
    frames = req.selected_frames or []
    if len(frames) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 spectacle frames can be selected for home visit trial.")

    # 2. Validate date
    try:
        appt_d = datetime.date.fromisoformat(req.appointment_date.strip())
        if appt_d < datetime.date.today():
            raise HTTPException(status_code=400, detail="Appointment date cannot be in the past.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    if not req.home_address.strip() or len(req.home_address.strip()) < 5:
        raise HTTPException(status_code=400, detail="Please provide a valid residential address for doorstep service.")

    # 2b. Prevent double-booking for the same customer
    clean_mob = req.mobile_number[-10:] if req.mobile_number else ""
    existing_cust_appt = db.query(Appointment).filter(
        (Appointment.mobile_number.endswith(clean_mob)) | (Appointment.email == req.email.strip()),
        Appointment.appointment_date == req.appointment_date.strip(),
        Appointment.appointment_time == req.appointment_time.strip(),
        ~Appointment.status.in_(["Cancelled", "Rejected"])
    ).first()
    if existing_cust_appt:
        raise HTTPException(
            status_code=400,
            detail=f"You already have an active doorstep appointment ({existing_cust_appt.appointment_id}) booked for {req.appointment_date} at {req.appointment_time}."
        )

    # 3. Determine supplying shop
    target_shop = None
    if req.shop_id:
        target_shop = db.query(Shop).filter(Shop.id == req.shop_id).first()
    if not target_shop and frames:
        first_frame = frames[0]
        pid = first_frame.get("product_id") or first_frame.get("id")
        if pid:
            query = db.query(Product)
            if str(pid).isdigit():
                p = query.filter((Product.id == int(pid)) | (Product.product_id == str(pid))).first()
            else:
                p = query.filter(Product.product_id == str(pid)).first()
            if p and p.shop:
                target_shop = p.shop
    if not target_shop:
        target_shop = db.query(Shop).first()

    norm_service = req.service_type.lower().strip()
    if norm_service not in ["frame_trial", "vision_test", "both"]:
        norm_service = "both"

    # 3b. Verify slot capacity and assign available optometrist for vision tests
    assigned_doc = None
    if norm_service in ["vision_test", "both"]:
        rem, tot, bkd, avail_docs = calculate_slot_capacity(db, target_shop.id if target_shop else None, req.appointment_date.strip(), req.appointment_time.strip())
        if rem <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"The selected time slot ({req.appointment_time}) on {req.appointment_date} is fully booked. Please select an available slot."
            )
        if avail_docs:
            assigned_doc = avail_docs[0]
        else:
            assigned_doc = db.query(Doctor).filter(Doctor.shop_id == (target_shop.id if target_shop else 1), Doctor.is_active == True).first() or db.query(Doctor).filter(Doctor.is_active == True).first()

    shop_title = target_shop.shop_name if target_shop else "EyeReach Partner Store"
    fa = req.face_analysis or {}

    # Case A: Frame Trial at Home (Only)
    if norm_service == "frame_trial":
        appt_num = f"HS-FT-{datetime.date.today().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"
        new_appt = Appointment(
            appointment_id=appt_num,
            appointment_type="home_testing",
            service_type="frame_trial",
            shop_id=target_shop.id if target_shop else 1,
            full_name=req.full_name.strip(),
            mobile_number=req.mobile_number.strip(),
            email=req.email.strip(),
            appointment_date=req.appointment_date.strip(),
            appointment_time=req.appointment_time.strip(),
            meeting_mode=None,
            home_address=req.home_address.strip(),
            purpose="Frame Trial at Home (Up to 10 Frames)",
            additional_message=req.additional_message.strip() if req.additional_message else None,
            status="Pending",
            visit_status="Pending",
            has_prescription=False,
            prescription_file=None,
            prescription_data_json=None,
            selected_frames_json=json.dumps(frames) if frames else "[]",
            face_shape=fa.get("face_shape"),
            ipd_mm=fa.get("ipd_mm"),
            eye_shape=fa.get("eye_shape"),
            face_width_mm=fa.get("face_width_mm"),
            face_length_mm=fa.get("face_length_mm"),
            jaw_width_mm=fa.get("jaw_width_mm"),
            skin_tone=fa.get("skin_tone"),
            undertone=fa.get("undertone"),
            head_circumference_cm=fa.get("head_circumference_cm"),
            face_sketch_image=fa.get("face_sketch_image"),
            face_analysis_summary=fa.get("face_analysis_summary") or "Facial scan measurements for physical frame size verification only.",
            doctor_id=None
        )
        db.add(new_appt)

        # Update customer profile address if not saved
        if cust and not cust.address:
            cust.address = req.home_address.strip()

        notif = CustomerNotification(
            customer_id=cust.id if cust else 1,
            shop_id=target_shop.id if target_shop else 1,
            title="Frame Trial Booking Received",
            message=f"Your Frame Trial at Home request (Ref: {appt_num}) with {len(frames)} frame(s) for {req.appointment_date} at {req.appointment_time} was submitted to {shop_title}.",
            notification_type="home_trial",
            reference_id=appt_num
        )
        db.add(notif)
        db.commit()
        db.refresh(new_appt)

        return {
            "status": "success",
            "appointment_id": new_appt.appointment_id,
            "service_type": "frame_trial",
            "shop_name": shop_title,
            "appointment_date": new_appt.appointment_date,
            "appointment_time": new_appt.appointment_time,
            "home_address": new_appt.home_address,
            "visit_status": new_appt.visit_status,
            "selected_frames_count": len(frames),
            "has_prescription": False,
            "message": f"Your Frame Trial request ({len(frames)} frames) has been received by {shop_title}! You can track its progress in your portal."
        }

    # Case B: Home Vision Test (Only)
    elif norm_service == "vision_test":
        appt_num = f"HS-VT-{datetime.date.today().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"
        doc = assigned_doc or db.query(Doctor).filter(Doctor.shop_id == (target_shop.id if target_shop else 1), Doctor.is_active == True).first()
        if not doc:
            doc = db.query(Doctor).filter(Doctor.is_active == True).first()

        new_appt = Appointment(
            appointment_id=appt_num,
            appointment_type="home_testing",
            service_type="vision_test",
            shop_id=target_shop.id if target_shop else 1,
            full_name=req.full_name.strip(),
            mobile_number=req.mobile_number.strip(),
            email=req.email.strip(),
            appointment_date=req.appointment_date.strip(),
            appointment_time=req.appointment_time.strip(),
            meeting_mode=None,
            home_address=req.home_address.strip(),
            purpose="Home Vision Test",
            additional_message=req.additional_message.strip() if req.additional_message else None,
            status="Pending",
            visit_status="Pending",
            has_prescription=req.has_prescription,
            prescription_file=req.prescription_file,
            prescription_data_json=json.dumps(req.prescription_data) if req.prescription_data else None,
            selected_frames_json="[]",
            face_shape=fa.get("face_shape"),
            ipd_mm=fa.get("ipd_mm"),
            eye_shape=fa.get("eye_shape"),
            face_width_mm=fa.get("face_width_mm"),
            face_length_mm=fa.get("face_length_mm"),
            jaw_width_mm=fa.get("jaw_width_mm"),
            skin_tone=fa.get("skin_tone"),
            undertone=fa.get("undertone"),
            head_circumference_cm=fa.get("head_circumference_cm"),
            face_sketch_image=fa.get("face_sketch_image"),
            face_analysis_summary=fa.get("face_analysis_summary") or "Facial scan measurements for physical frame size verification only.",
            doctor_id=doc.id if doc else None
        )
        db.add(new_appt)

        if cust and not cust.address:
            cust.address = req.home_address.strip()

        notif = CustomerNotification(
            customer_id=cust.id if cust else 1,
            shop_id=target_shop.id if target_shop else 1,
            title="Vision Test Booking Received",
            message=f"Your Home Vision Test appointment request (Ref: {appt_num}) for {req.appointment_date} at {req.appointment_time} was submitted to {shop_title}.",
            notification_type="vision_test",
            reference_id=appt_num
        )
        db.add(notif)
        db.commit()
        db.refresh(new_appt)

        return {
            "status": "success",
            "appointment_id": new_appt.appointment_id,
            "service_type": "vision_test",
            "shop_name": shop_title,
            "appointment_date": new_appt.appointment_date,
            "appointment_time": new_appt.appointment_time,
            "home_address": new_appt.home_address,
            "visit_status": new_appt.visit_status,
            "selected_frames_count": 0,
            "has_prescription": new_appt.has_prescription,
            "message": f"Your Home Vision Test request has been received by {shop_title}! You can track doctor confirmation in your portal."
        }

    # Case C: Both Services (Separate independent appointments and statuses)
    else:
        appt_trial_num = f"HS-FT-{datetime.date.today().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"
        appt_vision_num = f"HS-VT-{datetime.date.today().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"

        doc = assigned_doc or db.query(Doctor).filter(Doctor.shop_id == (target_shop.id if target_shop else 1), Doctor.is_active == True).first()
        if not doc:
            doc = db.query(Doctor).filter(Doctor.is_active == True).first()

        # 1. Frame Trial appointment
        appt_trial = Appointment(
            appointment_id=appt_trial_num,
            appointment_type="home_testing",
            service_type="frame_trial",
            shop_id=target_shop.id if target_shop else 1,
            full_name=req.full_name.strip(),
            mobile_number=req.mobile_number.strip(),
            email=req.email.strip(),
            appointment_date=req.appointment_date.strip(),
            appointment_time=req.appointment_time.strip(),
            meeting_mode=None,
            home_address=req.home_address.strip(),
            purpose="Frame Trial at Home (Up to 10 Frames)",
            additional_message=req.additional_message.strip() if req.additional_message else None,
            status="Pending",
            visit_status="Pending",
            has_prescription=False,
            prescription_file=None,
            prescription_data_json=None,
            selected_frames_json=json.dumps(frames) if frames else "[]",
            face_shape=fa.get("face_shape"),
            ipd_mm=fa.get("ipd_mm"),
            eye_shape=fa.get("eye_shape"),
            face_width_mm=fa.get("face_width_mm"),
            face_length_mm=fa.get("face_length_mm"),
            jaw_width_mm=fa.get("jaw_width_mm"),
            skin_tone=fa.get("skin_tone"),
            undertone=fa.get("undertone"),
            head_circumference_cm=fa.get("head_circumference_cm"),
            face_sketch_image=fa.get("face_sketch_image"),
            face_analysis_summary=fa.get("face_analysis_summary") or "Facial scan measurements for physical frame size verification only.",
            doctor_id=None
        )
        db.add(appt_trial)

        # 2. Vision Test appointment
        appt_vision = Appointment(
            appointment_id=appt_vision_num,
            appointment_type="home_testing",
            service_type="vision_test",
            shop_id=target_shop.id if target_shop else 1,
            full_name=req.full_name.strip(),
            mobile_number=req.mobile_number.strip(),
            email=req.email.strip(),
            appointment_date=req.appointment_date.strip(),
            appointment_time=req.appointment_time.strip(),
            meeting_mode=None,
            home_address=req.home_address.strip(),
            purpose="Home Vision Test",
            additional_message=req.additional_message.strip() if req.additional_message else None,
            status="Pending",
            visit_status="Pending",
            has_prescription=req.has_prescription,
            prescription_file=req.prescription_file,
            prescription_data_json=json.dumps(req.prescription_data) if req.prescription_data else None,
            selected_frames_json="[]",
            face_shape=fa.get("face_shape"),
            ipd_mm=fa.get("ipd_mm"),
            eye_shape=fa.get("eye_shape"),
            face_width_mm=fa.get("face_width_mm"),
            face_length_mm=fa.get("face_length_mm"),
            jaw_width_mm=fa.get("jaw_width_mm"),
            skin_tone=fa.get("skin_tone"),
            undertone=fa.get("undertone"),
            head_circumference_cm=fa.get("head_circumference_cm"),
            face_sketch_image=fa.get("face_sketch_image"),
            face_analysis_summary=fa.get("face_analysis_summary") or "Facial scan measurements for physical frame size verification only.",
            doctor_id=doc.id if doc else None
        )
        db.add(appt_vision)

        if cust and not cust.address:
            cust.address = req.home_address.strip()

        # Customer notifications for both
        notif1 = CustomerNotification(
            customer_id=cust.id if cust else 1,
            shop_id=target_shop.id if target_shop else 1,
            title="Frame Trial Booking Received",
            message=f"Your Frame Trial at Home request (Ref: {appt_trial_num}) with {len(frames)} frame(s) for {req.appointment_date} at {req.appointment_time} was submitted to {shop_title}.",
            notification_type="home_trial",
            reference_id=appt_trial_num
        )
        notif2 = CustomerNotification(
            customer_id=cust.id if cust else 1,
            shop_id=target_shop.id if target_shop else 1,
            title="Vision Test Booking Received",
            message=f"Your Home Vision Test appointment request (Ref: {appt_vision_num}) for {req.appointment_date} at {req.appointment_time} was submitted to {shop_title}.",
            notification_type="vision_test",
            reference_id=appt_vision_num
        )
        db.add(notif1)
        db.add(notif2)
        db.commit()
        db.refresh(appt_trial)
        db.refresh(appt_vision)

        return {
            "status": "success",
            "appointment_id": appt_trial.appointment_id,
            "service_type": "both",
            "shop_name": shop_title,
            "appointment_date": req.appointment_date,
            "appointment_time": req.appointment_time,
            "home_address": req.home_address,
            "visit_status": "Pending",
            "selected_frames_count": len(frames),
            "has_prescription": req.has_prescription,
            "message": f"Both services booked successfully! Frame Trial (Ref: {appt_trial_num}) and Vision Test (Ref: {appt_vision_num}) are tracked independently.",
            "appointments": [
                {
                    "appointment_id": appt_trial.appointment_id,
                    "service_type": "frame_trial",
                    "purpose": "Frame Trial at Home (Up to 10 Frames)",
                    "selected_frames_count": len(frames),
                    "status": appt_trial.status
                },
                {
                    "appointment_id": appt_vision.appointment_id,
                    "service_type": "vision_test",
                    "purpose": "Home Vision Test",
                    "doctor_assigned": doc.name if doc else None,
                    "status": appt_vision.status
                }
            ]
        }

@router.get("/home-services/my-requests")
def get_my_home_services(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, customer_mobile, db)
    query = db.query(Appointment).filter(Appointment.appointment_type == "home_testing")
    if cust:
        clean_mob = cust.mobile[-10:] if cust.mobile else ""
        query = query.filter((Appointment.mobile_number.endswith(clean_mob)) | (Appointment.email == cust.email))

    appts = query.order_by(Appointment.id.desc()).all()
    results = []
    for a in appts:
        frames = []
        if a.selected_frames_json:
            try:
                frames = json.loads(a.selected_frames_json)
            except Exception:
                frames = []
        rx = None
        if a.prescription_data_json:
            try:
                rx = json.loads(a.prescription_data_json)
            except Exception:
                rx = None
        results.append({
            "id": a.id,
            "appointment_id": a.appointment_id,
            "service_type": a.service_type or "both",
            "appointment_date": a.appointment_date,
            "appointment_time": a.appointment_time,
            "home_address": a.home_address,
            "status": a.status,
            "visit_status": a.visit_status or a.status,
            "rejection_reason": a.rejection_reason,
            "final_selected_frame_id": a.final_selected_frame_id,
            "shop_name": a.shop.shop_name if a.shop else "EyeReach Partner Store",
            "doctor_name": a.doctor.name if a.doctor else None,
            "has_prescription": a.has_prescription,
            "prescription_file": a.prescription_file,
            "prescription_data": rx,
            "selected_frames": frames,
            "selected_frames_count": len(frames),
            "created_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if a.created_at else ""
        })
    return {"status": "success", "requests": results, "total": len(results)}

# ----------------- APPOINTMENT CANCELLATION & RESCHEDULING (Requirement 5) -----------------

class AppointmentCancelRequest(BaseModel):
    reason: Optional[str] = "Customer requested cancellation"

@router.put("/appointments/{id}/cancel")
def cancel_customer_appointment(
    id: int,
    req: AppointmentCancelRequest = AppointmentCancelRequest(),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Allows a customer to cancel an active home service appointment.
    Frees up the slot capacity and notifies both customer and supplying optical store.
    """
    appt = db.query(Appointment).filter(Appointment.id == id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    if appt.status in ["Completed"]:
        raise HTTPException(status_code=400, detail="Completed appointments cannot be cancelled.")

    appt.status = "Cancelled"
    appt.visit_status = "Cancelled"
    appt.additional_message = f"{appt.additional_message or ''} [Cancelled by customer: {req.reason}]".strip()

    clean_mob = appt.mobile_number[-10:] if appt.mobile_number else ""
    cust = resolve_customer(current_customer, clean_mob, db)
    if cust:
        notif = CustomerNotification(
            customer_id=cust.id,
            shop_id=appt.shop_id or 1,
            title="Appointment Cancelled",
            message=f"Your appointment #{appt.appointment_id} for {appt.appointment_date} has been cancelled. The slot has been released and you may reschedule anytime.",
            notification_type="appointment_cancelled",
            reference_id=appt.appointment_id
        )
        db.add(notif)

    db.commit()
    return {
        "status": "success",
        "message": f"Appointment #{appt.appointment_id} has been cancelled successfully.",
        "appointment_id": appt.appointment_id,
        "status": appt.status
    }

class AppointmentRescheduleRequest(BaseModel):
    new_date: str
    new_time: str
    reason: Optional[str] = "Customer requested reschedule"

@router.put("/appointments/{id}/reschedule")
def reschedule_customer_appointment(
    id: int,
    req: AppointmentRescheduleRequest,
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Allows a customer to reschedule an existing appointment to a new date/time slot.
    Validates capacity in the target slot to prevent double-booking.
    """
    appt = db.query(Appointment).filter(Appointment.id == id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    if appt.status in ["Completed", "Cancelled"]:
        raise HTTPException(status_code=400, detail=f"Cannot reschedule an appointment in '{appt.status}' state.")

    try:
        new_d = datetime.date.fromisoformat(req.new_date.strip())
        if new_d < datetime.date.today():
            raise HTTPException(status_code=400, detail="Rescheduled date cannot be in the past.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    # Validate slot capacity
    rem, tot, bkd, avail_docs = calculate_slot_capacity(db, appt.shop_id, req.new_date.strip(), req.new_time.strip())
    if rem <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Slot {req.new_time} on {req.new_date} is fully booked. Please select an available slot."
        )

    old_date = appt.appointment_date
    old_time = appt.appointment_time

    appt.appointment_date = req.new_date.strip()
    appt.appointment_time = req.new_time.strip()
    appt.status = "Rescheduled"
    appt.visit_status = "Rescheduled"
    if avail_docs:
        appt.doctor_id = avail_docs[0].id
    appt.additional_message = f"{appt.additional_message or ''} [Rescheduled from {old_date} {old_time}: {req.reason}]".strip()

    clean_mob = appt.mobile_number[-10:] if appt.mobile_number else ""
    cust = resolve_customer(current_customer, clean_mob, db)
    if cust:
        notif = CustomerNotification(
            customer_id=cust.id,
            shop_id=appt.shop_id or 1,
            title="Appointment Rescheduled",
            message=f"Your appointment #{appt.appointment_id} has been rescheduled to {appt.appointment_date} at {appt.appointment_time}.",
            notification_type="appointment_rescheduled",
            reference_id=appt.appointment_id
        )
        db.add(notif)

    db.commit()
    return {
        "status": "success",
        "message": f"Appointment #{appt.appointment_id} rescheduled to {appt.appointment_date} at {appt.appointment_time}.",
        "appointment_id": appt.appointment_id,
        "appointment_date": appt.appointment_date,
        "appointment_time": appt.appointment_time,
        "status": appt.status
    }

# ----------------- NOTIFICATIONS AND AUTOMATED REMINDERS (Requirement 8) -----------------

def sync_automated_customer_reminders(cust: Customer, db: Session):
    """
    Generates automated customer follow-up alerts and reminders:
    1. Checkup due reminder based on last eye exam date or account registration
    2. Frame refresh reminder based on last delivered order (1-year anniversary)
    3. Cart/Wishlist follow-up if unpurchased items exist for > 7 days
    Deduplicates reminders so the same alert isn't duplicated within 30 days.
    """
    now = datetime.datetime.utcnow()
    interval_months = cust.reminder_interval_months or 12
    cycle_days = interval_months * 30

    # 1. Periodic Eye Exam Reminder
    last_exam = cust.last_exam_date
    if not last_exam:
        completed_vt = db.query(Appointment).filter(
            (Appointment.mobile_number.endswith(cust.mobile[-10:] if cust.mobile else "xyz")) | (Appointment.email == cust.email),
            Appointment.status == "Completed"
        ).order_by(Appointment.id.desc()).first()
        if completed_vt and completed_vt.created_at:
            last_exam = completed_vt.created_at
            cust.last_exam_date = last_exam
        elif cust.created_at:
            last_exam = cust.created_at

    if last_exam:
        days_since_exam = (now - last_exam).days
        if days_since_exam >= cycle_days:
            recent_rem = db.query(CustomerNotification).filter(
                CustomerNotification.customer_id == cust.id,
                CustomerNotification.notification_type == "checkup_reminder",
                CustomerNotification.created_at >= now - datetime.timedelta(days=30)
            ).first()
            if not recent_rem:
                notif = CustomerNotification(
                    customer_id=cust.id,
                    title="Periodic Eye Checkup Due",
                    message=f"It has been {days_since_exam // 30} months since your last recorded vision test. Routine eye exams help preserve optical clarity and ensure accurate prescription power.",
                    notification_type="checkup_reminder"
                )
                db.add(notif)

    # 2. Frame Replacement / 1-Year Anniversary Reminder
    last_delivered = db.query(Order).filter(
        Order.customer_id == cust.id,
        Order.status.in_(["Delivered", "Customer Received"])
    ).order_by(Order.id.desc()).first()

    if last_delivered and last_delivered.created_at:
        days_since_order = (now - last_delivered.created_at).days
        if days_since_order >= 365:
            recent_frame_rem = db.query(CustomerNotification).filter(
                CustomerNotification.customer_id == cust.id,
                CustomerNotification.notification_type == "frame_renewal",
                CustomerNotification.created_at >= now - datetime.timedelta(days=30)
            ).first()
            if not recent_frame_rem:
                notif = CustomerNotification(
                    customer_id=cust.id,
                    shop_id=last_delivered.shop_id or 1,
                    title="1-Year Eyewear Renewal Reminder",
                    message=f"Your spectacles from Order #{last_delivered.order_number} are now 1 year old! Eye-care specialists recommend an annual lens check and frame alignment to maintain crystal-clear UV defense and ergonomic comfort.",
                    notification_type="frame_renewal",
                    reference_id=last_delivered.order_number
                )
                db.add(notif)

    # 3. Cart / Wishlist Follow-up Reminder
    active_cart_count = db.query(CartItem).filter(CartItem.customer_id == cust.id).count()
    if active_cart_count > 0:
        recent_cart_rem = db.query(CustomerNotification).filter(
            CustomerNotification.customer_id == cust.id,
            CustomerNotification.notification_type == "cart_reminder",
            CustomerNotification.created_at >= now - datetime.timedelta(days=14)
        ).first()
        if not recent_cart_rem:
            notif = CustomerNotification(
                customer_id=cust.id,
                title="Your Handpicked Frames Are Waiting",
                message=f"You have {active_cart_count} optical frame(s) saved in your cart. You can place your order online or request a free doorstep trial with up to 10 frames.",
                notification_type="cart_reminder"
            )
            db.add(notif)

    db.commit()

@router.get("/notifications")
def get_customer_notifications(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, customer_mobile, db)
    if not cust:
        return {"status": "success", "notifications": [], "unread_count": 0}

    # Automatically synchronize periodic reminders and follow-ups
    try:
        sync_automated_customer_reminders(cust, db)
    except Exception as e:
        logger.warning(f"Automated reminder sync failed: {e}")

    # Ensure baseline welcome reminder exists
    checkup_rem = db.query(CustomerNotification).filter(
        CustomerNotification.customer_id == cust.id,
        CustomerNotification.notification_type == "reminder"
    ).first()

    if not checkup_rem:
        reminder = CustomerNotification(
            customer_id=cust.id,
            title="Periodic Eye Checkup Reminder",
            message="Friendly Reminder: An annual comprehensive eye exam helps preserve vision health and ensure accurate corrective lens power.",
            notification_type="reminder"
        )
        db.add(reminder)
        db.commit()

    notifs = db.query(CustomerNotification).filter(
        CustomerNotification.customer_id == cust.id
    ).order_by(CustomerNotification.created_at.desc()).all()

    unread = sum(1 for n in notifs if not n.is_read)
    return {
        "status": "success",
        "unread_count": unread,
        "total": len(notifs),
        "notifications": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "notification_type": n.notification_type,
                "reference_id": n.reference_id,
                "is_read": n.is_read,
                "created_at": n.created_at.strftime("%d %b %Y, %I:%M %p") if n.created_at else ""
            }
            for n in notifs
        ]
    }

@router.patch("/notifications/{id}/read")
def mark_notification_read(id: int, db: Session = Depends(get_db)):
    notif = db.query(CustomerNotification).filter(CustomerNotification.id == id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found.")
    notif.is_read = True
    db.commit()
    return {
        "status": "success",
        "message": "Notification marked as read.",
        "notification": {
            "id": notif.id,
            "title": notif.title,
            "message": notif.message,
            "is_read": notif.is_read,
            "notification_type": notif.notification_type
        }
    }

@router.post("/notifications/mark-all-read")
def mark_all_notifications_read(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, customer_mobile, db)
    if cust:
        db.query(CustomerNotification).filter(CustomerNotification.customer_id == cust.id).update({"is_read": True})
        db.commit()
    return {"status": "success", "message": "All notifications marked as read."}

class ReminderSettingsRequest(BaseModel):
    reminder_interval_months: int # e.g. 6 or 12

@router.post("/reminders/settings")
def update_reminder_settings(
    req: ReminderSettingsRequest,
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """Configures customer periodic eye checkup reminder interval (e.g. 6 or 12 months)."""
    cust = resolve_customer(current_customer, customer_mobile, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Customer login required.")
    
    if req.reminder_interval_months not in [3, 6, 9, 12, 18, 24]:
        raise HTTPException(status_code=400, detail="Reminder interval must be 3, 6, 9, 12, 18, or 24 months.")

    cust.reminder_interval_months = req.reminder_interval_months
    db.commit()
    return {
        "status": "success",
        "message": f"Eye checkup reminder cycle updated to every {req.reminder_interval_months} months.",
        "reminder_interval_months": cust.reminder_interval_months
    }

@router.post("/reminders/checkup")
def schedule_eye_checkup_reminder(
    months: int = 6,
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    cust = resolve_customer(current_customer, customer_mobile, db)
    if not cust:
        raise HTTPException(status_code=401, detail="Customer login required.")

    notif = CustomerNotification(
        customer_id=cust.id,
        title=f"Scheduled {months}-Month Eye Checkup Reminder",
        message=f"Reminder scheduled: Your next recommended comprehensive eye exam is due in {months} months. You can book a home vision visit anytime through EyeReach.",
        notification_type="reminder"
    )
    db.add(notif)
    db.commit()
    return {"status": "success", "message": f"Eye checkup reminder scheduled for {months} months."}

# ----------------- IN-STOCK PERSONALIZED SUGGESTIONS (Requirement 8) -----------------

@router.get("/personalized-suggestions")
def get_personalized_suggestions(
    customer_mobile: Optional[str] = Query(None),
    current_customer: Optional[Customer] = Depends(get_current_customer),
    db: Session = Depends(get_db)
):
    """
    Returns personalized spectacle frame recommendations based on customer's face shape and curated picks.
    STRICT MENTOR REQUIREMENT: Must strictly suggest products that are IN STOCK (stock_quantity > 0 and is_active == True).
    """
    cust = resolve_customer(current_customer, customer_mobile, db)
    
    face_shape = None
    if cust and cust.face_shape:
        face_shape = cust.face_shape

    if not face_shape and cust:
        last_appt = db.query(Appointment).filter(
            (Appointment.mobile_number.endswith(cust.mobile[-10:] if cust.mobile else "xyz")) | (Appointment.email == cust.email),
            Appointment.face_shape != None
        ).order_by(Appointment.id.desc()).first()
        if last_appt:
            face_shape = last_appt.face_shape

    shape_compat_map = {
        "Oval": ["Square", "Rectangle", "Geometric", "Round"],
        "Round": ["Rectangle", "Square", "Geometric"],
        "Square": ["Round", "Oval", "Cat Eye"],
        "Heart": ["Round", "Oval", "Rectangle"],
        "Diamond": ["Oval", "Cat Eye", "Round"],
        "Oblong": ["Square", "Round", "Geometric"]
    }
    preferred_shapes = shape_compat_map.get(face_shape, ["Round", "Rectangle", "Square", "Geometric"])

    in_stock_query = db.query(Product).filter(
        Product.is_active == True,
        Product.stock_quantity > 0
    )

    matching_products = in_stock_query.filter(Product.shape.in_(preferred_shapes)).limit(8).all()
    if len(matching_products) < 4:
        fallback_products = in_stock_query.limit(8).all()
        matching_products = list({p.id: p for p in (matching_products + fallback_products)}.values())[:6]

    suggestions = []
    for p in matching_products:
        dims = f"{int(p.lens_width_mm or 50)}-{int(p.bridge_width_mm or 18)}-{int(p.temple_length_mm or 140)} mm" if p.lens_width_mm else (p.size or "50-18-140 mm")
        match_reason = f"Ideal {p.shape} geometry balancing {face_shape} face contours" if face_shape else f"Trending {p.shape} silhouette in high customer demand"
        suggestions.append({
            "id": p.id,
            "product_id": p.product_id,
            "name": p.name,
            "brand": p.brand,
            "shape": p.shape,
            "material": p.material,
            "color": p.color,
            "price": p.price,
            "front_image": p.front_image,
            "stock_quantity": p.stock_quantity,
            "in_stock": True,
            "dimensions": dims,
            "shop_id": p.shop_id,
            "shop_name": p.shop.shop_name if p.shop else "EyeReach Partner Store",
            "match_reason": match_reason
        })

    return {
        "status": "success",
        "face_shape": face_shape or "Standard",
        "total_suggestions": len(suggestions),
        "suggestions": suggestions
    }


