from fastapi import FastAPI, Request, HTTPException
import pandas as pd
import numpy as np
import joblib
import json
from collections import deque

app = FastAPI(title="MS3.1 - One-Class SVM (Detección de Fronteras)")

# Parámetros y Rutas
MODEL_PATH = "models/modelo_one_class_svm.pkl"
UMBRALES_PATH = "umbrales_anomalia.json"
WINDOW_SIZE = 96 * 3  # Ventana de 3 días para coherencia con el sistema
K_OCSVM = 3           # Factor multiplicador para el umbral dinámico

# Estado en memoria para el umbral dinámico (Z-Score adaptativo)
scores_history = deque(maxlen=WINDOW_SIZE)

# Carga del modelo entrenado en Kaggle
try:
    model = joblib.load(MODEL_PATH)
    print(f"✅ Modelo One-Class SVM cargado correctamente.")
except Exception as e:
    print(f"❌ Error crítico cargando modelo OCSVM: {e}")

# Carga opcional de umbrales estáticos definidos previamente
try:
    with open(UMBRALES_PATH, "r") as f:
        umbrales = json.load(f)
        DEFAULT_THRESHOLD = umbrales.get("umbral_ocsvm", -10.0) 
        print(f"✅ Umbral base OCSVM cargado: {DEFAULT_THRESHOLD}")
except Exception:
    DEFAULT_THRESHOLD = -10.0 # Valor por defecto si no existe el archivo

@app.post("/predict")
async def predict(request: Request):
    """
    Recibe los datos escalados del MS2.
    Utiliza score_samples para obtener la densidad logarítmica y aplica umbral dinámico.
    """
    try:
        body = await request.json()
        data_list = body.get("data", [])
        
        if not data_list:
            raise HTTPException(status_code=400, detail="No se recibieron datos.")

        # 1. Convertir datos a DataFrame
        df = pd.DataFrame(data_list)
        if "timestamp_rango" in df.columns:
            df = df.drop(columns=["timestamp_rango"])
        
        # 2. Obtener score del instante actual (última fila)
        # OCSVM.score_samples devuelve el logaritmo de la densidad
        current_sample = df.values[-1:] 
        score_val = model.score_samples(current_sample)[0]

        # 3. Lógica de Umbral Dinámico (Estilo Kaggle)
        scores_history.append(score_val)
        
        if len(scores_history) > 10:
            moving_avg = np.mean(scores_history)
            moving_std = np.std(scores_history)
            # Al igual que en IF, valores bajos son anomalías
            umbral_dinamico = moving_avg - (K_OCSVM * moving_std)
        else:
            umbral_dinamico = DEFAULT_THRESHOLD

        # 4. Clasificación final
        # 1 si es anomalía (por debajo del umbral dinámico), 0 si es normal
        is_anomaly = 1 if score_val < umbral_dinamico else 0

        return {
            "model": "ocsvm",
            "is_anomaly": int(is_anomaly),
            "score": float(score_val),
            "threshold": float(umbral_dinamico),
            "status": "success"
        }

    except Exception as e:
        print(f"Error en predicción OCSVM: {e}")
        return {"is_anomaly": 0, "error": str(e)}

@app.get("/health")
async def health():
    return {
        "status": "online",
        "history_count": len(scores_history),
        "current_threshold": float(np.mean(scores_history) - K_OCSVM * np.std(scores_history)) if len(scores_history) > 0 else DEFAULT_THRESHOLD
    }