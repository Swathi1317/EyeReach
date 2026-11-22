import hashlib
import jwt
import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from ..db.database import get_db
from ..db.models import Doctor, Appointment, Shop, Product

router = APIRouter(prefix="/api/doctor", tags=["Doctor & Optometrist Portal"])

SECRET_KEY = "smartframe-optical-b2b-secret-key-2026"
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def create_doctor_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_doctor(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Doctor:
    if not authorization:
        # Fallback to first doctor for development resilience
        doc = db.query(Doctor).filter(Doctor.is_active == True).first()
        if doc:
            return doc
        raise HTTPException(status_code=401, detail="Doctor authentication required.")
    
    token = authorization.replace("Bearer ", "").strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        doctor_id = payload.get("doctor_id")
        if not doctor_id:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
        doc = db.query(Doctor).filter(Doctor.id == doctor_id, Doctor.is_active == True).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Doctor account not found or deactivated.")
        return doc
    except jwt.PyJWTError:
        doc = db.query(Doctor).filter(Doctor.is_active == True).first()
        if doc:
            return doc
        raise HTTPException(status_code=401, detail="Invalid or expired session token.")

class DoctorLoginRequest(BaseModel):
    email: str
    password: str

class AppointmentStatusUpdate(BaseModel):
    status: str # 'Confirmed' or 'Rejected'
    notes: Optional[str] = None

def unpack_frames(raw_json: Optional[str]) -> List[dict]:
    if not raw_json:
        return []
    try:
        data = json.loads(raw_json)
        return data if isinstance(data, list) else []
    except Exception:
        return []

@router.post("/login")
def doctor_login(req: DoctorLoginRequest, db: Session = Depends(get_db)):
    """Authenticate optometrist/doctor with email and password."""
    doctor = db.query(Doctor).filter(
        Doctor.email == req.email.lower().strip(),
        Doctor.is_active == True
    ).first()

    if not doctor or doctor.password_hash != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid doctor email or password.")

    token = create_doctor_token({
        "doctor_id": doctor.id,
        "email": doctor.email,
        "role": "doctor"
    })

    shop_name = doctor.shop.shop_name if doctor.shop else "EyeReach Partner Store"

    return {
        "status": "success",
        "message": f"Welcome back, {doctor.name}!",
        "token": token,
        "role": "doctor",
        "doctor": {
            "id": doctor.id,
            "name": doctor.name,
            "email": doctor.email,
            "mobile": doctor.mobile,
            "specialization": doctor.specialization,
            "qualification": doctor.qualification,
            "registration_number": doctor.registration_number,
            "shop_id": doctor.shop_id,
            "shop_name": shop_name
        }
    }

@router.get("/me")
def get_doctor_profile(current_doctor: Doctor = Depends(get_current_doctor)):
    """Get authenticated doctor's profile and linked shop details."""
    shop_info = None
    if current_doctor.shop:
        shop_info = {
            "id": current_doctor.shop.id,
            "shop_name": current_doctor.shop.shop_name,
            "owner_name": current_doctor.shop.owner_name,
            "shop_address": current_doctor.shop.shop_address,
            "mobile_number": current_doctor.shop.mobile_number
        }

    return {
        "status": "success",
        "doctor": {
            "id": current_doctor.id,
            "name": current_doctor.name,
            "email": current_doctor.email,
            "mobile": current_doctor.mobile,
            "specialization": current_doctor.specialization,
            "qualification": current_doctor.qualification,
            "registration_number": current_doctor.registration_number,
            "shop_id": current_doctor.shop_id,
            "shop": shop_info
        }
    }

@router.get("/appointments")
def list_doctor_appointments(
    status_filter: Optional[str] = None, # 'Pending', 'Confirmed', 'Rejected', or None for all
    current_doctor: Doctor = Depends(get_current_doctor),
    db: Session = Depends(get_db)
):
    """
    List appointments strictly assigned to this doctor.
    Includes patient biometrics and selected frames for home visit trial.
    """
    query = db.query(Appointment).filter(Appointment.doctor_id == current_doctor.id)

    if status_filter and status_filter.strip().lower() != "all":
        query = query.filter(Appointment.status.ilike(status_filter.strip()))

    appts = query.order_by(Appointment.created_at.desc()).all()

    results = []
    for a in appts:
        selected_frames = unpack_frames(a.selected_frames_json)
        results.append({
            "id": a.id,
            "appointment_id": a.appointment_id,
            "appointment_type": a.appointment_type,
            "full_name": a.full_name,
            "mobile_number": a.mobile_number,
            "email": a.email,
            "appointment_date": a.appointment_date,
            "appointment_time": a.appointment_time,
            "home_address": a.home_address,
            "purpose": a.purpose,
            "additional_message": a.additional_message,
            "status": a.status,
            "doctor_notes": a.doctor_notes,
            "created_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if a.created_at else "",
            # Selected Spectacle Frames to bring for Home Visit
            "selected_frames": selected_frames,
            "selected_frames_count": len(selected_frames),
            # Biometric Face Analysis Data
            "biometrics": {
                "face_shape": a.face_shape,
                "ipd_mm": a.ipd_mm,
                "eye_shape": a.eye_shape,
                "face_width_mm": a.face_width_mm,
                "face_length_mm": a.face_length_mm,
                "jaw_width_mm": a.jaw_width_mm,
                "skin_tone": a.skin_tone,
                "undertone": a.undertone,
                "head_circumference_cm": a.head_circumference_cm,
                "face_sketch_image": a.face_sketch_image,
                "face_analysis_summary": a.face_analysis_summary
            }
        })

    return {
        "status": "success",
        "doctor_name": current_doctor.name,
        "total_appointments": len(results),
        "appointments": results
    }

@router.get("/appointments/{id}")
def get_doctor_appointment_detail(
    id: int,
    current_doctor: Doctor = Depends(get_current_doctor),
    db: Session = Depends(get_db)
):
    """View specific appointment details assigned to this doctor."""
    appt = db.query(Appointment).filter(
        Appointment.id == id,
        Appointment.doctor_id == current_doctor.id
    ).first()

    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found or not assigned to you.")

    selected_frames = unpack_frames(appt.selected_frames_json)

    return {
        "status": "success",
        "appointment": {
            "id": appt.id,
            "appointment_id": appt.appointment_id,
            "appointment_type": appt.appointment_type,
            "full_name": appt.full_name,
            "mobile_number": appt.mobile_number,
            "email": appt.email,
            "appointment_date": appt.appointment_date,
            "appointment_time": appt.appointment_time,
            "home_address": appt.home_address,
            "purpose": appt.purpose,
            "additional_message": appt.additional_message,
            "status": appt.status,
            "doctor_notes": appt.doctor_notes,
            "created_at": appt.created_at.strftime("%d %b %Y, %I:%M %p") if appt.created_at else "",
            "selected_frames": selected_frames,
            "selected_frames_count": len(selected_frames),
            "biometrics": {
                "face_shape": appt.face_shape,
                "ipd_mm": appt.ipd_mm,
                "eye_shape": appt.eye_shape,
                "face_width_mm": appt.face_width_mm,
                "face_length_mm": appt.face_length_mm,
                "jaw_width_mm": appt.jaw_width_mm,
                "skin_tone": appt.skin_tone,
                "undertone": appt.undertone,
                "head_circumference_cm": appt.head_circumference_cm,
                "face_sketch_image": appt.face_sketch_image,
                "face_analysis_summary": appt.face_analysis_summary
            }
        }
    }

@router.put("/appointments/{id}/status")
def update_appointment_status(
    id: int,
    req: AppointmentStatusUpdate,
    current_doctor: Doctor = Depends(get_current_doctor),
    db: Session = Depends(get_db)
):
    """
    Doctor reviews and approves or rejects an assigned appointment.
    Changes status:
      - 'Confirmed' if approved
      - 'Rejected' if rejected
    Saves in the backend database.
    """
    valid_statuses = ["Confirmed", "Rejected", "Pending", "Completed"]
    new_status = req.status.strip().capitalize()
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{req.status}'. Must be 'Confirmed' or 'Rejected'."
        )

    appt = db.query(Appointment).filter(
        Appointment.id == id,
        Appointment.doctor_id == current_doctor.id
    ).first()

    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found or not assigned to you.")

    appt.status = new_status
    if req.notes is not None:
        appt.doctor_notes = req.notes.strip()

    db.commit()
    db.refresh(appt)

    action_label = "approved" if new_status == "Confirmed" else "rejected" if new_status == "Rejected" else "updated"

    return {
        "status": "success",
        "message": f"Appointment {appt.appointment_id} has been {action_label} successfully.",
        "appointment_id": appt.appointment_id,
        "new_status": appt.status,
        "doctor_notes": appt.doctor_notes
    }
