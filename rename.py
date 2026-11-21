import json

path = 'backend/data/kaggle_frames_catalog.json'
with open(path, 'r') as f:
    catalog = json.load(f)

for frame in catalog:
    color = frame.get('color', 'Classic')
    category = frame.get('category', 'Frame')
    sku = frame.get('id', '')
    frame['name'] = f"Elite {color} {category} - {sku}"

with open(path, 'w') as f:
    json.dump(catalog, f, indent=2)

print('Updated names in catalog')
