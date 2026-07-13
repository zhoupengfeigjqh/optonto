"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import (
    scenarios_router,
    ontologies_router,
    concepts_router,
    relations_router,
    behaviors_router,
    rules_router,
    events_router,
    files_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    await init_db()
    yield


app = FastAPI(
    title="OPTONTO 本体开发平台",
    description="本体开发平台后端 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS – allow frontend dev servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(scenarios_router)
app.include_router(ontologies_router)
app.include_router(concepts_router)
app.include_router(relations_router)
app.include_router(behaviors_router)
app.include_router(rules_router)
app.include_router(events_router)
app.include_router(files_router)


@app.get("/")
async def root():
    return {"message": "OPTONTO API is running"}


@app.get("/health")
async def health():
    return {"status": "ok"}
