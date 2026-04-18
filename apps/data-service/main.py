from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import factors, prices

app = FastAPI(title="PortOpt Data Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prices.router, tags=["prices"])
app.include_router(factors.router, tags=["factors"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
