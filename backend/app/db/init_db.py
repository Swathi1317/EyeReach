import hashlib
import os
from sqlalchemy import text
from .database import engine, Base, SessionLocal
from .models import Shop, Customer, Product, Order, Appointment, CustomerFramePick, Doctor, FrameView

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def ensure_schema_migrations():
    """Ensure newly added columns and tables exist in SQLite database without requiring data wipe."""
    Base.metadata.create_all(bind=engine)
    if engine.name == "sqlite":
        try:
            with engine.connect() as conn:
                # 1. Appointments migrations
                res = conn.execute(text("PRAGMA table_info(appointments);")).fetchall()
                cols = [r[1] for r in res]
                if "selected_frames_json" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN selected_frames_json TEXT;"))
                if "doctor_id" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN doctor_id INTEGER;"))
                if "doctor_notes" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN doctor_notes TEXT;"))

                # 2. Products migrations
                p_res = conn.execute(text("PRAGMA table_info(products);")).fetchall()
                p_cols = [r[1] for r in p_res]
                if "view_count" not in p_cols:
                    conn.execute(text("ALTER TABLE products ADD COLUMN view_count INTEGER DEFAULT 0;"))
                if "selection_count" not in p_cols:
                    conn.execute(text("ALTER TABLE products ADD COLUMN selection_count INTEGER DEFAULT 0;"))

                conn.commit()
        except Exception as e:
            print(f"Notice during SQLite schema migration: {e}")

    # Seed default doctor & link appointments & update real frame images
    db = SessionLocal()
    try:
        # Check doctor
        doc = db.query(Doctor).first()
        if not doc:
            shop = db.query(Shop).first()
            doc = Doctor(
                name="Dr. Priya Nair",
                email="doctor@eyereach.com",
                mobile="9845012345",
                specialization="Consultant Optometrist",
                qualification="M.Optom, F.I.A.C.L.",
                registration_number="KA-OPT-2019-8821",
                password_hash=hash_password("doctor123"),
                shop_id=shop.id if shop else 1,
                is_active=True
            )
            db.add(doc)
            db.commit()
            db.refresh(doc)
            print(f"Seeded default Optometrist Doctor: {doc.name} ({doc.email})")

        # Assign existing unassigned appointments to this doctor
        unassigned_appts = db.query(Appointment).filter(Appointment.doctor_id == None).all()
        for a in unassigned_appts:
            a.doctor_id = doc.id
        if unassigned_appts:
            db.commit()

        # Migrate any cartoon SVGs in Product table to real spectacle photos
        kaggle_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "frames", "kaggle")
        if os.path.exists(kaggle_dir):
            real_images = sorted([f"/frames/kaggle/{f}" for f in os.listdir(kaggle_dir) if f.endswith(".png")])
            if real_images:
                products = db.query(Product).all()
                for idx, prod in enumerate(products):
                    if prod.front_image and prod.front_image.endswith(".svg"):
                        img_path = real_images[idx % len(real_images)]
                        prod.front_image = img_path
                        prod.side_image = img_path
                        prod.angled_image = img_path
                
                # Also update CustomerFramePick images if SVG
                picks = db.query(CustomerFramePick).all()
                for idx, pick in enumerate(picks):
                    if pick.front_image and pick.front_image.endswith(".svg"):
                        pick.front_image = real_images[idx % len(real_images)]

                # Update view_count and selection_count
                for idx, prod in enumerate(products):
                    picks_count = db.query(CustomerFramePick).filter(
                        (CustomerFramePick.product_id == prod.product_id) | (CustomerFramePick.product_id == str(prod.id))
                    ).count()
                    prod.selection_count = picks_count
                    # Differentiated realistic view counts (e.g. 3x to 5x views of selections + baseline)
                    if not prod.view_count or prod.view_count == 0:
                        prod.view_count = (picks_count * 3) + ((idx * 7 + 23) % 45) + 15
                
                db.commit()
                print("Migrated product images to real spectacle photos and updated view/selection counts.")

        # Migrate frames.json to real spectacle photos
        frames_json_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "frames.json")
        if os.path.exists(frames_json_path) and os.path.exists(kaggle_dir):
            real_images = sorted([f"/frames/kaggle/{f}" for f in os.listdir(kaggle_dir) if f.endswith(".png")])
            if real_images:
                import json
                with open(frames_json_path, "r", encoding="utf-8") as f:
                    frames_data = json.load(f)
                updated = False
                for idx, fr in enumerate(frames_data):
                    if fr.get("image", "").endswith(".svg"):
                        img_path = real_images[idx % len(real_images)]
                        fr["image"] = img_path
                        fr["side_image"] = img_path
                        fr["angled_image"] = img_path
                        updated = True
                if updated:
                    with open(frames_json_path, "w", encoding="utf-8") as f:
                        json.dump(frames_data, f, indent=2)
                    print(f"Updated {len(frames_data)} frames in frames.json with real spectacle photos.")
    except Exception as err:
        db.rollback()
        print(f"Notice during doctor/image migration: {err}")
    finally:
        db.close()

def seed_customer_frame_preferences(db):
    """Seed realistic customer frame picks if none exist, producing aggregate demand figures."""
    try:
        existing_picks = db.query(CustomerFramePick).count()
        if existing_picks > 0:
            return

        products = db.query(Product).all()
        if not products:
            return

        # Ensure we have enough customer records for realistic aggregate metrics
        current_cust_count = db.query(Customer).count()
        needed = 50 - current_cust_count
        if needed > 0:
            for i in range(1, needed + 1):
                c = Customer(
                    name=f"Customer {current_cust_count + i}",
                    mobile=f"98000{10000 + i}",
                    email=f"customer{current_cust_count + i}@eyereach.com",
                    address=f"Flat {i * 10}, Residency Road, Bengaluru",
                    password_hash=hash_password("user123"),
                    face_shape=["Oval", "Round", "Square", "Heart", "Oblong"][i % 5]
                )
                db.add(c)
            db.commit()

        customers = db.query(Customer).all()
        if not customers:
            return

        # Find key representative frames by shape and color
        black_round = next((p for p in products if "round" in (p.shape or "").lower() and "black" in (p.color or "").lower()), products[0])
        brown_square = next((p for p in products if "square" in (p.shape or "").lower() and ("brown" in (p.color or "").lower() or "tortoise" in (p.color or "").lower())), products[min(1, len(products)-1)])
        gold_cat_eye = next((p for p in products if "cat" in (p.shape or "").lower() and "gold" in (p.color or "").lower()), products[min(2, len(products)-1)])
        blue_aviator = next((p for p in products if "aviator" in (p.shape or "").lower() and ("blue" in (p.color or "").lower() or "metal" in (p.material or "").lower())), products[min(3, len(products)-1)])
        silver_rectangle = next((p for p in products if "rectangle" in (p.shape or "").lower() and "silver" in (p.color or "").lower()), products[min(4, len(products)-1)])

        picks_to_add = []
        # Target likes:
        # Black Round ~ 45 likes
        for cust in customers[:45]:
            picks_to_add.append(CustomerFramePick(
                customer_id=cust.id,
                product_id=black_round.product_id,
                brand=black_round.brand,
                name=black_round.name,
                shape=black_round.shape,
                color=black_round.color,
                price=black_round.price,
                material=black_round.material,
                front_image=black_round.front_image
            ))

        # Brown/Tortoise Square ~ 30 likes
        for cust in customers[:30]:
            picks_to_add.append(CustomerFramePick(
                customer_id=cust.id,
                product_id=brown_square.product_id,
                brand=brown_square.brand,
                name=brown_square.name,
                shape=brown_square.shape,
                color=brown_square.color,
                price=brown_square.price,
                material=brown_square.material,
                front_image=brown_square.front_image
            ))

        # Gold Cat Eye ~ 25 likes
        for cust in customers[:25]:
            picks_to_add.append(CustomerFramePick(
                customer_id=cust.id,
                product_id=gold_cat_eye.product_id,
                brand=gold_cat_eye.brand,
                name=gold_cat_eye.name,
                shape=gold_cat_eye.shape,
                color=gold_cat_eye.color,
                price=gold_cat_eye.price,
                material=gold_cat_eye.material,
                front_image=gold_cat_eye.front_image
            ))

        # Blue Aviator ~ 18 likes
        for cust in customers[:18]:
            picks_to_add.append(CustomerFramePick(
                customer_id=cust.id,
                product_id=blue_aviator.product_id,
                brand=blue_aviator.brand,
                name=blue_aviator.name,
                shape=blue_aviator.shape,
                color=blue_aviator.color,
                price=blue_aviator.price,
                material=blue_aviator.material,
                front_image=blue_aviator.front_image
            ))

        # Silver Rectangle ~ 14 likes
        for cust in customers[:14]:
            picks_to_add.append(CustomerFramePick(
                customer_id=cust.id,
                product_id=silver_rectangle.product_id,
                brand=silver_rectangle.brand,
                name=silver_rectangle.name,
                shape=silver_rectangle.shape,
                color=silver_rectangle.color,
                price=silver_rectangle.price,
                material=silver_rectangle.material,
                front_image=silver_rectangle.front_image
            ))

        db.add_all(picks_to_add)
        db.commit()
        print(f"Seeded {len(picks_to_add)} customer frame preferences across popular models.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding customer frame preferences: {e}")

def init_and_seed_db():
    ensure_schema_migrations()
    db = SessionLocal()

    try:
        # Seed customer preferences if products and customers exist
        seed_customer_frame_preferences(db)

        # Check if shop already exists
        existing_shop = db.query(Shop).first()
        if existing_shop:
            return

        print("Seeding initial Optical Shops and Products for EyeReach...")

        # 1. Seed Optical Shop 1
        shop1 = Shop(
            owner_name="Rajesh Sharma",
            shop_name="VisionCraft Opticians",
            mobile_number="9876543210",
            email="rajesh@visioncraft.com",
            shop_address="Shop 14, Commercial Complex, MG Road, Bengaluru, Karnataka",
            password_hash=hash_password("admin123"),
            subscription_plan="Pro Store"
        )
        db.add(shop1)
        db.flush()

        # 2. Seed Optical Shop 2
        shop2 = Shop(
            owner_name="Priya Patel",
            shop_name="LuxeOptics Studio",
            mobile_number="9823456789",
            email="priya@luxeoptics.com",
            shop_address="Plot 42, High Street Mall, Bandra West, Mumbai, Maharashtra",
            password_hash=hash_password("admin123"),
            subscription_plan="Enterprise"
        )
        db.add(shop2)
        db.flush()

        # 3. Seed Customers
        cust1 = Customer(
            name="Aarav Mehta",
            mobile="9811223344",
            email="aarav@gmail.com",
            address="Koramangala 4th Block, Bengaluru",
            password_hash=hash_password("user123"),
            face_shape="oval",
            ipd_mm=63.5,
            skin_tone="Fair",
            undertone="neutral"
        )
        cust2 = Customer(
            name="Ananya Iyer",
            mobile="9822334455",
            email="ananya@gmail.com",
            address="Indiranagar, Bengaluru",
            password_hash=hash_password("user123"),
            face_shape="round",
            ipd_mm=61.0,
            skin_tone="Warm",
            undertone="warm"
        )
        db.add_all([cust1, cust2])
        db.flush()

        # 4. Seed Products for Shop 1 (VisionCraft)
        p1 = Product(
            product_id="FR001",
            shop_id=shop1.id,
            brand="Ray-Ban",
            name="Classic Round Acetate",
            shape="Round",
            material="Acetate",
            color="Black",
            frame_type="Full Rim",
            size="50-18-140",
            lens_width_mm=50.0,
            bridge_width_mm=18.0,
            temple_length_mm=140.0,
            frame_width_mm=124.0,
            lens_height_mm=45.0,
            price=1800.0,
            stock_quantity=12,
            gender_category="Unisex",
            description="Timeless round frame crafted from premium cellulose acetate with polished bevelled edges and durable five-barrel hinges.",
            front_image="/frames/frame_044.svg",
            side_image="/frames/frame_044.svg",
            angled_image="/frames/frame_044.svg"
        )

        p2 = Product(
            product_id="FR002",
            shop_id=shop1.id,
            brand="Oakley",
            name="Executive Rectangle Titanium",
            shape="Rectangle",
            material="Titanium",
            color="Silver",
            frame_type="Semi-Rimless",
            size="54-17-142",
            lens_width_mm=54.0,
            bridge_width_mm=17.0,
            temple_length_mm=142.0,
            frame_width_mm=128.0,
            lens_height_mm=36.0,
            price=2499.0,
            stock_quantity=8,
            gender_category="Men",
            description="Ultra-lightweight Japanese aerospace-grade titanium frame designed for commanding professional appeal and all-day comfort.",
            front_image="/frames/frame_041.svg",
            side_image="/frames/frame_041.svg",
            angled_image="/frames/frame_041.svg"
        )

        p3 = Product(
            product_id="FR003",
            shop_id=shop1.id,
            brand="Vogue Eyewear",
            name="Sleek Cat-Eye Chic",
            shape="Cat-Eye",
            material="Acetate",
            color="Gold",
            frame_type="Full Rim",
            size="52-19-140",
            lens_width_mm=52.0,
            bridge_width_mm=19.0,
            temple_length_mm=140.0,
            frame_width_mm=125.0,
            lens_height_mm=42.0,
            price=2199.0,
            stock_quantity=15,
            gender_category="Women",
            description="Elegant upturned silhouette highlighting cheekbone definition with warm gold accents and ergonomic nose-pads.",
            front_image="/frames/frame_031.svg",
            side_image="/frames/frame_031.svg",
            angled_image="/frames/frame_031.svg"
        )

        p4 = Product(
            product_id="FR004",
            shop_id=shop1.id,
            brand="Fastrack",
            name="Urban Aviator Tech",
            shape="Aviator",
            material="Metal",
            color="Blue",
            frame_type="Full Rim",
            size="55-18-140",
            lens_width_mm=55.0,
            bridge_width_mm=18.0,
            temple_length_mm=140.0,
            frame_width_mm=132.0,
            lens_height_mm=48.0,
            price=1499.0,
            stock_quantity=20,
            gender_category="Men",
            description="Double-bridge aviator silhouette engineered with lightweight alloy rims and scratch-resistant matte blue coating.",
            front_image="/frames/frame_030.svg",
            side_image="/frames/frame_030.svg",
            angled_image="/frames/frame_030.svg"
        )

        p5 = Product(
            product_id="FR005",
            shop_id=shop1.id,
            brand="Titan Eyeplus",
            name="Vintage Tortoise Square",
            shape="Square",
            material="TR90",
            color="Tortoise",
            frame_type="Full Rim",
            size="51-18-145",
            lens_width_mm=51.0,
            bridge_width_mm=18.0,
            temple_length_mm=145.0,
            frame_width_mm=126.0,
            lens_height_mm=40.0,
            price=1699.0,
            stock_quantity=0, # Out of stock item for dashboard testing!
            gender_category="Unisex",
            description="Flexible TR90 memory polymer frame with warm Havana tortoise patterning, offering high resilience and zero temple pinch.",
            front_image="/frames/frame_029.svg",
            side_image="/frames/frame_029.svg",
            angled_image="/frames/frame_029.svg"
        )

        # 5. Seed Products for Shop 2 (LuxeOptics)
        p6 = Product(
            product_id="LX101",
            shop_id=shop2.id,
            brand="Tom Ford",
            name="Imperial Geometric Gold",
            shape="Geometric",
            material="Titanium",
            color="Gold",
            frame_type="Full Rim",
            size="53-19-145",
            lens_width_mm=53.0,
            bridge_width_mm=19.0,
            temple_length_mm=145.0,
            frame_width_mm=127.0,
            lens_height_mm=44.0,
            price=4200.0,
            stock_quantity=6,
            gender_category="Unisex",
            description="Avant-garde octagonal faceted rims finished in 18k electroplated gold, handcrafted for luxury eyewear connoisseurs.",
            front_image="/frames/frame_017.svg",
            side_image="/frames/frame_017.svg",
            angled_image="/frames/frame_017.svg"
        )

        p7 = Product(
            product_id="LX102",
            shop_id=shop2.id,
            brand="Prada",
            name="Milanese Oval Acetate",
            shape="Oval",
            material="Acetate",
            color="Tortoise",
            frame_type="Full Rim",
            size="52-18-140",
            lens_width_mm=52.0,
            bridge_width_mm=18.0,
            temple_length_mm=140.0,
            frame_width_mm=122.0,
            lens_height_mm=38.0,
            price=3800.0,
            stock_quantity=9,
            gender_category="Women",
            description="Soft curved oval architecture balancing strong angular facial lines with rich amber tortoise nuances.",
            front_image="/frames/frame_026.svg",
            side_image="/frames/frame_026.svg",
            angled_image="/frames/frame_026.svg"
        )

        db.add_all([p1, p2, p3, p4, p5, p6, p7])
        db.flush()

        # 6. Seed Sample Orders for Shop 1
        ord1 = Order(
            order_number="ORD-2026-001",
            shop_id=shop1.id,
            customer_id=cust1.id,
            customer_name="Aarav Mehta",
            customer_phone="9811223344",
            customer_email="aarav@gmail.com",
            product_id=p1.id,
            product_code=p1.product_id,
            product_name=p1.name,
            quantity=1,
            unit_price=1800.0,
            total_amount=1800.0,
            status="Completed",
            notes="Fitted with Anti-Glare Blue Cut Lenses. Customer IPD 63.5mm."
        )

        ord2 = Order(
            order_number="ORD-2026-002",
            shop_id=shop1.id,
            customer_id=cust2.id,
            customer_name="Ananya Iyer",
            customer_phone="9822334455",
            customer_email="ananya@gmail.com",
            product_id=p3.id,
            product_code=p3.product_id,
            product_name=p3.name,
            quantity=1,
            unit_price=2199.0,
            total_amount=2199.0,
            status="Ready for Pickup",
            notes="Single vision progressive lens fitting requested."
        )

        ord3 = Order(
            order_number="ORD-2026-003",
            shop_id=shop1.id,
            customer_id=cust1.id,
            customer_name="Karan Verma",
            customer_phone="9844556677",
            customer_email="karan@gmail.com",
            product_id=p2.id,
            product_code=p2.product_id,
            product_name=p2.name,
            quantity=1,
            unit_price=2499.0,
            total_amount=2499.0,
            status="Confirmed",
            notes="Ordered via SmartFrame AI customer try-on portal."
        )

        db.add_all([ord1, ord2, ord3])
        db.commit()
        print("Database initialized and successfully seeded!")

    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    init_and_seed_db()
