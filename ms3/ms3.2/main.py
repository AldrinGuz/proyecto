from fastapi import FastAPI, Request
import pandas as pd
import joblib
import numpy as np
import json

model = joblib.load("modelo_isolation_forest.pkl") 

# CRÍTICO: Cargar el umbral calculado (si existiese) para unificar la arquitectura
try:
    with open("umbrales_anomalia.json", "r") as f:
        umbrales = json.load(f)
        # Asumimos que tienes una clave para el isolation forest, por ejemplo:
        THRESHOLD = umbrales["umbral_isolation_forest"]
        print(f"✅ Umbral Isolation Forest cargado correctamente: {THRESHOLD}")
except Exception as e:
    print(f"⚠️ Error cargando umbrales, usando valor por defecto. Error: {e}")
    THRESHOLD = 0

app = FastAPI(title="MS3 - Isolation Forest")

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
    df_actual = df.iloc[[-1]].copy()

    # EL ESCUDO DEFINITIVO: Obligamos a Pandas a usar el orden exacto del entrenamiento
    if hasattr(model, 'feature_names_in_'):
        try:
            df_actual = df_actual[model.feature_names_in_]
        except KeyError as e:
            print(f"❌ Error: El modelo requiere columnas que MS2 no envió. {e}")
            return {"prediction": 0}

    # Predecir (-1 = anomalía, 1 = normal)
    score = model.decision_function(df_actual)[0]
    es_anomalia = 1 if float(score) < float(THRESHOLD) else 0

    return {"prediction": es_anomalia}