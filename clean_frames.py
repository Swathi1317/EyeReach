import cv2
import numpy as np
import glob
import sys

files = glob.glob('frontend/public/frames/kaggle/*.png')
print(f"Found {len(files)} PNGs to clean.")

for i, f in enumerate(files):
    img = cv2.imread(f, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4: continue
    
    alpha = img[:, :, 3]
    _, binary = cv2.threshold(alpha, 50, 255, cv2.THRESH_BINARY)
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    if hierarchy is None: continue
    
    holes_mask = np.zeros_like(alpha)
    lens_contours = []
    for j, c in enumerate(contours):
        parent_idx = hierarchy[0][j][3]
        if parent_idx != -1: 
            area = cv2.contourArea(c)
            if area > (img.shape[0]*img.shape[1] * 0.015): 
                lens_contours.append(c)
    
    if lens_contours:
        cv2.drawContours(holes_mask, lens_contours, -1, 255, thickness=cv2.FILLED)
        img[:, :, 3][holes_mask == 255] = 0
        
        x_min, y_min = img.shape[1], img.shape[0]
        x_max, y_max = 0, 0
        for c in lens_contours:
            x,y,w,h = cv2.boundingRect(c)
            x_min = min(x_min, x)
            y_min = min(y_min, y)
            x_max = max(x_max, x+w)
            y_max = max(y_max, y+h)
            
        lens_h = y_max - y_min
        pad_y = int(lens_h * 0.4)
        
        valid_y_max = min(img.shape[0], y_max + pad_y)
        img[valid_y_max:, :, 3] = 0
        
    cv2.imwrite(f, img)
    if i % 50 == 0:
        print(f"Processed {i}/1000")
        sys.stdout.flush()

print("Finished cleaning frames.")
