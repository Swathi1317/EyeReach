"""
SmartFrame AI - CLI Dataset Label Review Tool (Enhanced with Review_Required, Preview & Resuming)
Allows human-in-the-loop review of face shape images directly from Windows PowerShell.

Choices per image:
  [1] Heart
  [2] Oblong
  [3] Oval
  [4] Round
  [5] Square
  [R] Review Required (uncertain/ambiguous)
  [S] Skip (unusable/corrupt/distant)
  [P] Preview Image in Default Viewer
  [Q] Quit and Save Decisions
"""

import os
import sys
import datetime
import argparse
import pandas as pd

VALID_CHOICES = {
    "1": "Heart",
    "2": "Oblong",
    "3": "Oval",
    "4": "Round",
    "5": "Square",
    "h": "Heart",
    "heart": "Heart",
    "ob": "Oblong",
    "oblong": "Oblong",
    "ov": "Oval",
    "oval": "Oval",
    "r": "Round",
    "round": "Round",
    "sq": "Square",
    "square": "Square",
    "rr": "Review_Required",
    "review": "Review_Required",
    "review_required": "Review_Required",
    "s": "Skip",
    "skip": "Skip"
}


def open_image_preview(image_path: str):
    """Opens image in default OS photo viewer."""
    if os.path.exists(image_path):
        try:
            os.startfile(image_path)
            print(f"  [Preview opened for: {os.path.basename(image_path)}]")
        except Exception as e:
            print(f"  [Failed to open preview: {e}]")
    else:
        print(f"  [Image file not found: {image_path}]")


def run_cli_review(
    manifest_csv: str = "D:/SmartframeAi/Data/Working_Dataset/master_manifest.csv",
    output_manifest: str = "D:/SmartframeAi/Data/Working_Dataset/reviewed_labels_manifest.csv",
    only_real_world: bool = True
):
    if not os.path.exists(manifest_csv):
        print(f"Error: Manifest not found at {manifest_csv}")
        return

    df = pd.read_csv(manifest_csv)
    if only_real_world and "source_dataset" in df.columns:
        df = df[df["source_dataset"] == "real_world"].copy().reset_index(drop=True)

    print("=" * 72)
    print(" SMARTFRAME AI - INTERACTIVE DATASET LABEL REVIEW CLI")
    print("=" * 72)
    print(f"Total images in review pool: {len(df)}")
    print(f"Output manifest:             {output_manifest}")
    print("Options: [1] Heart | [2] Oblong | [3] Oval | [4] Round | [5] Square")
    print("         [RR] Review Required | [S] Skip | [P] Preview | [Q] Quit & Save")
    print("=" * 72)

    # Load existing progress to enable seamless resuming
    existing_decisions = {}
    if os.path.exists(output_manifest):
        try:
            prev_df = pd.read_csv(output_manifest)
            for _, r in prev_df.iterrows():
                key = r.get("original_filename", r.get("image_path", ""))
                existing_decisions[key] = {
                    "reviewed_label": r.get("reviewed_label", r.get("class_label")),
                    "review_status": r.get("review_status", "MANUALLY_REVIEWED"),
                    "notes": r.get("notes", "")
                }
            print(f"Resuming: Loaded {len(existing_decisions)} existing review decisions.")
        except Exception as e:
            print(f"Warning loading previous manifest: {e}")

    records = []

    for idx, row in df.iterrows():
        fname = row.get("original_filename", os.path.basename(str(row["image_path"])))
        raw_path = str(row["image_path"])

        # Resolve full path
        if os.path.isabs(raw_path) and os.path.exists(raw_path):
            full_path = raw_path
        else:
            cand = os.path.join("D:/SmartframeAi", raw_path.replace("/", "\\"))
            if os.path.exists(cand):
                full_path = cand
            else:
                cand2 = os.path.join("D:/SmartframeAi/Data/Dataset", fname)
                full_path = cand2 if os.path.exists(cand2) else raw_path

        current_label = str(row.get("class_label", "Review_Required"))
        label_stat = str(row.get("label_status", "PENDING_REVIEW"))
        source_ds = str(row.get("source_dataset", "real_world"))

        # Check if already reviewed in previous session
        if fname in existing_decisions:
            dec = existing_decisions[fname]
            rec = row.to_dict()
            rec["reviewed_label"] = dec["reviewed_label"]
            rec["review_status"] = dec["review_status"]
            rec["notes"] = dec["notes"]
            records.append(rec)
            continue

        # Compute dynamic progress stats
        counts = {"Heart": 0, "Oblong": 0, "Oval": 0, "Round": 0, "Square": 0, "Review_Required": 0, "Skip": 0}
        for r_item in records:
            lbl = r_item.get("reviewed_label", "Review_Required")
            counts[lbl] = counts.get(lbl, 0) + 1

        reviewed_count = len(records)
        pending_count = len(df) - reviewed_count

        print(f"\n" + "-" * 72)
        print(f"Progress: {reviewed_count}/{len(df)} Reviewed | {pending_count} Pending")
        print(f"Counts: H:{counts['Heart']} | Ob:{counts['Oblong']} | Ov:{counts['Oval']} | R:{counts['Round']} | Sq:{counts['Square']} | RR:{counts['Review_Required']} | S:{counts['Skip']}")
        print("-" * 72)
        print(f"[{idx+1}/{len(df)}] Image: {fname}")
        print(f"  Current/Tentative Label: {current_label} ({label_stat})")
        print(f"  Physical Path:          {full_path}")
        print(f"  Select: [1] Heart | [2] Oblong | [3] Oval | [4] Round | [5] Square")
        print(f"          [RR] Review Required | [S] Skip | [P] Preview | [Q] Quit & Save")

        while True:
            try:
                choice = input("  Your decision > ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                choice = "q"

            if choice == "q":
                print("\nSaving progress and exiting...")
                save_manifest(records, output_manifest)
                return

            if choice == "p":
                open_image_preview(full_path)
                continue

            if choice in ["rr", "review", "review_required", "r"]:
                final_label = "Review_Required"
                status_str = "REVIEW_REQUIRED"
                note = "Marked for expert review / uncertain morphology"
                break

            if choice in VALID_CHOICES:
                final_label = VALID_CHOICES[choice]
                status_str = "SKIPPED" if final_label == "Skip" else "HUMAN_VERIFIED"
                note = f"Human verified as {final_label}"
                break
            else:
                print("  Invalid choice. Enter 1 (Heart), 2 (Oblong), 3 (Oval), 4 (Round), 5 (Square), RR (Review Required), S (Skip), or P (Preview).")

        rec = row.to_dict()
        rec["reviewed_label"] = final_label
        rec["review_status"] = status_str
        rec["notes"] = note
        records.append(rec)

    save_manifest(records, output_manifest)
    print("\n" + "=" * 72)
    print(" Review session complete! Manifest saved.")
    print("=" * 72)


def save_manifest(records, output_path):
    if not records:
        return
    df_out = pd.DataFrame(records)
    df_out["review_timestamp"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df_out.to_csv(output_path, index=False)
    print(f"\nSaved {len(df_out)} reviewed decisions to: {output_path}")
    print("\nSummary Distribution in Manifest:")
    col = "reviewed_label" if "reviewed_label" in df_out.columns else "class_label"
    print(df_out[col].value_counts().to_string())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SmartFrame AI Interactive Label Review CLI")
    parser.add_argument("--manifest", default="D:/SmartframeAi/Data/Working_Dataset/master_manifest.csv")
    parser.add_argument("--output", default="D:/SmartframeAi/Data/Working_Dataset/reviewed_labels_manifest.csv")
    parser.add_argument("--all_sources", action="store_true", help="Include Kaggle images in review session")

    args = parser.parse_args()
    run_cli_review(
        manifest_csv=args.manifest,
        output_manifest=args.output,
        only_real_world=not args.all_sources
    )
