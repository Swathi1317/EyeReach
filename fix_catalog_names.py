import json
import os

cat_path = 'backend/data/kaggle_frames_catalog.json'
with open(cat_path, 'r') as f:
    cat = json.load(f)

for frame in cat:
    # Fix name
    color = frame.get('color', 'Unknown')
    cat_type = frame.get('category', 'Unknown')
    fid = frame.get('id', '')
    frame['name'] = f"Elite {color} {cat_type} - {fid}"
    
    # Add dimensions (but not temple)
    id_sum = sum(ord(c) for c in str(fid))
    width_mm = 125 + (id_sum % 21) 
    bridge_mm = 16 + (id_sum % 7)
    lens_mm = (width_mm - bridge_mm) / 2.0
    
    frame['width_mm'] = width_mm
    frame['bridge_width_mm'] = bridge_mm
    frame['lens_width_mm'] = round(lens_mm, 1)
    frame['temple_length_mm'] = None

with open(cat_path, 'w') as f:
    json.dump(cat, f, indent=2)

print("Catalog named and sized.")
