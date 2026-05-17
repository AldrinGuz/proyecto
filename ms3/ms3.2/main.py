from fastapi import FastAPI, Request, HTTPException
import pandas as pd
import numpy as np
import joblib
import json
from collections import deque

app = FastAPI(title="MS3.2 - Isolation Forest (Detección de Anomalías)")

# Parámetros y Rutas
MODEL_PATH = "models/modelo_isolation_forest.pkl"
UMBRALES_PATH = "umbrales_anomalia.json"
WINDOW_SIZE = 96 * 3  # Ventana de 3 días (96 muestras/día * 3)
K_IF = 3              # Multiplicador para el umbral dinámico

# Estado en memoria para el umbral dinámico
scores_history = deque(maxlen=WINDOW_SIZE)

# Carga del modelo y umbral inicial
try:
    model = joblib.load(MODEL_PATH)
    print(f"✅ Modelo Isolation Forest cargado correctamente.")
except Exception as e:
    print(f"❌ Error cargando modelo: {e}")

try:
    with open(UMBRALES_PATH, "r") as f:
        umbrales = json.load(f)
        DEFAULT_THRESHOLD = umbrales.get("umbral_isolation_forest", -0.1)
        print(f"✅ Umbral base cargado: {DEFAULT_THRESHOLD}")
except Exception:
    DEFAULT_THRESHOLD = -0.1 # Valor de seguridad

@app.post("/predict")
async def predict(request: Request):
    """
    Recibe los datos escalados del MS2 y calcula el score de anomalía.
    Implementa el umbral dinámico restando K*STD a la media móvil de los scores.
    """
    try:
        body = await request.json()
        data_list = body.get("data", [])
        
        if not data_list:
            raise HTTPException(status_code=400, detail="No se recibieron datos.")

        # 1. Convertir a DataFrame y limpiar
        df = pd.DataFrame(data_list)
        if "timestamp_rango" in df.columns:
            df = df.drop(columns=["timestamp_rango"])
        
        # 2. Obtener scores (Isolation Forest devuelve score por fila)
        # Tomamos solo la última fila (el instante actual T)
        current_sample = df.values[-1:] 
        score_if = model.decision_function(current_sample)[0]

        # 3. Lógica de Umbral Dinámico (Kaggle Style)
        scores_history.append(score_if)
        
        if len(scores_history) > 10:
            moving_avg = np.mean(scores_history)
            moving_std = np.std(scores_history)
            # En IF, menos es más anomalía, por eso restamos
            umbral_dinamico = moving_avg - (K_IF * moving_std)
        else:
            umbral_dinamico = DEFAULT_THRESHOLD

        # 4. Detección
        # Es anomalía si el score es MENOR que el umbral
        is_anomaly = 1 if score_if < umbral_dinamico else 0

        return {
            "model": "isolation_forest",
            "is_anomaly": int(is_anomaly),
            "score": float(score_if),
            "threshold": float(umbral_dinamico),
            "status": "success"
        }

    except Exception as e:
        print(f"Error en predicción IF: {e}")
        return {"is_anomaly": 0, "error": str(e)}

@app.get("/health")
async def health():
    return {
        "status": "online",
        "history_count": len(scores_history),
        "current_threshold": float(np.mean(scores_history) - K_IF * np.std(scores_history)) if len(scores_history) > 0 else DEFAULT_THRESHOLD
    }
