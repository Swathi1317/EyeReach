import os
import base64
import datetime
import random
import re
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..db.database import get_db
from ..db.models import Appointment, Doctor

router = APIRouter(prefix="/api/appointments", tags=["EyeReach Appointments"])

class FaceAnalysisData(BaseModel):
    face_shape: Optional[str] = None
    face_shape_confidence: Optional[float] = None
    ipd_mm: Optional[float] = None
    eye_shape: Optional[str] = None
    face_width_mm: Optional[float] = None
    face_length_mm: Optional[float] = None
    jaw_width_mm: Optional[float] = None
    skin_tone: Optional[str] = None
    undertone: Optional[str] = None
    head_circumference_cm: Optional[float] = None
    face_sketch_image: Optional[str] = None # Base64 or image URL
    face_analysis_summary: Optional[str] = None

class AppointmentCreate(BaseModel):
    appointment_type: str = Field(default="home_testing", description="'home_testing' (Home Testing / Home Visit Appointment)")
    full_name: str = Field(..., min_length=2, description="Full Name of the patient/client")
    mobile_number: str = Field(..., min_length=7, description="Contact phone number")
    email: str = Field(..., min_length=5, description="Contact email address")
    appointment_date: str = Field(..., description="Selected appointment date in YYYY-MM-DD")
    appointment_time: str = Field(..., description="Selected appointment time (e.g. 10:30 AM)")
    meeting_mode: Optional[str] = Field(None, description="'Online' or 'In Person' (deprecated)")
    home_address: Optional[str] = Field(None, description="Full home address (required for home testing)")
    purpose: str = Field(..., min_length=2, description="Purpose of Meeting or Type of Test")
    additional_message: Optional[str] = Field(None, description="Optional extra message or health notes")
    face_analysis: Optional[FaceAnalysisData] = Field(None, description="Automatically populated face analysis and sketch results")
    selected_frames: Optional[List[dict]] = Field(default_factory=list, description="Frames selected by customer from My Frame Picks to try at home")

class AppointmentResponse(BaseModel):
    id: int
    appointment_id: str
    appointment_type: str
    appointment_type_label: str
    full_name: str
    mobile_number: str
    email: str
    appointment_date: str
    appointment_time: str
    meeting_mode: Optional[str] = None
    home_address: Optional[str] = None
    purpose: str
    additional_message: Optional[str] = None
    status: str
    created_at: str
    
    # Selected frames from My Frame Picks to try at home
    selected_frames: Optional[List[dict]] = None
    
    # Face Analysis & Biometrics for Patient and Doctor
    face_shape: Optional[str] = None
    ipd_mm: Optional[float] = None
    eye_shape: Optional[str] = None
    face_width_mm: Optional[float] = None
    face_length_mm: Optional[float] = None
    jaw_width_mm: Optional[float] = None
    skin_tone: Optional[str] = None
    undertone: Optional[str] = None
    head_circumference_cm: Optional[float] = None
    face_sketch_image: Optional[str] = None
    face_analysis_summary: Optional[str] = None
    doctor_access_url: Optional[str] = None
    doctor_id: Optional[int] = None
    doctor_name: Optional[str] = None
    doctor_notes: Optional[str] = None

def unpack_selected_frames(raw_json: Optional[str]) -> List[dict]:
    import json
    if not raw_json:
        return []
    try:
        return json.loads(raw_json)
    except Exception:
        return []

def normalize_type(raw_type: str) -> str:
    cleaned = raw_type.lower().strip()
    if "meet" in cleaned and "home" not in cleaned and "test" not in cleaned:
        return "meeting"
    return "home_testing"

def get_type_label(norm_type: str) -> str:
    if norm_type == "meeting":
        return "Schedule a Meeting"
    return "Home Testing / Home Visit Appointment"

def save_face_sketch_image(raw_image: Optional[str], appointment_id: str) -> Optional[str]:
    """
    Saves a base64 face sketch/scan image into static uploads for doctor and patient access.
    """
    if not raw_image:
        return None
    if raw_image.startswith("data:image"):
        try:
            upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads", "face_sketches")
            os.makedirs(upload_dir, exist_ok=True)
            header, b64_str = raw_image.split(";base64,")
            ext = "png" if "png" in header else "jpg"
            filename = f"sketch_{appointment_id}.{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, "wb") as f:
                f.write(base64.b64decode(b64_str))
            return f"/uploads/face_sketches/{filename}"
        except Exception as e:
            # If decode fails, retain original string
            return raw_image
    return raw_image

@router.post("", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def create_appointment(data: AppointmentCreate, db: Session = Depends(get_db)):
    """
    Schedule a new meeting or home testing appointment for EyeReach.
    Automatically ingests patient face analysis biometrics & face sketch,
    persists records for doctor review, validates dates, and returns confirmation.
    """
    norm_type = normalize_type(data.appointment_type)

    # 1. Validate Date (No past dates)
    try:
        appt_date = datetime.date.fromisoformat(data.appointment_date.strip())
        today = datetime.date.today()
        if appt_date < today:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Appointment date cannot be in the past. Selected: {data.appointment_date}, Today: {today.isoformat()}"
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date format. Expected YYYY-MM-DD."
        )

    # 2. Validate Time
    if not data.appointment_time or not data.appointment_time.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointment time is required."
        )

    # 3. Validate Conditional Fields
    meeting_mode = data.meeting_mode
    home_address = data.home_address

    if norm_type == "meeting":
        if not meeting_mode or not meeting_mode.strip():
            meeting_mode = "Online"
        home_address = None
    else: # home_testing
        if not home_address or not home_address.strip() or len(home_address.strip()) < 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Home address is required for Home Testing appointments (minimum 5 characters)."
            )
        meeting_mode = None

    # 4. Generate Unique Appointment ID: ER-YYYY-XXXXX
    year = appt_date.year
    while True:
        rand_num = random.randint(10000, 99999)
        new_appointment_id = f"ER-{year}-{rand_num}"
        existing = db.query(Appointment).filter(Appointment.appointment_id == new_appointment_id).first()
        if not existing:
            break

    # 5. Process Face Analysis & Sketch Image (if provided)
    stored_sketch_url = None
    fa = data.face_analysis
    if fa and fa.face_sketch_image:
        stored_sketch_url = save_face_sketch_image(fa.face_sketch_image, new_appointment_id)

    # 6. Build Doctor Clinical Summary
    doctor_summary = None
    if fa:
        parts = []
        if fa.face_shape:
            parts.append(f"Face Shape: {fa.face_shape}")
        if fa.ipd_mm:
            parts.append(f"IPD: {fa.ipd_mm} mm")
        if fa.eye_shape:
            parts.append(f"Eye Shape: {fa.eye_shape}")
        if fa.face_width_mm:
            parts.append(f"Face Width: {fa.face_width_mm} mm")
        if fa.face_length_mm:
            parts.append(f"Face Length: {fa.face_length_mm} mm")
        if fa.jaw_width_mm:
            parts.append(f"Jaw Width: {fa.jaw_width_mm} mm")
        if fa.skin_tone:
            parts.append(f"Skin Tone: {fa.skin_tone} ({fa.undertone or 'Neutral'})")
        if fa.head_circumference_cm:
            parts.append(f"Head Circ: {fa.head_circumference_cm} cm")
        if fa.face_analysis_summary:
            parts.append(f"Notes: {fa.face_analysis_summary}")
        doctor_summary = " | ".join(parts) if parts else None

    import json
    selected_frames_str = json.dumps(data.selected_frames) if data.selected_frames else None

    # 7. Find Doctor to Assign
    assigned_doc = db.query(Doctor).filter(Doctor.is_active == True).first()
    assigned_doc_id = assigned_doc.id if assigned_doc else None

    # Persist to Database with Pending status (Requirement 4: must not automatically become Confirmed)
    new_appt = Appointment(
        appointment_id=new_appointment_id,
        appointment_type=norm_type,
        full_name=data.full_name.strip(),
        mobile_number=data.mobile_number.strip(),
        email=data.email.strip().lower(),
        appointment_date=data.appointment_date.strip(),
        appointment_time=data.appointment_time.strip(),
        meeting_mode=meeting_mode.strip() if meeting_mode else None,
        home_address=home_address.strip() if home_address else None,
        purpose=data.purpose.strip(),
        additional_message=data.additional_message.strip() if data.additional_message else None,
        status="Pending",
        doctor_id=assigned_doc_id,
        selected_frames_json=selected_frames_str,
        # Face Biometrics
        face_shape=fa.face_shape if fa else None,
        ipd_mm=fa.ipd_mm if fa else None,
        eye_shape=fa.eye_shape if fa else None,
        face_width_mm=fa.face_width_mm if fa else None,
        face_length_mm=fa.face_length_mm if fa else None,
        jaw_width_mm=fa.jaw_width_mm if fa else None,
        skin_tone=fa.skin_tone if fa else None,
        undertone=fa.undertone if fa else None,
        head_circumference_cm=fa.head_circumference_cm if fa else None,
        face_sketch_image=stored_sketch_url,
        face_analysis_summary=doctor_summary
    )

    db.add(new_appt)
    db.commit()
    db.refresh(new_appt)

    doc_name = new_appt.doctor.name if new_appt.doctor else (assigned_doc.name if assigned_doc else "Assigned Optometrist")

    return AppointmentResponse(
        id=new_appt.id,
        appointment_id=new_appt.appointment_id,
        appointment_type=new_appt.appointment_type,
        appointment_type_label=get_type_label(new_appt.appointment_type),
        full_name=new_appt.full_name,
        mobile_number=new_appt.mobile_number,
        email=new_appt.email,
        appointment_date=new_appt.appointment_date,
        appointment_time=new_appt.appointment_time,
        meeting_mode=new_appt.meeting_mode,
        home_address=new_appt.home_address,
        purpose=new_appt.purpose,
        additional_message=new_appt.additional_message,
        status=new_appt.status,
        created_at=new_appt.created_at.strftime("%Y-%m-%d %H:%M:%S") if new_appt.created_at else "",
        selected_frames=unpack_selected_frames(new_appt.selected_frames_json),
        face_shape=new_appt.face_shape,
        ipd_mm=new_appt.ipd_mm,
        eye_shape=new_appt.eye_shape,
        face_width_mm=new_appt.face_width_mm,
        face_length_mm=new_appt.face_length_mm,
        jaw_width_mm=new_appt.jaw_width_mm,
        skin_tone=new_appt.skin_tone,
        undertone=new_appt.undertone,
        head_circumference_cm=new_appt.head_circumference_cm,
        face_sketch_image=new_appt.face_sketch_image,
        face_analysis_summary=new_appt.face_analysis_summary,
        doctor_access_url=f"/api/appointments/{new_appt.appointment_id}/doctor-review",
        doctor_id=new_appt.doctor_id,
        doctor_name=doc_name,
        doctor_notes=new_appt.doctor_notes
    )

@router.get("", response_model=List[AppointmentResponse])
def list_appointments(
    appointment_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    List scheduled EyeReach appointments with patient biometrics and face sketches.
    """
    query = db.query(Appointment)
    if appointment_type:
        query = query.filter(Appointment.appointment_type == normalize_type(appointment_type))
    
    records = query.order_by(Appointment.id.desc()).all()
    
    return [
        AppointmentResponse(
            id=r.id,
            appointment_id=r.appointment_id,
            appointment_type=r.appointment_type,
            appointment_type_label=get_type_label(r.appointment_type),
            full_name=r.full_name,
            mobile_number=r.mobile_number,
            email=r.email,
            appointment_date=r.appointment_date,
            appointment_time=r.appointment_time,
            meeting_mode=r.meeting_mode,
            home_address=r.home_address,
            purpose=r.purpose,
            additional_message=r.additional_message,
            status=r.status,
            created_at=r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
            selected_frames=unpack_selected_frames(r.selected_frames_json),
            face_shape=r.face_shape,
            ipd_mm=r.ipd_mm,
            eye_shape=r.eye_shape,
            face_width_mm=r.face_width_mm,
            face_length_mm=r.face_length_mm,
            jaw_width_mm=r.jaw_width_mm,
            skin_tone=r.skin_tone,
            undertone=r.undertone,
            head_circumference_cm=r.head_circumference_cm,
            face_sketch_image=r.face_sketch_image,
            face_analysis_summary=r.face_analysis_summary,
            doctor_access_url=f"/api/appointments/{r.appointment_id}/doctor-review",
            doctor_id=r.doctor_id,
            doctor_name=r.doctor.name if r.doctor else None,
            doctor_notes=r.doctor_notes
        )
        for r in records
    ]

@router.get("/{appointment_id}", response_model=AppointmentResponse)
def get_appointment_by_id(appointment_id: str, db: Session = Depends(get_db)):
    """
    Lookup a scheduled appointment by its unique reference number.
    """
    appt = db.query(Appointment).filter(
        (Appointment.appointment_id == appointment_id.strip()) |
        (Appointment.id == (int(appointment_id) if appointment_id.isdigit() else -1))
    ).first()
    if not appt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Appointment '{appointment_id}' not found."
        )

    return AppointmentResponse(
        id=appt.id,
        appointment_id=appt.appointment_id,
        appointment_type=appt.appointment_type,
        appointment_type_label=get_type_label(appt.appointment_type),
        full_name=appt.full_name,
        mobile_number=appt.mobile_number,
        email=appt.email,
        appointment_date=appt.appointment_date,
        appointment_time=appt.appointment_time,
        meeting_mode=appt.meeting_mode,
        home_address=appt.home_address,
        purpose=appt.purpose,
        additional_message=appt.additional_message,
        status=appt.status,
        created_at=appt.created_at.strftime("%Y-%m-%d %H:%M:%S") if appt.created_at else "",
        selected_frames=unpack_selected_frames(appt.selected_frames_json),
        face_shape=appt.face_shape,
        ipd_mm=appt.ipd_mm,
        eye_shape=appt.eye_shape,
        face_width_mm=appt.face_width_mm,
        face_length_mm=appt.face_length_mm,
        jaw_width_mm=appt.jaw_width_mm,
        skin_tone=appt.skin_tone,
        undertone=appt.undertone,
        head_circumference_cm=appt.head_circumference_cm,
        face_sketch_image=appt.face_sketch_image,
        face_analysis_summary=appt.face_analysis_summary,
        doctor_access_url=f"/api/appointments/{appt.appointment_id}/doctor-review",
        doctor_id=appt.doctor_id,
        doctor_name=appt.doctor.name if appt.doctor else None,
        doctor_notes=appt.doctor_notes
    )

@router.get("/{appointment_id}/doctor-review")
def get_doctor_review_card(appointment_id: str, db: Session = Depends(get_db)):
    """
    Doctor-facing Clinical Consultation Record.
    Provides the doctor/optometrist with all patient biometrics, facial measurements,
    the generated face sketch, and service requests prior to the appointment.
    """
    appt = db.query(Appointment).filter(Appointment.appointment_id == appointment_id.strip()).first()
    if not appt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Appointment '{appointment_id}' not found."
        )

    return {
        "status": "success",
        "appointment_id": appt.appointment_id,
        "patient": {
            "name": appt.full_name,
            "mobile": appt.mobile_number,
            "email": appt.email,
            "address": appt.home_address,
            "mode": appt.meeting_mode or "Doorstep Home Testing"
        },
        "schedule": {
            "date": appt.appointment_date,
            "time": appt.appointment_time,
            "service_type": appt.purpose,
            "notes": appt.additional_message
        },
        "facial_biometrics": {
            "face_shape": appt.face_shape,
            "ipd_mm": appt.ipd_mm,
            "eye_shape": appt.eye_shape,
            "face_width_mm": appt.face_width_mm,
            "face_length_mm": appt.face_length_mm,
            "jaw_width_mm": appt.jaw_width_mm,
            "skin_tone": appt.skin_tone,
            "undertone": appt.undertone,
            "head_circumference_cm": appt.head_circumference_cm,
            "clinical_summary": appt.face_analysis_summary
        },
        "face_sketch": {
            "image_url": appt.face_sketch_image,
            "status": "Available" if appt.face_sketch_image else "Not captured during this session"
        },
        "selected_frames": unpack_selected_frames(appt.selected_frames_json),
        "attending_doctor_instructions": "Review patient IPD and facial contour to prepare diagnostic lenses and tailored frame trial cases before visiting."
    }
