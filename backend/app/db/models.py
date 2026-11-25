import datetime
from sqlalchemy import Column, Integer, String, Float, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class Shop(Base):
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    owner_name = Column(String(150), nullable=False)
    shop_name = Column(String(150), nullable=False, index=True)
    mobile_number = Column(String(20), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    shop_address = Column(Text, nullable=False)
    password_hash = Column(String(255), nullable=False)
    subscription_plan = Column(String(50), default="Pro Store")
    operating_hours = Column(String(200), default="09:00 AM - 08:00 PM, Mon-Sat")
    home_visit_available = Column(Boolean, default=True)
    shop_info = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    products = relationship("Product", back_populates="shop", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="shop", cascade="all, delete-orphan")
    doctors = relationship("Doctor", back_populates="shop", cascade="all, delete-orphan")
    appointments = relationship("Appointment", back_populates="shop")

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    mobile = Column(String(20), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    address = Column(Text, nullable=True)
    password_hash = Column(String(255), nullable=False)
    face_shape = Column(String(50), nullable=True)
    ipd_mm = Column(Float, nullable=True)
    skin_tone = Column(String(50), nullable=True)
    undertone = Column(String(50), nullable=True)
    last_exam_date = Column(DateTime, nullable=True)
    reminder_interval_months = Column(Integer, default=12)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    orders = relationship("Order", back_populates="customer")
    frame_picks = relationship("CustomerFramePick", back_populates="customer", cascade="all, delete-orphan")
    cart_items = relationship("CartItem", back_populates="customer", cascade="all, delete-orphan")
    notifications = relationship("CustomerNotification", back_populates="customer", cascade="all, delete-orphan")

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(String(100), index=True, nullable=False) # e.g. "FR001"
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False, index=True)
    
    brand = Column(String(100), nullable=False)
    name = Column(String(150), nullable=False) # Frame Name
    shape = Column(String(50), nullable=False) # Round, Rectangle, Square, Aviator, Cat-Eye, Oval, Geometric, Browline
    material = Column(String(100), nullable=False) # Acetate, Titanium, Metal, TR90, Wood, Mixed
    color = Column(String(50), nullable=False) # Black, Gold, Silver, Tortoise, Blue, Red, Clear, etc.
    frame_type = Column(String(50), nullable=False) # Full Rim, Semi-Rimless, Rimless
    size = Column(String(50), nullable=False) # e.g. "50-18-140" or "Medium"
    
    # Specific Physical Dimensions (Boxing system mm)
    lens_width_mm = Column(Float, nullable=True) # A
    bridge_width_mm = Column(Float, nullable=True) # DBL
    temple_length_mm = Column(Float, nullable=True) # Temple
    frame_width_mm = Column(Float, nullable=True) # Total width
    lens_height_mm = Column(Float, nullable=True) # B
    
    price = Column(Float, nullable=False)
    stock_quantity = Column(Integer, default=1)
    gender_category = Column(String(50), default="Unisex") # Men, Women, Unisex, Kids
    description = Column(Text, nullable=True)
    
    # Multi-angle product imagery
    front_image = Column(String(500), nullable=False)
    side_image = Column(String(500), nullable=True)
    angled_image = Column(String(500), nullable=True)
    
    is_active = Column(Boolean, default=True)
    view_count = Column(Integer, default=0)
    selection_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    shop = relationship("Shop", back_populates="products")
    orders = relationship("Order", back_populates="product")
    cart_items = relationship("CartItem", back_populates="product", cascade="all, delete-orphan")

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    customer_name = Column(String(150), nullable=False)
    customer_phone = Column(String(20), nullable=False)
    customer_email = Column(String(150), nullable=True)
    customer_address = Column(Text, nullable=True)
    
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_code = Column(String(100), nullable=False)
    product_name = Column(String(150), nullable=False)
    
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, nullable=False)
    total_amount = Column(Float, nullable=False)
    status = Column(String(50), default="Pending") # Pending, Confirmed, Preparing Lenses, Dispatched, Delivered, Completed, Rejected, Cancelled
    rejection_reason = Column(Text, nullable=True)
    
    # Prescription & Service linkage
    has_prescription = Column(Boolean, default=False)
    prescription_url = Column(String(500), nullable=True)
    prescription_text = Column(Text, nullable=True)
    is_home_trial = Column(Boolean, default=False)
    is_vision_test_required = Column(Boolean, default=False)
    
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    shop = relationship("Shop", back_populates="orders")
    customer = relationship("Customer", back_populates="orders")
    product = relationship("Product", back_populates="orders")

class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(String(50), unique=True, index=True, nullable=False) # e.g. "ER-2026-78421"
    appointment_type = Column(String(50), nullable=False) # "meeting" or "home_testing"
    service_type = Column(String(50), default="both") # "frame_trial", "vision_test", "both"
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True, index=True)
    
    full_name = Column(String(150), nullable=False)
    mobile_number = Column(String(25), nullable=False)
    email = Column(String(150), nullable=False)
    appointment_date = Column(String(20), nullable=False) # YYYY-MM-DD
    appointment_time = Column(String(20), nullable=False) # e.g. "10:30 AM"
    meeting_mode = Column(String(50), nullable=True) # "Online" or "In Person" (for meetings)
    home_address = Column(Text, nullable=True) # for home testing
    purpose = Column(String(200), nullable=False) # Purpose of Meeting or Type of Test
    additional_message = Column(Text, nullable=True)
    status = Column(String(50), default="Pending") # Pending, Confirmed, Rejected, Completed, Cancelled
    visit_status = Column(String(50), default="Pending") # Pending, Accepted, Scheduled, In Progress, Final Frame Selected, Completed, Rejected
    rejection_reason = Column(Text, nullable=True)
    
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=True, index=True)
    doctor_notes = Column(Text, nullable=True)
    
    # Prescription & Vision Exam data
    has_prescription = Column(Boolean, default=False)
    prescription_file = Column(String(500), nullable=True)
    prescription_data_json = Column(Text, nullable=True) # JSON of SPH, CYL, AXIS, ADD for OD/OS
    
    # Final chosen frame from trial
    final_selected_frame_id = Column(String(100), nullable=True)
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Face Analysis & Biometrics transferred from facial scan
    face_shape = Column(String(50), nullable=True)
    ipd_mm = Column(Float, nullable=True)
    eye_shape = Column(String(50), nullable=True)
    face_width_mm = Column(Float, nullable=True)
    face_length_mm = Column(Float, nullable=True)
    jaw_width_mm = Column(Float, nullable=True)
    skin_tone = Column(String(50), nullable=True)
    undertone = Column(String(50), nullable=True)
    head_circumference_cm = Column(Float, nullable=True)
    face_sketch_image = Column(Text, nullable=True)
    face_analysis_summary = Column(Text, nullable=True)
    selected_frames_json = Column(Text, nullable=True) # JSON list of selected frames for home visit trial (max 10)

    doctor = relationship("Doctor", back_populates="appointments")
    shop = relationship("Shop", back_populates="appointments")

class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    mobile = Column(String(25), nullable=False)
    specialization = Column(String(100), default="Optometrist")
    qualification = Column(String(100), default="B.Optom / M.Optom")
    registration_number = Column(String(50), nullable=True)
    password_hash = Column(String(255), nullable=False)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True, index=True)
    available_days = Column(String(200), default="Mon,Tue,Wed,Thu,Fri,Sat")
    available_hours = Column(String(100), default="09:00 AM - 06:00 PM")
    profile_photo = Column(String(500), nullable=True)
    is_available = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    shop = relationship("Shop", back_populates="doctors")
    appointments = relationship("Appointment", back_populates="doctor")

class FrameView(Base):
    __tablename__ = "frame_views"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(String(100), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    viewed_at = Column(DateTime, default=datetime.datetime.utcnow)

class CustomerFramePick(Base):
    __tablename__ = "customer_frame_picks"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    product_id = Column(String(100), nullable=False, index=True) # Product code or DB ID
    brand = Column(String(100), nullable=True)
    name = Column(String(150), nullable=False)
    shape = Column(String(50), nullable=True) # Round, Rectangle, Square, Aviator, Cat-Eye, Oval, etc.
    color = Column(String(50), nullable=True) # Black, Gold, Silver, Tortoise, Blue, Brown, etc.
    price = Column(Float, nullable=True)
    material = Column(String(100), nullable=True)
    front_image = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    customer = relationship("Customer", back_populates="frame_picks")

class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, default=1)
    selected_for_trial = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    customer = relationship("Customer", back_populates="cart_items")
    product = relationship("Product", back_populates="cart_items")

class CustomerNotification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(50), default="order") # 'order', 'home_trial', 'vision_test', 'prescription', 'reminder'
    reference_id = Column(String(100), nullable=True) # order_number or appointment_id
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    customer = relationship("Customer", back_populates="notifications")
