import json
import os

frames_json_path = r'D:\SmartframeAi\SmartFrameAI\backend\data\frames.json'
output_dir = r'D:\SmartframeAi\SmartFrameAI\frontend\public\frames'

def get_color_hex(color_name):
    cmap = {
        "Black": "#1a1a1a",
        "Gold": "#d4af37",
        "Silver": "#c0c0c0",
        "Brown": "#8b4513",
        "Tortoise": "#5c3a21",
        "Red": "#b30000",
        "Blue": "#00008b",
        "Transparent": "#e0f7fa"
    }
    return cmap.get(color_name, "#333333")

def generate_svg(category, color_hex):
    # Generates a simple SVG for an eyeglasses frame
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%" height="100%">
  <!-- Bridge -->
  <path d="M 180 80 Q 200 70 220 80" fill="none" stroke="{color_hex}" stroke-width="6" />
  <!-- Temples -->
  <line x1="20" y1="75" x2="60" y2="75" stroke="{color_hex}" stroke-width="4" />
  <line x1="380" y1="75" x2="340" y2="75" stroke="{color_hex}" stroke-width="4" />
'''
    
    if category.lower() == "round":
        svg += f'''
  <circle cx="120" cy="100" r="60" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
  <circle cx="280" cy="100" r="60" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
'''
    elif category.lower() in ["square", "rectangle"]:
        height = 70 if category.lower() == "rectangle" else 90
        svg += f'''
  <rect x="60" y="{100 - height//2}" width="120" height="{height}" rx="10" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
  <rect x="220" y="{100 - height//2}" width="120" height="{height}" rx="10" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
'''
    elif category.lower() == "aviator":
        svg += f'''
  <!-- Top bar -->
  <line x1="100" y1="50" x2="300" y2="50" stroke="{color_hex}" stroke-width="4" />
  <path d="M 60 70 Q 120 40 180 70 L 170 140 Q 120 160 60 110 Z" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="6" />
  <path d="M 220 70 Q 280 40 340 70 L 340 110 Q 280 160 230 140 Z" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="6" />
'''
    else:
        # Default oval
        svg += f'''
  <ellipse cx="120" cy="100" rx="60" ry="45" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
  <ellipse cx="280" cy="100" rx="60" ry="45" fill="rgba(255,255,255,0.2)" stroke="{color_hex}" stroke-width="8" />
'''
        
    svg += "</svg>"
    return svg

with open(frames_json_path, 'r', encoding='utf-8') as f:
    frames = json.load(f)

for frame in frames:
    fid = frame['id']
    color = frame.get('color', 'Black')
    category = frame.get('category', 'oval')
    
    color_hex = get_color_hex(color)
    svg_content = generate_svg(category, color_hex)
    
    svg_filename = f"{fid}.svg"
    with open(os.path.join(output_dir, svg_filename), 'w', encoding='utf-8') as sf:
        sf.write(svg_content)
        
    frame['image'] = f"/frames/{svg_filename}"

with open(frames_json_path, 'w', encoding='utf-8') as f:
    json.dump(frames, f, indent=2)

print("SVGs generated and frames.json updated!")
