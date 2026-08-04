"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    scenarios_router,
    ontologies_router,
    concepts_router,
    relations_router,
    behaviors_router,
    rules_router,
    events_router,
    processes_router,
    securities_router,
    functions_router,
    files_router,
    threads_router,
    chat_router,
    data_engines_router,
    mcp_ctl_router,
    rule_templates_router,
    common_functions_router,
    skills_router,
    db_schema_router,
)


app = FastAPI(
    title="OPTONTO 本体开发平台",
    description="本体开发平台后端 API",
    version="1.0.0",
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
app.include_router(processes_router)
app.include_router(securities_router)
app.include_router(functions_router)
app.include_router(mcp_ctl_router)
app.include_router(files_router)
app.include_router(threads_router)
app.include_router(chat_router)
app.include_router(data_engines_router)
app.include_router(rule_templates_router)
app.include_router(common_functions_router)
app.include_router(skills_router)
app.include_router(db_schema_router)


@app.get("/")
async def root():
    return {"message": "OPTONTO API is running"}


@app.get("/health")
async def health():
    return {"status": "ok"}
