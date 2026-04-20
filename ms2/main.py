from fastapi import FastAPI, Request
import pandas as pd
import numpy as np
import joblib
import requests

app = FastAPI(title="MS2 - Preprocesador de datos Kunna")

try:
    scaler_robust = joblib.load("scalers/robust_scaler.pkl")
    print("✅ Escalador RobustScaler cargado correctamente.")
except Exception as e:
    print(f"⚠️  Advertencia: No se pudo cargar el escalador. Detalle: {e}")

# CRÍTICO: El orden debe ser EXACTAMENTE idéntico al de Kaggle
COLS_TIEMPO = ['fin_de_semana', 'hora_sin', 'hora_cos', 'dia_sin', 'dia_cos', 'mes_sin', 'mes_cos', 'dm_sin', 'dm_cos']

@app.post("/preprocess")
async def preprocess_data(request: Request):
    payload = await request.json()

    dfs = payload_to_dataframe(payload)

    co2_raw = dfs.get("CO2", pd.DataFrame())
    hum_raw = dfs.get("Humidity", pd.DataFrame())
    par_raw = dfs.get("VocIndex", pd.DataFrame())
    tem_raw = dfs.get("Temperature", pd.DataFrame())
    conex_raw = dfs.get("connections", pd.DataFrame())
    
    elec_raw = pd.concat([
        dfs.get("electricityfacility", pd.DataFrame()), 
        dfs.get("generalelectricity", pd.DataFrame())
    ])

    co2_clean = procesar_sensor(co2_raw, 'co2_')
    hum_clean = procesar_sensor(hum_raw, 'hum_')
    par_clean = procesar_sensor(par_raw, 'par_')
    tem_clean = procesar_sensor(tem_raw, 'tem_')

    if not conex_raw.empty:
        conex_raw["time"] = pd.to_datetime(conex_raw["time"], utc=True, errors="coerce")
        conex_raw = conex_raw.dropna(subset=["time"]).set_index("time").sort_index()
        conex_sync = conex_raw.groupby('uid').resample('15min')['value'].mean()
        conex_total = conex_sync.groupby('time').sum()
        conex_clean = conex_total.to_frame(name="total_alumnos")
        conex_clean = conex_clean.interpolate(method='time').ffill().bfill()
    else:
        conex_clean = pd.DataFrame(columns=["total_alumnos"])

    if not elec_raw.empty:
        # CAMBIO: Ahora agrupamos usando el 'uid' (device_id) en vez del description_origin
        elec_clean = procesar_sensor(elec_raw, prefix='', group_col='uid')
        nombres_cortos = {
            "6339651": "elec_aa_1",
            "6339579": "elec_aa_2",
            "6339566": "elec_servicios",
            "9688827": "elec_general"
        }
        elec_clean = elec_clean.rename(columns=nombres_cortos)
    else:
        elec_clean = pd.DataFrame()

    df_final = pd.concat([
        co2_clean,
        hum_clean,
        par_clean,
        tem_clean,
        conex_clean,
        elec_clean
    ], axis=1)

    df_final = df_final.ffill().bfill()

    if not df_final.empty:
        df_final = add_time_cyclic_features(df_final)

        df_features = df_final.copy()
        columnas_sensores = [c for c in df_features.columns if 'co2' in c or 'tem' in c or 'hum' in c or 'par' in c]
        
        for col in columnas_sensores:
            df_features[f'{col}_diff'] = df_features[col].diff().fillna(0)

        df_robust = df_features.copy()
        
        try:
            columnas_entrenamiento = scaler_robust.feature_names_in_
            
            for col in columnas_entrenamiento:
                if col not in df_robust.columns:
                    df_robust[col] = 0.0
                    
            df_a_escalar = df_robust[columnas_entrenamiento]
            df_robust[columnas_entrenamiento] = scaler_robust.transform(df_a_escalar)

            # Reconstrucción del orden exacto
            base_sensors = [c for c in columnas_entrenamiento if not c.endswith('_diff')]
            diff_sensors = [c for c in columnas_entrenamiento if c.endswith('_diff')]
            columnas_completas = base_sensors + COLS_TIEMPO + diff_sensors
            
            for col in COLS_TIEMPO:
                if col not in df_robust.columns:
                    df_robust[col] = 0.0
                    
            df_robust = df_robust[columnas_completas]

        except Exception as e:
            print(f"Error al escalar los datos. Detalle: {e}")

    else:
        df_robust = pd.DataFrame()

    df_raw_clean = df_final.reset_index(drop=True)
    df_robust_clean = df_robust.reset_index(drop=True)
    
    for col in ["time", "index", "fecha", "timestamp"]:
        if col in df_raw_clean.columns:
            df_raw_clean = df_raw_clean.drop(columns=[col])
        if col in df_robust_clean.columns:
            df_robust_clean = df_robust_clean.drop(columns=[col])

    data_to_send = {
        "raw": df_raw_clean.to_dict(orient="records"),
        "robust": df_robust_clean.to_dict(orient="records")
    }

    try:
        response = requests.post("http://ms4:8004/aggregate", json=data_to_send, timeout=10)
        return {"status": "success", "ms4_response": response.json()}
    except Exception as e:
        return {"status": "error", "message": f"Fallo al enviar a MS4: {str(e)}"}


def procesar_sensor(df, prefix, group_col='uid'):
    if df.empty:
        return pd.DataFrame()
        
    df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")
    df = df.dropna(subset=["time"]).set_index("time").sort_index()
    
    df_sync = df.groupby(group_col).resample('15min')['value'].mean()
    df_unstacked = df_sync.unstack(level=0)
    df_clean = df_unstacked.interpolate(method='time').ffill().bfill()
    
    if prefix:
        df_clean = df_clean.add_prefix(prefix)
        
    return df_clean

def payload_to_dataframe(payload):
    rows = []
    for data in payload:
        records = []
        if "data" in data and "records" in data["data"]:
            records = data["data"]["records"]
        elif "records" in data:
            records = data["records"]
            
        for item in records:
            rows.append({
                "time": item.get("time") or item.get("timestamp"), 
                "uid": item.get("uid") or item.get("device_id"), 
                "magnitude": item.get("magnitude") or item.get("metric"), 
                "description_origin": item.get("description_origin", ""),
                "value": item.get("value")
            })

    df = pd.DataFrame(rows)
    if df.empty:
        return {}

    return { mag: df[df["magnitude"] == mag].copy() for mag in df["magnitude"].unique() }

def add_time_cyclic_features(df):
    df_final = df.copy()
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
    df_final["dm"] = df_final.index.dayofyear
    df_final["dm_sin"] = np.sin(2 * np.pi * df_final["dm"] / 365)
    df_final["dm_cos"] = np.cos(2 * np.pi * df_final["dm"] / 365)

    df_final = df_final.drop(columns=['hora','dia_semana','mes','dm','dia_mes'])
    return df_final