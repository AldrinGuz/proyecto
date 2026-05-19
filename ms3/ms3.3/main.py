from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import numpy as np
import tensorflow as tf
from collections import deque
import os

app = FastAPI(title="MS3.3 - LSTM Autoencoder (Adaptativo 30 Col)")

# Configuración de rutas y parámetros
MODEL_PATH = "modelos/modelo_autoencoder_lstm.keras"
TIME_STEPS = 4  # Ventana temporal de Kaggle
K_FACTOR = 3    # Multiplicador para el umbral dinámico
WINDOW_SIZE = 96 * 3 

# Estado persistente para el umbral dinámico
mse_history = deque(maxlen=WINDOW_SIZE)

# Cargar el modelo entrenado
try:
    model = tf.keras.models.load_model(MODEL_PATH)
    print(f"✅ LSTM Autoencoder (30 cols) cargado correctamente.")
except Exception as e:
    print(f"❌ Error crítico cargando modelo: {e}")

class PredictRequest(BaseModel):
    data: list # Recibe las 5 filas escaladas (46 columnas) del MS2/MS4

def preparar_datos_autoencoder(data_list, time_steps):
    """
    Filtra las columnas para eliminar las variables '_diff' 
    y ajusta la forma a la secuencia LSTM [1, 4, 30].
    """
    df = pd.DataFrame(data_list)
    if "timestamp_rango" in df.columns:
        df = df.drop(columns=["timestamp_rango"])
    
    # --- FILTRADO CRÍTICO ---
    # Eliminamos las columnas que contienen '_diff' para volver a las 30 originales
    cols_to_keep = [c for c in df.columns if "_diff" not in c]
    df_filtered = df[cols_to_keep]
    
    # Verificación de seguridad
    if df_filtered.shape[1] != 30:
        print(f"⚠️ Advertencia: Se esperaban 30 columnas, se obtuvieron {df_filtered.shape[1]}")
    
    # Tomamos los últimos 'time_steps' (4 filas)
    sequence = df_filtered.values[-time_steps:]
    
    # [Batch, TimeSteps, Features] -> [1, 4, 30]
    return np.expand_dims(sequence, axis=0), df_filtered.columns.tolist()

@app.post("/predict")
async def predict(request: PredictRequest):
    try:
        # 1. Filtrar y preparar secuencia 3D [1, 4, 30]
        X_input, column_names = preparar_datos_autoencoder(request.data, TIME_STEPS)
        
        # 2. Predicción
        X_pred = model.predict(X_input, verbose=0)

        # 3. Cálculo del Error (MSE) sobre la secuencia 3D
        mse_instantaneo = np.mean(np.power(X_input - X_pred, 2))

        # 4. Umbral Dinámico
        mse_history.append(mse_instantaneo)
        if len(mse_history) > 10:
            moving_avg = np.mean(mse_history)
            moving_std = np.std(mse_history)
            umbral_dinamico = moving_avg + (K_FACTOR * moving_std)
        else:
            umbral_dinamico = 0.1 # Valor de arranque

        is_anomaly = 1 if mse_instantaneo > umbral_dinamico else 0

        # 5. AISLAMIENTO DE COMPORTAMIENTO (Sobre las 30 variables base)
        # Comparamos el último paso de tiempo [-1]
        errores_por_variable = np.abs(X_input[0, -1, :] - X_pred[0, -1, :])
        
        feature_errors = {column_names[i]: float(errores_por_variable[i]) for i in range(len(column_names))}
        top_culpables = dict(sorted(feature_errors.items(), key=lambda item: item[1], reverse=True)[:5])
        culpable_principal = list(top_culpables.keys())[0]

        return {
            "model": "lstm_autoencoder",
            "is_anomaly": int(is_anomaly),
            "mse": float(mse_instantaneo),
            "threshold": float(umbral_dinamico),
            "culpable_principal": culpable_principal,
            "feature_errors": top_culpables,
            "features_processed": len(column_names), # Confirmación de que son 30
            "status": "success"
        }

    except Exception as e:
        print(f"Error en predicción Autoencoder: {e}")
        return {"is_anomaly": 0, "error": str(e)}