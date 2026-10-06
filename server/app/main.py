"""Development API. Authentication and proof verification are not implemented."""

from fastapi import FastAPI, Response
from pydantic import BaseModel

app = FastAPI(
    title="ISL Face Authentication API",
    description="Development foundation for a privacy-preserving verification server.",
    version="0.1.0",
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health(response: Response) -> HealthResponse:
    """Report API availability only; this does not authenticate a user."""
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse(status="ok", service="isl-verification-server", version=app.version)
