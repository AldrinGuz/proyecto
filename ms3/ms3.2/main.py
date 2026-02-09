from fastapi import FastAPI, Request
import pandas as pd
import joblib
import numpy as np

# Cargar modelo
model = joblib.load("isolationforest.pkl")  # cambiar según modelo

app = FastAPI(title="MS3 - IsolationForest")

@app.post("/predict")
async def predict(request: Request):
    payload = await request.json()
    df = pd.DataFrame(payload)

    if "time" in df.columns:
        df = df.drop(columns=["time"])

    # Predecir (para IsolationFores: -1 = anomalía, 1 = normal)
    preds = model.predict(df)
    preds = np.where(preds == -1, 1, 0)  # convertir a 1 = anomalía, 0 = normal

    return {"predictions": preds.tolist()}
