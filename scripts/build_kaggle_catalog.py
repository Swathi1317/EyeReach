import os
import json
import shutil
import cv2
import numpy as np

def analyze_frame(image_path):
    img = cv2.imread(image_path)
    if img is None:
        return "Unknown", 0.0, "Unknown"

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Threshold for dark glasses on white background
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return "Unknown", 0.0, "Unknown"
        
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    
    if area < 1000:
        return "Unknown", 0.0, "Unknown"
        
    x, y, w, h = cv2.boundingRect(c)
    aspect_ratio = w / float(h) if h > 0 else 0
    perimeter = cv2.arcLength(c, True)
    circularity = 4 * np.pi * (area / (perimeter * perimeter)) if perimeter > 0 else 0
    extent = area / float(w * h) if w * h > 0 else 0
    
    # Refine Cat-eye / Aviator
    frame_roi = thresh[y:y+h, x:x+w]
    upper_half = frame_roi[0:h//2, :]
    lower_half = frame_roi[h//2:h, :]
    
    upper_area = cv2.countNonZero(upper_half)
    lower_area = cv2.countNonZero(lower_half)
    
    top_heavy_ratio = upper_area / float(lower_area) if lower_area > 0 else 1.0

    category = "Wayfarer" # default fallback
    confidence = 0.5
    
    # Better heuristics
    if aspect_ratio > 2.8:
        category = "Rectangle"
        confidence = 0.8
    elif circularity > 0.45 and aspect_ratio < 2.5:
        category = "Round"
        confidence = 0.85
    elif top_heavy_ratio > 1.35 and aspect_ratio < 2.6:
        category = "Cat-eye"
        confidence = 0.85
    elif top_heavy_ratio < 0.85 and aspect_ratio < 2.5:
        category = "Aviator"
        confidence = 0.85
    elif circularity > 0.35 and 1.2 <= aspect_ratio <= 1.8:
        category = "Oval"
        confidence = 0.75
    elif extent > 0.45 and aspect_ratio < 2.2:
        category = "Square"
        confidence = 0.8
    elif 2.0 <= aspect_ratio <= 2.8 and extent > 0.3:
        category = "Wayfarer"
        confidence = 0.75
    else:
        # Give it a best guess based on aspect ratio
        if aspect_ratio > 2.5:
            category = "Rectangle"
            confidence = 0.5
        elif aspect_ratio < 1.8:
            category = "Round"
            confidence = 0.5
        else:
            category = "Wayfarer"
            confidence = 0.5

    # Color extraction
    mask = cv2.inRange(img, np.array([0, 0, 0]), np.array([230, 230, 230]))
    mean_val = cv2.mean(img, mask=mask)[:3]
    b, g, r = mean_val
    
    color = "Black"
    if r > 150 and g > 100 and b < 100:
        color = "Gold"
    elif r > 100 and g < 100 and b < 100:
        color = "Red"
    elif r > 80 and g > 50 and b < 80 and r > g:
        color = "Tortoise"
    elif r > 120 and g > 120 and b > 120:
        color = "Silver"
    elif b > 120 and r < 100 and g < 100:
        color = "Blue"
    elif max(r,g,b) - min(r,g,b) < 30 and sum((r,g,b)) < 150:
        color = "Black"
    elif r > 100 and g > 80 and b > 50:
        color = "Brown"

    return category, round(confidence, 2), color

def build_catalog():
    source_dir = 'D:/SmartframeAi/Data/eyeglasses'
    dest_dir = 'D:/SmartframeAi/SmartFrameAI/frontend/public/frames/kaggle'
    catalog_path = 'D:/SmartframeAi/SmartFrameAI/backend/data/kaggle_frames_catalog.json'
    
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)
        
    catalog = []
    count = 0
    cat_counts = {}
    
    for sku_id in os.listdir(source_dir):
        product_dir = os.path.join(source_dir, sku_id, 'product')
        if not os.path.exists(product_dir):
            continue
            
        images = [f for f in os.listdir(product_dir) if f.endswith(('.jpg', '.png'))]
        if not images:
            continue
            
        first_img = images[0]
        src_img_path = os.path.join(product_dir, first_img)
        
        new_img_name = f"{sku_id}_{first_img}"
        dest_img_path = os.path.join(dest_dir, new_img_name)
        
        shutil.copy2(src_img_path, dest_img_path)
        
        category, confidence, color = analyze_frame(src_img_path)
        cat_counts[category] = cat_counts.get(category, 0) + 1
        
        frame_data = {
            "id": sku_id,
            "name": f"Kaggle Frame {sku_id}",
            "image": f"/frames/kaggle/{new_img_name}",
            "category": category,
            "category_confidence": confidence,
            "color": color,
            "source": "Kaggle",
            "width_mm": None,
            "lens_width_mm": None,
            "bridge_width_mm": None,
            "temple_length_mm": None,
            "availability": True
        }
        catalog.append(frame_data)
        count += 1
        
        if count >= 1000:
            break
            
    with open(catalog_path, 'w') as f:
        json.dump(catalog, f, indent=2)
        
    print("=== Validation Report ===")
    print(f"Total images processed: {count}")
    print("Category counts:")
    for cat, cnt in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {cat}: {cnt}")

if __name__ == '__main__':
    build_catalog()
