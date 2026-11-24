import os
import sqlite3
import cv2
import numpy as np

def clean_frame_asset(img_path):
    if not os.path.exists(img_path):
        return False
    
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4:
        return False
        
    h, w = img.shape[:2]
    # Remove bottom photography shadow (last 3.5% of height)
    img[int(h * 0.965):, :, 3] = 0

    alpha = (img[:, :, 3] > 30).astype(np.uint8)

    # Find external contour to get the filled silhouette
    ext_cnts, _ = cv2.findContours(alpha, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not ext_cnts:
        return False
    largest = max(ext_cnts, key=cv2.contourArea)
    solid = np.zeros((h, w), dtype=np.uint8)
    cv2.drawContours(solid, [largest], -1, 255, -1)

    # Holes in silhouette are the lens openings
    holes = ((solid == 255) & (alpha == 0)).astype(np.uint8)
    hole_cnts, _ = cv2.findContours(holes, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter holes: only large holes (area > 1.2% of total image area)
    valid_holes = []
    for c in hole_cnts:
        area = cv2.contourArea(c)
        if area > (w * h * 0.012):
            M = cv2.moments(c)
            if M['m00'] > 0:
                cx = M['m10'] / M['m00']
                valid_holes.append((area, cx, c))
    
    # Sort by area descending
    valid_holes.sort(key=lambda x: x[0], reverse=True)
    
    clean = img.copy()
    # Punch out interior of top 2 holes (the two lenses)
    for area, cx, c in valid_holes[:2]:
        hull = cv2.convexHull(c)
        cv2.drawContours(clean, [hull], -1, (0, 0, 0, 0), -1)

    # In outer corner zones (x < 0.10*w or x > 0.90*w), remove dark folded temple arms
    b, g, r, a = clean[:, :, 0], clean[:, :, 1], clean[:, :, 2], clean[:, :, 3]
    x_grid = np.tile(np.arange(w), (h, 1))
    is_outer = (x_grid < int(0.10 * w)) | (x_grid > int(0.90 * w))
    is_dark_arm = (a > 30) & (b < 95) & (g < 95) & (r < 95) & is_outer
    clean[is_dark_arm, 3] = 0

    cv2.imwrite(img_path, clean)
    return True

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(base_dir, "backend", "data", "smartframe.db")
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT DISTINCT front_image FROM products")
    rows = c.fetchall()
    
    processed = 0
    for (img_rel,) in rows:
        if not img_rel or not img_rel.startswith("/frames/kaggle/"):
            continue
        rel_path = img_rel.lstrip("/")
        full_path = os.path.join(base_dir, "frontend", "public", rel_path)
        if clean_frame_asset(full_path):
            processed += 1
            print(f"Cleaned frame asset: {img_rel}")
            
    print(f"Total catalog frames cleaned: {processed}")

if __name__ == "__main__":
    main()
