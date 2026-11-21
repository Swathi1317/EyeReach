import cv2
import numpy as np
import glob

files = glob.glob('frontend/public/frames/kaggle/*.png')
print(f"Found {len(files)} files.")
