import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import factors, prices

app = FastAPI(title="PortOpt Data Service", version="0.1.0")

origins = [
    "http://localhost:3000",
    os.environ.get("FRONTEND_URL", ""),
]
origins = [o for o in origins if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prices.router, tags=["prices"])
app.include_router(factors.router, tags=["factors"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8888))
    uvicorn.run(app, host="0.0.0.0", port=port)
