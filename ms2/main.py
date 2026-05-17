from fastapi import FastAPI, Request, HTTPException
import pandas as pd
import numpy as np
import joblib
import requests

app = FastAPI(title="MS2 - Preprocesador de datos Kunna")

# Configuración de rutas
SCALER_PATH = "scalers/standard_scaler.pkl"
MS4_URL = "http://ms4:8004/aggregate"

# Cargar el scaler al iniciar para mayor eficiencia
try:
    scaler = joblib.load(SCALER_PATH)
    print("Scaler cargado correctamente.")
except Exception as e:
    print(f"Error cargando scaler desde {SCALER_PATH}: {e}")

# ORDEN EXACTO DE COLUMNAS SEGÚN KAGGLE (46 columnas)
COLUMNS_ORDER = [
    'co2_sensor-voc-1', 'co2_sensor-voc-2', 'co2_sensor-voc-3', 'co2_sensor-voc-4',
    'hum_sensor-voc-1', 'hum_sensor-voc-2', 'hum_sensor-voc-3', 'hum_sensor-voc-4',
    'par_sensor-voc-1', 'par_sensor-voc-2', 'par_sensor-voc-3', 'par_sensor-voc-4',
    'tem_sensor-voc-1', 'tem_sensor-voc-2', 'tem_sensor-voc-3', 'tem_sensor-voc-4',
    'total_alumnos', 'elec_aa_1', 'elec_aa_2', 'elec_servicios', 'elec_general',
    'fin_de_semana', 'hora_sin', 'hora_cos', 'dia_sin', 'dia_cos', 'mes_sin', 'mes_cos', 'dm_sin', 'dm_cos',
    'co2_sensor-voc-1_diff', 'co2_sensor-voc-2_diff', 'co2_sensor-voc-3_diff', 'co2_sensor-voc-4_diff',
    'hum_sensor-voc-1_diff', 'hum_sensor-voc-2_diff', 'hum_sensor-voc-3_diff', 'hum_sensor-voc-4_diff',
    'par_sensor-voc-1_diff', 'par_sensor-voc-2_diff', 'par_sensor-voc-3_diff', 'par_sensor-voc-4_diff',
    'tem_sensor-voc-1_diff', 'tem_sensor-voc-2_diff', 'tem_sensor-voc-3_diff', 'tem_sensor-voc-4_diff'
]

# Mapeo de nombres de sensores del MS1 a los nombres del dataset de entrenamiento
MAPEO_SENSORES = {
    # Eléctricos (IDs de Kunna a nombres amigables del dataset)
    'elec_6339579': 'elec_aa_1',
    'elec_6339651': 'elec_aa_2',
    'elec_9688827': 'elec_servicios',
    'elec_6339566': 'elec_general',
    # Los de clima ya vienen con el formato co2_sensor-voc-X, solo cambiamos voc por par
}

def add_time_cyclic_features(df):
    df_final = df.copy()
    # Asegurarnos que el index es Datetime
    df_final.index = pd.to_datetime(df_final.index)
    
    df_final["hora"] = df_final.index.hour
    df_final["dia_semana"] = df_final.index.dayofweek
    df_final["fin_de_semana"] = df_final["dia_semana"].isin([5, 6]).astype(int)
    df_final["mes"] = df_final.index.month
    df_final["dia_mes"] = df_final.index.day

    df_final["hora_sin"] = np.sin(2 * np.pi * df_final["hora"] / 24)
    df_final["hora_cos"] = np.cos(2 * np.pi * df_final["hora"] / 24)
    df_final["dia_sin"] = np.sin(2 * np.pi * df_final["dia_semana"] / 7)
    df_final["dia_cos"] = np.cos(2 * np.pi * df_final["dia_semana"] / 7)
    df_final["mes_sin"] = np.sin(2 * np.pi * df_final["mes"] / 12)
    df_final["mes_cos"] = np.cos(2 * np.pi * df_final["mes"] / 12)
    
    # dm (day of year)
    df_final["dm"] = df_final.index.dayofyear
    df_final["dm_sin"] = np.sin(2 * np.pi * df_final["dm"] / 365)
    df_final["dm_cos"] = np.cos(2 * np.pi * df_final["dm"] / 365)

    df_final = df_final.drop(columns=['hora','dia_semana','mes','dm','dia_mes'])
    return df_final

@app.post("/preprocess")
async def preprocess_data(request: Request):
    try:
        body = await request.json()
        payload_ms1 = body.get("payloadParaMS2", [])
        alertas = body.get("alertas", [])

        if not payload_ms1:
            raise HTTPException(status_code=400, detail="No data found in payloadParaMS2")

        # 1. Crear DataFrame desde la lista de 5 ventanas
        df = pd.DataFrame(payload_ms1)
        df.set_index("timestamp_rango", inplace=True)
        
        # 2. Renombrar columnas para que coincidan con Kaggle (VocIndex -> par, elec IDs -> nombres)
        # Cambiamos voc_ por par_ (asumiendo que en Kaggle usaste 'par' para partículas/voc)
        df.columns = [c.replace('voc_', 'par_') for c in df.columns]
        df.rename(columns=MAPEO_SENSORES, inplace=True)

        # 3. Añadir variables cíclicas
        df_features = add_time_cyclic_features(df)

        # 4. Añadir columnas _diff
        # Seleccionamos sensores excluyendo las columnas cíclicas y binarias
        columnas_sensores = [c for c in df_features.columns if any(x in c for x in ['co2', 'tem', 'hum', 'par'])]
        
        for col in columnas_sensores:
            df_features[f'{col}_diff'] = df_features[col].diff()

        # Rellenar el primer NaN del diff con 0 (como en Kaggle)
        df_features.fillna(0, inplace=True)

        # 5. Asegurar el orden de las columnas y que existan todas (46 en total)
        # Si falta alguna columna por desincronización, la creamos con 0
        for col in COLUMNS_ORDER:
            if col not in df_features.columns:
                df_features[col] = 0.0

        df_ordered = df_features[COLUMNS_ORDER]

        # 6. Escalado (StandardScaler)
        # scaler.transform espera un array 2D
        data_scaled = scaler.transform(df_ordered)
        df_scaled = pd.DataFrame(data_scaled, columns=COLUMNS_ORDER, index=df_ordered.index)

        # 7. Preparar envío al Orquestador
        # Enviamos los datos escalados, los reales (df_ordered) y las alertas
        result = {
            "datos_escalados": df_scaled.reset_index().to_dict(orient="records"),
            "datos_reales": df_ordered.reset_index().to_dict(orient="records"),
            "alertas_hardware": alertas
        }

        # 8. Envío automático al Orquestador (MS4)
        try:
            response = requests.post(MS4_URL, json=result, timeout=10)
            return {
                "status": "success", 
                "ms4_response": response.json(),
                "data_summary": "Procesado y enviado correctamente"
            }
        except Exception as e:
            return {
                "status": "error", 
                "message": f"Fallo al enviar a MS4: {str(e)}",
                "processed_data_preview": result["datos_reales"][-1] # Enviamos preview para debug
            }

    except Exception as e:
        print(f"Error en preprocesamiento: {e}")
        raise HTTPException(status_code=500, detail=str(e))