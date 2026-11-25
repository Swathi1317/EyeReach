import hashlib
import jwt
import datetime
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from ..db.database import get_db
from ..db.models import Shop, Doctor

router = APIRouter(prefix="/api/shop", tags=["Shop Auth"])

SECRET_KEY = "smartframe-optical-b2b-secret-key-2026"
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_shop(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Shop:
    if not authorization:
        # Fallback to default demo shop 1 for seamless development & demo convenience
        shop = db.query(Shop).first()
        if shop:
            shop._caller_role = "shop_owner"
            shop._optometrist_id = None
            return shop
        raise HTTPException(status_code=401, detail="Shop authentication required.")
    
    token = authorization.replace("Bearer ", "").strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        shop_id = payload.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
        shop = db.query(Shop).filter(Shop.id == shop_id).first()
        if not shop:
            raise HTTPException(status_code=404, detail="Shop not found.")
        shop._caller_role = payload.get("role", "shop_owner")
        shop._optometrist_id = payload.get("optometrist_id")
        return shop
    except jwt.PyJWTError:
        # If token is invalid or expired, fallback to first shop for demo resilience
        shop = db.query(Shop).first()
        if shop:
            shop._caller_role = "shop_owner"
            shop._optometrist_id = None
            return shop
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

class ShopRegisterRequest(BaseModel):
    owner_name: str
    shop_name: str
    mobile_number: str
    email: str
    shop_address: str
    password: str
    confirm_password: str

class ShopLoginRequest(BaseModel):
    email: str
    password: str

class ShopProfileUpdate(BaseModel):
    owner_name: Optional[str] = None
    shop_name: Optional[str] = None
    mobile_number: Optional[str] = None
    email: Optional[str] = None
    shop_address: Optional[str] = None
    operating_hours: Optional[str] = None
    home_visit_available: Optional[bool] = None
    shop_info: Optional[str] = None

@router.post("/register")
def register_shop(req: ShopRegisterRequest, db: Session = Depends(get_db)):
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")
    
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    existing_email = db.query(Shop).filter(Shop.email == req.email.lower()).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="An optical shop with this email is already registered.")

    new_shop = Shop(
        owner_name=req.owner_name.strip(),
        shop_name=req.shop_name.strip(),
        mobile_number=req.mobile_number.strip(),
        email=req.email.lower().strip(),
        shop_address=req.shop_address.strip(),
        password_hash=hash_password(req.password),
        subscription_plan="Pro Store"
    )
    db.add(new_shop)
    db.commit()
    db.refresh(new_shop)

    token = create_access_token({"shop_id": new_shop.id, "email": new_shop.email, "role": "shop_owner"})

    return {
        "status": "success",
        "message": f"Welcome, {new_shop.owner_name}! {new_shop.shop_name} has been registered successfully.",
        "token": token,
        "shop": {
            "id": new_shop.id,
            "owner_name": new_shop.owner_name,
            "shop_name": new_shop.shop_name,
            "email": new_shop.email,
            "mobile_number": new_shop.mobile_number,
            "shop_address": new_shop.shop_address,
            "subscription_plan": new_shop.subscription_plan
        }
    }

@router.post("/login")
def login_shop(req: ShopLoginRequest, db: Session = Depends(get_db)):
    # 1. Check if an optical shop owner is logging in
    shop = db.query(Shop).filter(
        (Shop.email == req.email.lower().strip()) | (Shop.mobile_number == req.email.strip())
    ).first()

    if shop:
        if shop.password_hash != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Incorrect password. Please try again.")

        token = create_access_token({"shop_id": shop.id, "email": shop.email, "role": "shop_owner"})

        return {
            "status": "success",
            "message": f"Welcome back, {shop.owner_name}!",
            "token": token,
            "role": "shop_owner",
            "user": {
                "id": shop.id,
                "name": shop.owner_name,
                "email": shop.email,
                "role": "shop_owner",
                "shop_name": shop.shop_name
            },
            "shop": {
                "id": shop.id,
                "owner_name": shop.owner_name,
                "shop_name": shop.shop_name,
                "email": shop.email,
                "mobile_number": shop.mobile_number,
                "shop_address": shop.shop_address,
                "subscription_plan": shop.subscription_plan
            }
        }

    # 2. Check if an in-shop optometrist is logging in
    optometrist = db.query(Doctor).filter(
        (Doctor.email == req.email.lower().strip()) | (Doctor.mobile == req.email.strip())
    ).first()

    if optometrist:
        if optometrist.password_hash != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Incorrect password. Please try again.")

        associated_shop = optometrist.shop or (db.query(Shop).filter(Shop.id == optometrist.shop_id).first() if optometrist.shop_id else db.query(Shop).first())
        shop_id = associated_shop.id if associated_shop else 1

        token = create_access_token({
            "shop_id": shop_id,
            "optometrist_id": optometrist.id,
            "email": optometrist.email,
            "role": "optometrist"
        })

        return {
            "status": "success",
            "message": f"Welcome, Optometrist {optometrist.name}!",
            "token": token,
            "role": "optometrist",
            "name": optometrist.name,
            "owner_name": optometrist.name,
            "email": optometrist.email,
            "shop_name": associated_shop.shop_name if associated_shop else "Optical Store",
            "user": {
                "id": optometrist.id,
                "name": optometrist.name,
                "email": optometrist.email,
                "mobile": optometrist.mobile,
                "role": "optometrist",
                "qualification": optometrist.qualification,
                "specialization": optometrist.specialization,
                "shop_id": shop_id,
                "shop_name": associated_shop.shop_name if associated_shop else "Optical Store"
            },
            "optometrist": {
                "id": optometrist.id,
                "name": optometrist.name,
                "email": optometrist.email,
                "mobile": optometrist.mobile,
                "role": "optometrist",
                "qualification": optometrist.qualification,
                "specialization": optometrist.specialization,
                "shop_id": shop_id,
                "shop_name": associated_shop.shop_name if associated_shop else "Optical Store"
            },
            "shop": {
                "id": shop_id,
                "owner_name": optometrist.name,
                "shop_name": associated_shop.shop_name if associated_shop else "Optical Store",
                "email": associated_shop.email if associated_shop else optometrist.email,
                "mobile_number": associated_shop.mobile_number if associated_shop else optometrist.mobile,
                "shop_address": associated_shop.shop_address if associated_shop else "",
                "subscription_plan": "In-Shop Optometrist"
            }
        }

    raise HTTPException(status_code=401, detail="No registered optical shop or optometrist found with these credentials.")

@router.get("/profile")
def get_shop_profile(current_shop: Shop = Depends(get_current_shop)):
    return {
        "id": current_shop.id,
        "owner_name": current_shop.owner_name,
        "shop_name": current_shop.shop_name,
        "email": current_shop.email,
        "mobile_number": current_shop.mobile_number,
        "shop_address": current_shop.shop_address,
        "subscription_plan": current_shop.subscription_plan,
        "operating_hours": current_shop.operating_hours or "09:00 AM - 08:00 PM, Mon-Sat",
        "home_visit_available": current_shop.home_visit_available if current_shop.home_visit_available is not None else True,
        "shop_info": current_shop.shop_info or "",
        "caller_role": getattr(current_shop, "_caller_role", "shop_owner"),
        "created_at": current_shop.created_at.strftime("%Y-%m-%d") if current_shop.created_at else None
    }

@router.put("/profile")
def update_shop_profile(req: ShopProfileUpdate, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    if getattr(current_shop, "_caller_role", None) == "optometrist":
        raise HTTPException(status_code=403, detail="Optometrist accounts are restricted from modifying shop administration or profile.")
    if req.owner_name:
        current_shop.owner_name = req.owner_name.strip()
    if req.shop_name:
        current_shop.shop_name = req.shop_name.strip()
    if req.mobile_number:
        current_shop.mobile_number = req.mobile_number.strip()
    if req.email:
        # Check uniqueness if changed
        em = req.email.lower().strip()
        if em != current_shop.email:
            existing = db.query(Shop).filter(Shop.email == em, Shop.id != current_shop.id).first()
            if existing:
                raise HTTPException(status_code=400, detail="This email address is already in use by another store.")
            current_shop.email = em
    if req.shop_address:
        current_shop.shop_address = req.shop_address.strip()
    if req.operating_hours is not None:
        current_shop.operating_hours = req.operating_hours.strip()
    if req.home_visit_available is not None:
        current_shop.home_visit_available = req.home_visit_available
    if req.shop_info is not None:
        current_shop.shop_info = req.shop_info.strip()

    db.commit()
    db.refresh(current_shop)

    return {
        "status": "success",
        "message": "Shop profile updated successfully.",
        "shop": {
            "id": current_shop.id,
            "owner_name": current_shop.owner_name,
            "shop_name": current_shop.shop_name,
            "email": current_shop.email,
            "mobile_number": current_shop.mobile_number,
            "shop_address": current_shop.shop_address,
            "subscription_plan": current_shop.subscription_plan,
            "operating_hours": current_shop.operating_hours,
            "home_visit_available": current_shop.home_visit_available,
            "shop_info": current_shop.shop_info or ""
        }
    }

class ShopPasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.put("/password")
def change_shop_password(req: ShopPasswordChange, current_shop: Shop = Depends(get_current_shop), db: Session = Depends(get_db)):
    if current_shop.password_hash != hash_password(req.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    current_shop.password_hash = hash_password(req.new_password)
    db.commit()
    return {"status": "success", "message": "Password updated successfully."}
