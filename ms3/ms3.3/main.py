import os
# Apagamos los avisos en rojo de TensorFlow
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

from fastapi import FastAPI, Request
import pandas as pd
from tensorflow.keras.models import load_model
import numpy as np
import json

model = load_model("modelo_autoencoder_lstm.keras", compile=False)

try:
    with open("umbrales_anomalia.json", "r") as f:
        umbrales = json.load(f)
        THRESHOLD = umbrales["umbral_autoencoder"]
except Exception as e:
    THRESHOLD = 13000.0 

TIME_STEPS = 4 

app = FastAPI(title="MS3 - Autoencoder LSTM")

@app.post("/predict")
async def predict(request: Request):
    payload = await request.json()
    df = pd.DataFrame(payload)
    
    if df.empty:
        return {"prediction": 0}
        
    for col in ["time", "index", "timestamp"]:
        if col in df.columns:
            df = df.set_index(col)
            
    df = df.astype(float)

    if len(df) < TIME_STEPS:
        return {"prediction": 0}

    secuencia_actual = df.values[-TIME_STEPS:] 
    secuencia_3d = np.array([secuencia_actual])

    reconstruccion = model.predict(secuencia_3d, verbose=0)
    mse = np.mean(np.power(secuencia_3d - reconstruccion, 2), axis=(1, 2))[0]

    es_anomalia = 1 if float(mse) > float(THRESHOLD) else 0

    return {"prediction": es_anomalia, "mse_calculado": float(mse)}