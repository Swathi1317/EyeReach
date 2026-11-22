import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .config import settings
from .db.init_db import init_and_seed_db

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure Database is initialized and seeded
    logger.info("Starting up EyeReach – Home Testing App Optical Store & Recommendation System...")
    try:
        init_and_seed_db()
        logger.info("EyeReach database initialized and verified.")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
    yield
    logger.info("Shutting down EyeReach – Home Testing App...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for uploads (AI generated frames and shop assets)
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

from .routers import (
    phase1,
    phase2,
    recommendations,
    fit_stability,
    shop_auth,
    shop_inventory,
    shop_ai,
    customer_portal,
    appointments,
    doctor
)

app.include_router(phase1.router)
app.include_router(phase2.router)
app.include_router(recommendations.router)
app.include_router(fit_stability.router)
app.include_router(shop_auth.router)
app.include_router(shop_inventory.router)
app.include_router(shop_ai.router)
app.include_router(customer_portal.router)
app.include_router(appointments.router)
app.include_router(doctor.router)

@app.get("/health", summary="Health Check")
async def health_check():
    """
    Basic health check API to verify service is running.
    """
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME
    }

from fastapi import HTTPException
from fastapi.responses import FileResponse

# Mount frontend production build and SPA routes if dist exists
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))

# Mount assets (compiled JS and CSS)
assets_dir = os.path.join(FRONTEND_DIST, "assets")
if os.path.isdir(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

# Mount frames
frames_dir = os.path.join(FRONTEND_DIST, "frames")
if not os.path.isdir(frames_dir):
    frames_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "frames"))
if os.path.isdir(frames_dir):
    app.mount("/frames", StaticFiles(directory=frames_dir), name="frames")

# Mount mediapipe
mediapipe_dir = os.path.join(FRONTEND_DIST, "mediapipe")
if not os.path.isdir(mediapipe_dir):
    mediapipe_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "mediapipe"))
if os.path.isdir(mediapipe_dir):
    app.mount("/mediapipe", StaticFiles(directory=mediapipe_dir), name="mediapipe")

# SPA Fallback & Client-side Routing Catch-all
@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_spa(full_path: str):
    if (
        full_path.startswith("api")
        or full_path.startswith("uploads")
        or full_path.startswith("docs")
        or full_path.startswith("openapi.json")
    ):
        raise HTTPException(status_code=404, detail="Not Found")
    file_path = os.path.join(FRONTEND_DIST, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    index_file = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "EyeReach API is running. Build frontend to view UI."}

