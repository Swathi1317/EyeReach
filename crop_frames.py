import cv2
import numpy as np
import glob
import multiprocessing
import os

def process_file(f):
    try:
        img = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if img is None or img.shape[2] != 4: return
        
        alpha = img[:, :, 3]
        
        # Find all non-transparent pixels
        coords = cv2.findNonZero(alpha)
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            
            # Crop the image to the exact bounding box of the glasses
            cropped = img[y:y+h, x:x+w]
            
            # Save it back
            cv2.imwrite(f, cropped, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    except Exception as e:
        pass

if __name__ == '__main__':
    files = glob.glob('frontend/public/frames/kaggle/*.png')
    print(f"Found {len(files)} PNGs to crop.")
    with multiprocessing.Pool() as pool:
        for i, _ in enumerate(pool.imap_unordered(process_file, files)):
            if i % 100 == 0:
                print(f"Cropped {i}/1000")
