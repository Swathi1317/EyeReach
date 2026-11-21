import cv2
import numpy as np
import glob
import multiprocessing

def process_file(f):
    try:
        img = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if img is None or img.shape[2] != 4: return
        
        alpha = img[:, :, 3]
        
        # Binary threshold (low threshold to catch thin/light rims)
        _, binary = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
        
        # Morphological CLOSE to connect thin rims
        kernel = np.ones((5,5), np.uint8)
        binary_closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
        
        contours, hierarchy = cv2.findContours(binary_closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        
        if hierarchy is None: return
        
        holes_mask = np.zeros_like(alpha)
        lens_contours = []
        for j, c in enumerate(contours):
            parent_idx = hierarchy[0][j][3]
            if parent_idx != -1: 
                area = cv2.contourArea(c)
                # Lower the threshold to catch smaller lenses, but still ignore tiny noise
                if area > (img.shape[0]*img.shape[1] * 0.005): 
                    lens_contours.append(c)
        
        if lens_contours:
            cv2.drawContours(holes_mask, lens_contours, -1, 255, thickness=cv2.FILLED)
            
            # Morphological DILATE the holes mask slightly so we erase right up to the rim
            kernel_dilate = np.ones((7,7), np.uint8)
            holes_mask = cv2.dilate(holes_mask, kernel_dilate, iterations=1)
            
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
            pad_y = int(lens_h * 0.3)
            
            valid_y_max = min(img.shape[0], y_max + pad_y)
            img[valid_y_max:, :, 3] = 0
            
        cv2.imwrite(f, img, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    except Exception as e:
        pass

if __name__ == '__main__':
    files = glob.glob('frontend/public/frames/kaggle/*.png')
    with multiprocessing.Pool() as pool:
        for _ in pool.imap_unordered(process_file, files):
            pass
