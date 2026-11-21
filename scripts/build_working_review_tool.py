"""
SmartFrame AI - Working Dataset Interactive Review Tool Generator
Builds a standalone, offline-capable HTML review tool for the working dataset.
Supports: Heart, Oblong, Oval, Round, Square, Review Required, Skip.
Tracks reviewed vs pending counts in real time and enables 1-click manifest export.
"""

import os
import io
import json
import base64
import logging
from PIL import Image
import pandas as pd

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("build_working_review_tool")

WORKING_DIR = "D:/SmartframeAi/Data/Working_Dataset"
MANIFEST_PATH = os.path.join(WORKING_DIR, "master_manifest.csv")
REAL_MANIFEST_PATH = "D:/SmartframeAi/Data/Classified_Dataset/reviewed_labels_manifest.csv"
OUTPUT_HTML = os.path.join(WORKING_DIR, "review_tool.html")


def build_working_review_tool():
    logger.info("Building Working Dataset Review Tool...")

    if not os.path.exists(MANIFEST_PATH):
        raise FileNotFoundError(f"Missing master manifest: {MANIFEST_PATH}")

    df_master = pd.read_csv(MANIFEST_PATH)
    # Filter to real-world images by default for intensive human-in-the-loop review
    df_real = df_master[df_master["source_dataset"] == "real_world"].copy().reset_index(drop=True)
    logger.info(f"Loaded {len(df_real)} real-world candidate records.")

    # Load existing reviewed manifest if available for resume support
    existing_decisions = {}
    if os.path.exists(REAL_MANIFEST_PATH):
        try:
            df_prev = pd.read_csv(REAL_MANIFEST_PATH)
            for _, r in df_prev.iterrows():
                fn = r["image_filename"]
                existing_decisions[fn] = {
                    "reviewed_label": r.get("reviewed_label", "Review_Required"),
                    "lw_ratio": r.get("lw_ratio", 0.0),
                    "jaw_angle": r.get("jaw_angle", 0.0),
                    "chin_angle": r.get("chin_angle", 0.0),
                    "reason": r.get("reason", "")
                }
            logger.info(f"Loaded {len(existing_decisions)} existing review decisions for resume.")
        except Exception as e:
            logger.warning(f"Failed to read existing manifest: {e}")

    items = []

    for idx, row in df_real.iterrows():
        fname = row["original_filename"]
        raw_p = row["image_path"]

        full_path = os.path.join("D:/SmartframeAi", raw_p.replace("/", "\\"))
        if not os.path.exists(full_path):
            cand = os.path.join("D:/SmartframeAi/Data/Dataset", fname)
            full_path = cand if os.path.exists(cand) else full_path

        # Generate base64 thumbnail
        b64_str = ""
        try:
            ext = os.path.splitext(fname)[1].lower()
            if ext in [".heic", ".heif"]:
                pil = Image.open(full_path).convert("RGB")
            else:
                pil = Image.open(full_path).convert("RGB")
            pil.thumbnail((360, 360))
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=84)
            b64_str = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception as e:
            logger.warning(f"Failed to make thumbnail for {fname}: {e}")

        # Metadata & existing decision
        dec = existing_decisions.get(fname, {})
        initial_label = dec.get("reviewed_label", row.get("class_label", "Review_Required"))
        lw_val = dec.get("lw_ratio", 0.0)
        jaw_val = dec.get("jaw_angle", 0.0)
        chin_val = dec.get("chin_angle", 0.0)
        reason_val = dec.get("reason", row.get("image_status", ""))

        items.append({
            "id": idx + 1,
            "filename": fname,
            "image_path": raw_p,
            "source_dataset": "real_world",
            "class_label": row.get("class_label", "Review_Required"),
            "initial_decision": initial_label,
            "person_group": row.get("person_group", "unknown"),
            "image_status": row.get("image_status", "USABLE"),
            "lw_ratio": round(float(lw_val), 2),
            "jaw_angle": round(float(jaw_val), 1),
            "chin_angle": round(float(chin_val), 1),
            "reason": str(reason_val),
            "thumbnail_b64": b64_str
        })

    data_json = json.dumps(items)

    html_code = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartFrame AI - Working Dataset Human Review Tool</title>
<style>
  :root {{
    --bg-main: #0b1120;
    --bg-card: #151e32;
    --border: #28354f;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --primary: #3b82f6;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --anthro: #a855f7;
    --skip: #64748b;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg-main);
    color: var(--text-main);
    margin: 0;
    padding: 24px 32px;
  }}
  header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 16px;
  }}
  .title-group h1 {{
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: #60a5fa;
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .title-group p {{
    margin: 6px 0 0 0;
    font-size: 14px;
    color: var(--text-muted);
  }}
  button {{
    background: var(--primary);
    color: white;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }}
  button:hover {{ filter: brightness(1.15); }}
  button.btn-success {{ background: #059669; }}
  button.btn-secondary {{ background: #334155; }}

  .toolbar {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }}
  .stats-pill {{
    background: #0f172a;
    border: 1px solid var(--border);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .filter-box {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }}
  select {{
    background: #0b1120;
    color: var(--text-main);
    border: 1px solid var(--border);
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
  }}

  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 22px;
  }}
  .card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
    transition: transform 0.15s ease, border-color 0.15s ease;
  }}
  .card:hover {{
    transform: translateY(-2px);
    border-color: #3b82f6;
  }}
  .card.is-skipped {{
    opacity: 0.68;
    border-color: #475569;
  }}
  .card.is-review-req {{
    border-color: #f59e0b;
  }}
  .card.is-approved {{
    border-color: #10b981;
  }}

  .img-frame {{
    height: 250px;
    background: #030712;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }}
  .img-frame img {{
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transition: transform 0.2s ease;
  }}
  .img-frame:hover img {{
    transform: scale(1.04);
  }}
  .badge-index {{
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(15, 23, 42, 0.88);
    color: #f1f5f9;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }}
  .badge-status {{
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }}
  .badge-USABLE {{ background: rgba(16,185,129,0.25); color: #34d399; }}
  .badge-QUALITY_EXCLUDED {{ background: rgba(245,158,11,0.25); color: #fbbf24; }}
  .badge-LANDMARK_FAILED {{ background: rgba(239,68,68,0.25); color: #f87171; }}

  .card-body {{
    padding: 14px 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }}
  .fname {{
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
    word-break: break-all;
    margin-bottom: 8px;
  }}
  .meta-row {{
    font-size: 11px;
    color: var(--text-muted);
    background: #0b1120;
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }}
  .reason-box {{
    font-size: 10.5px;
    color: #94a3b8;
    background: #0f172a;
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 12px;
  }}
  .label-title {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }}
  .current-choice {{
    font-weight: 700;
    color: #38bdf8;
  }}

  .options-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: auto;
  }}
  .opt-btn {{
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
    padding: 8px 4px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 5px;
    text-align: center;
    cursor: pointer;
    transition: 0.12s ease;
    user-select: none;
  }}
  .opt-btn:hover {{
    background: #334155;
    color: white;
  }}
  .opt-btn.active {{
    background: #2563eb;
    color: white;
    border-color: #60a5fa;
    box-shadow: 0 0 8px rgba(37,99,235,0.5);
  }}
  .opt-btn.active-rr {{
    background: #b45309;
    color: white;
    border-color: #f59e0b;
  }}
  .opt-btn.active-skip {{
    background: #475569;
    color: #f8fafc;
    border-color: #94a3b8;
  }}

  .empty-state {{
    grid-column: 1 / -1;
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
  }}
</style>
</head>
<body>

<header>
  <div class="title-group">
    <h1>&#128100; SmartFrame AI - Working Dataset Human Review Tool</h1>
    <p>Human-in-the-Loop Verification for Canonical Face Shapes & Quality Exclusions</p>
  </div>
  <div>
    <button class="btn-success" onclick="exportManifest()">&#128190; Save reviewed_labels_manifest.csv</button>
  </div>
</header>

<div class="toolbar">
  <div class="stats-pill" id="statsPill">Reviewed: 0 / 75 | Pending: 75</div>
  <button class="btn-secondary" onclick="resetToInitial()">Reset to Initial Decisions</button>
  <div class="filter-box">
    <label for="filterSelect" style="font-size:13px; color:var(--text-muted); font-weight:600;">Filter:</label>
    <select id="filterSelect" onchange="renderCards()">
      <option value="ALL" selected>All Images (75)</option>
      <option value="Heart">Heart</option>
      <option value="Oblong">Oblong</option>
      <option value="Oval">Oval</option>
      <option value="Round">Round</option>
      <option value="Square">Square</option>
      <option value="Review_Required">Review Required Only</option>
      <option value="Skip">Skip / Excluded Only</option>
    </select>
  </div>
</div>

<div class="grid" id="cardGrid"></div>

<script>
const DATASET = {data_json};
const OPTIONS = ["Heart", "Oblong", "Oval", "Round", "Square", "Review_Required", "Skip"];

// LocalStorage resume support
const STORAGE_KEY = "smartframe_working_review_decisions";
let savedDecisions = {{}};
try {{
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) savedDecisions = JSON.parse(raw);
}} catch (e) {{}}

const userLabels = {{}};
DATASET.forEach(it => {{
  if (savedDecisions[it.filename]) {{
    userLabels[it.filename] = savedDecisions[it.filename];
  }} else if (it.initial_decision && OPTIONS.includes(it.initial_decision)) {{
    userLabels[it.filename] = it.initial_decision;
  }} else {{
    userLabels[it.filename] = "Review_Required";
  }}
}});

function updateStats() {{
  let counts = {{ Heart: 0, Oblong: 0, Oval: 0, Round: 0, Square: 0, Review_Required: 0, Skip: 0 }};
  let reviewed = 0;
  let pending = 0;

  DATASET.forEach(it => {{
    const lbl = userLabels[it.filename] || "Review_Required";
    counts[lbl] = (counts[lbl] || 0) + 1;
    if (lbl === "Review_Required") {{
      pending++;
    }} else {{
      reviewed++;
    }}
  }});

  const pill = document.getElementById("statsPill");
  pill.textContent = `Reviewed: ${{reviewed}} / ${{DATASET.length}} | Pending: ${{pending}} | H:${{counts.Heart}} Ob:${{counts.Oblong}} Ov:${{counts.Oval}} R:${{counts.Round}} Sq:${{counts.Square}} | RR:${{counts.Review_Required}} S:${{counts.Skip}}`;
}}

function renderCards() {{
  const filter = document.getElementById("filterSelect").value;
  const grid = document.getElementById("cardGrid");
  grid.innerHTML = "";

  let renderedCount = 0;

  DATASET.forEach(it => {{
    const currentChoice = userLabels[it.filename] || "Review_Required";

    if (OPTIONS.includes(filter)) {{
      if (currentChoice !== filter) return;
    }}

    renderedCount++;

    const card = document.createElement("div");
    let cardCls = "card";
    if (currentChoice === "Skip") cardCls += " is-skipped";
    else if (currentChoice === "Review_Required") cardCls += " is-review-req";
    else cardCls += " is-approved";
    card.className = cardCls;

    let optionsHtml = OPTIONS.map(opt => {{
      const isSel = currentChoice === opt;
      let btnCls = "opt-btn";
      if (isSel) {{
        if (opt === "Skip") btnCls += " active-skip";
        else if (opt === "Review_Required") btnCls += " active-rr";
        else btnCls += " active";
      }}
      const displayName = opt === "Review_Required" ? "Review" : opt;
      return `<div class="${{btnCls}}" onclick="setChoice('${{it.filename.replace(/'/g, "\\\\\\'")}}', '${{opt}}')">${{displayName}}</div>`;
    }}).join("");

    card.innerHTML = `
      <div class="img-frame">
        <span class="badge-index">#${{it.id}}</span>
        <span class="badge-status badge-${{it.image_status}}">${{it.image_status}}</span>
        <img src="${{it.thumbnail_b64}}" alt="${{it.filename}}" loading="lazy" />
      </div>
      <div class="card-body">
        <div class="fname" title="${{it.filename}}">${{it.filename}}</div>
        
        <div class="meta-row">
          <span>Person: <strong>${{it.person_group}}</strong></span>
          <span>L/W: <strong>${{it.lw_ratio || 'N/A'}}</strong></span>
        </div>

        <div class="reason-box">
          ${{it.reason || 'Morphological evaluation: Jaw ' + it.jaw_angle + '&deg;, Chin ' + it.chin_angle + '&deg;'}}
        </div>

        <div class="label-title">
          <span>Current Label:</span>
          <span class="current-choice">${{currentChoice}}</span>
        </div>

        <div class="options-grid">
          ${{optionsHtml}}
        </div>
      </div>
    `;
    grid.appendChild(card);
  }});

  if (renderedCount === 0) {{
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<h3>No images found matching filter: "${{filter}}"</h3><p>Select "All Images" above to view all candidates.</p>`;
    grid.appendChild(empty);
  }}

  updateStats();
}}

function setChoice(fname, choice) {{
  userLabels[fname] = choice;
  try {{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userLabels));
  }} catch (e) {{}}
  renderCards();
}}

function resetToInitial() {{
  DATASET.forEach(it => {{
    userLabels[it.filename] = it.initial_decision || "Review_Required";
  }});
  try {{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userLabels));
  }} catch (e) {{}}
  renderCards();
}}

function exportManifest() {{
  let csv = "image_filename,reviewed_label,review_status,person_group,lw_ratio,jaw_angle,chin_angle,review_timestamp\\n";
  const now = new Date().toISOString();

  let confirmedCount = 0;
  let skippedCount = 0;
  let reviewReqCount = 0;

  DATASET.forEach(it => {{
    const label = userLabels[it.filename] || "Review_Required";
    let status = "HUMAN_VERIFIED";
    if (label === "Skip") {{
      status = "SKIPPED";
      skippedCount++;
    }} else if (label === "Review_Required") {{
      status = "REVIEW_REQUIRED";
      reviewReqCount++;
    }} else {{
      confirmedCount++;
    }}
    csv += `"${{it.filename}}","${{label}}","${{status}}","${{it.person_group}}",${{it.lw_ratio}},${{it.jaw_angle}},${{it.chin_angle}},"${{now}}"\\n`;
  }});

  const blob = new Blob([csv], {{ type: "text/csv;charset=utf-8;" }});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reviewed_labels_manifest.csv";
  link.click();

  alert(`reviewed_labels_manifest.csv exported!\\n\\nVerified: ${{confirmedCount}}\\nReview Required: ${{reviewReqCount}}\\nSkipped: ${{skippedCount}}`);
}}

renderCards();
</script>
</body>
</html>
"""

    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html_code)

    logger.info(f"Successfully generated Working Dataset Review Tool at: {OUTPUT_HTML}")
    return OUTPUT_HTML


if __name__ == "__main__":
    build_working_review_tool()
