from fastapi import FastAPI, HTTPException
from app.preprocesamiento import preprocess

app = FastAPI(title="MS2 - Preprocesamiento")

@app.post("/preprocess")
def preprocess(payload: dict):
    try:
        X_std, X_robust = preprocess(payload)

        return {
            "standard": X_std.tolist(),
            "robust": X_robust.tolist()
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
