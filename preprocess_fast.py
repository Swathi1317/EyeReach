import cv2
import numpy as np
import os
import glob
import json

img_dir = 'frontend/public/frames/kaggle'
files = glob.glob(os.path.join(img_dir, '*.jpg'))

for f in files:
    img = cv2.imread(f)
    if img is None: continue
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    alpha = np.zeros_like(gray, dtype=np.float32)
    
    dark_thresh = 210
    light_thresh = 245
    
    alpha[gray < dark_thresh] = 255
    alpha[gray > light_thresh] = 0
    
    mask = (gray >= dark_thresh) & (gray <= light_thresh)
    alpha[mask] = 255 - ((gray[mask] - dark_thresh) / float(light_thresh - dark_thresh) * 255.0)
    
    bgra = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = alpha.astype(np.uint8)
    
    out_path = f.replace('.jpg', '.png')
    cv2.imwrite(out_path, bgra)
    os.remove(f)

cat_path = 'backend/data/kaggle_frames_catalog.json'
with open(cat_path, 'r') as f:
    cat = json.load(f)

for frame in cat:
    if 'image' in frame and frame['image'].endswith('.jpg'):
        frame['image'] = frame['image'].replace('.jpg', '.png')

with open(cat_path, 'w') as f:
    json.dump(cat, f, indent=2)

print("Preprocess done")
