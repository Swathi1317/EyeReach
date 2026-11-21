import json

path = 'backend/data/kaggle_frames_catalog.json'
with open(path, 'r') as f:
    catalog = json.load(f)

for frame in catalog:
    # Keep width/lens/bridge because they are needed for IPD fit 
    # but wipe temple_length_mm as requested
    frame['temple_length_mm'] = None

with open(path, 'w') as f:
    json.dump(catalog, f, indent=2)

print('Wiped temple length from catalog')
