from fastapi import FastAPI, Request
import pandas as pd
from tensorflow.keras.models import load_model
import numpy as np

# Cargar modelo
model = load_model("autoencoder.keras", compile=False)

app = FastAPI(title="MS3 - Autoencoder")

@app.post("/predict")
async def predict(request: Request):
    payload = await request.json()
    df = pd.DataFrame(payload)

    if "time" in df.columns:
        df = df.drop(columns=["time"])

    # Predecir (para Autoencoder: -1 = anomalía, 1 = normal)
    preds = model.predict(df)

    return {"predictions": preds.tolist()}

