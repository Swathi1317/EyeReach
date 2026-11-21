import json
cat_path = 'backend/data/kaggle_frames_catalog.json'
with open(cat_path, 'r') as f:
    cat = json.load(f)

for frame in cat:
    if 'image' in frame and frame['image'].endswith('.jpg'):
        frame['image'] = frame['image'].replace('.jpg', '.png')

with open(cat_path, 'w') as f:
    json.dump(cat, f, indent=2)

print("Catalog updated successfully")
