import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load MediaPipe and ML models here ONCE
    logger.info("Starting up SmartFrame AI...")
    logger.info("Initializing models (Placeholder)")
    yield
    # Shutdown: Clean up resources here
    logger.info("Shutting down SmartFrame AI...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # Allow Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .routers import phase1, phase2, recommendations

app.include_router(phase1.router)
app.include_router(phase2.router)
app.include_router(recommendations.router)

@app.get("/health", summary="Health Check")
async def health_check():
    """
    Basic health check API to verify service is running.
    """
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME
    }
