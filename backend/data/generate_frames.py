import json
import random
import os

shapes = ["rectangle", "square", "round", "oval", "cat-eye", "aviator", "geometric"]
colors = [("Black", "neutral"), ("Tortoise", "warm"), ("Silver", "cool"), ("Gold", "warm"), ("Clear", "neutral"), ("Blue", "cool"), ("Red", "warm")]
brands = ["SmartFrame Classic", "SmartFrame Premium", "SmartFrame Sport", "SmartFrame Elite"]

def generate_frames():
    frames = []
    
    # Compatibility rules mapping
    shape_compat = {
        "rectangle": ["Oval", "Round"],
        "square": ["Oval", "Round"],
        "round": ["Square", "Oblong", "Heart", "Oval"],
        "oval": ["Square", "Heart", "Oblong"],
        "cat-eye": ["Round", "Heart", "Oval"],
        "aviator": ["Square", "Heart", "Oblong", "Oval"],
        "geometric": ["Oval", "Round", "Square"]
    }
    
    tone_compat = {
        "warm": ["warm", "neutral"],
        "cool": ["cool", "neutral"],
        "neutral": ["warm", "cool", "neutral"]
    }
    
    for i in range(1, 65):
        category = random.choice(shapes)
        color, color_family = random.choice(colors)
        brand = random.choice(brands)
        
        # approximate IPD compatibility based on lens+bridge
        # average adult IPD is ~63mm. Frame width roughly matches (lens_width * 2) + bridge_width
        # let's generate realistic lens and bridge
        lens_width = random.randint(48, 56)
        bridge_width = random.randint(16, 22)
        frame_width = (lens_width * 2) + bridge_width
        temple_length = random.choice([135, 140, 145])
        
        frames.append({
            "id": f"frame_{i:03d}",
            "name": f"{color} {category.capitalize()}",
            "brand": brand,
            "category": category,
            "shape_compatibility": shape_compat[category],
            "recommended_for_face_shapes": shape_compat[category],
            "width_mm": frame_width,
            "bridge_width_mm": bridge_width,
            "lens_width_mm": lens_width,
            "temple_length_mm": temple_length,
            "color": color,
            "color_family": color_family,
            "suitable_skin_tones": ["fair", "medium", "deep"], # simplified
            "suitable_undertones": tone_compat[color_family],
            "price": random.choice([999, 1499, 1999, 2499, 2999]),
            "currency": "INR",
            "in_stock": random.random() > 0.1,
            "store_ids": ["store_001", "store_002"]
        })
        
    return frames

if __name__ == "__main__":
    frames = generate_frames()
    out_path = os.path.join(os.path.dirname(__file__), 'frames.json')
    with open(out_path, 'w') as f:
        json.dump(frames, f, indent=2)
    print(f"Generated {len(frames)} frames to {out_path}")
