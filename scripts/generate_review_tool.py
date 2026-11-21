"""
SmartFrame AI - Face Shape Label Review Tool Generator
Wrapper pointing to build_complete_review_tool to maintain backward compatibility.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_complete_review_tool import build_review_tool

if __name__ == "__main__":
    build_review_tool()
