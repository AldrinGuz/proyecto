from fastapi import FastAPI, HTTPException
from app.inferencia import ini_inferencia

app = FastAPI(title="MS3 - Inferencia")

@app.post("/infer")
def infer(payload: dict):
    try:
        results = ini_inferencia(payload)
        return results
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
