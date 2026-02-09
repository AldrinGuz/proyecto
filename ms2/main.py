from fastapi import FastAPI, Request
import pandas as pd
import numpy as np
import joblib
import requests

# Escaladores ya entrenados
scaler_standard = joblib.load("scalers/standarscaler.pkl")
scaler_robust = joblib.load("scalers/robustscaler.pkl")

# Columnas físicas que serán escaladas
SCALE_COLS = [
    "CO2",
    "Temperatura",
    "Humedad",
    "NumPersonas",
    "Energía",
    "Mass Concentration"
]

STANDAR_COLS = [
    "CO2",
    "Temperatura",
    "Humedad",
    "NumPersonas",
    "Energía",
    "Mass Concentration",
    "hora_sin", "hora_cos",
    "dia_sin", "dia_cos",
    "fin_de_semana",
    "mes_sin", "mes_cos",
    "dm_sin", "dm_cos"
]

ROBUST_COLS = [
    "CO2",
    "Temperatura",
    "Humedad",
    "NumPersonas",
    "Energía",
    "Mass Concentration",
    "hora_sin", "hora_cos",
    "dia_sin", "dia_cos",
    "mes_sin", "mes_cos",
    "dm_sin", "dm_cos"
]

print(scaler_robust.feature_names_in_)

app = FastAPI(title="MS2 - Preprocesador de datos")

@app.post("/preprocess")
async def preprocess_data(request: Request):
    payload = await request.json()

    df_raw = payload_to_dataframe(payload)
    df_features = build_feature_dataframe(df_raw)
    df_15 = resample_15min(df_features)
    df_time = add_time_features(df_15)
    df_final = add_cyclic_features(df_time)

    df_final = df_final.reindex(columns=STANDAR_COLS)

    df_standard = df_final.copy()
    df_standard[STANDAR_COLS] = scaler_standard.transform(df_standard[STANDAR_COLS])

    df_robust = df_final.copy()
    df_robust[ROBUST_COLS] = scaler_robust.transform(df_robust[ROBUST_COLS])

    print("\n========== DATAFRAME FINAL ==========")
    print("STANDARD SCALER:")
    print(df_standard.head())
    print("ROBUST SCALER:")
    print(df_robust.head())
    print("=====================================\n")

    #Retornamos los datos escalados
    # Convertimos DataFrame
    data_to_send = {
        "standard": dataframe_to_json_records(df_standard),
        "robust": dataframe_to_json_records(df_robust)
    }

    response = requests.post(
        "http://localhost:8004/aggregate",
        json=data_to_send
    )

    return response.json()

# ---------------- Funciones auxiliares ----------------

def payload_to_dataframe(payload):
    rows = []
    for group in payload:
        for item in group:
            rows.append({
                "time": pd.to_datetime(item["time"]),
                "value": item["value"],
                "name": item["name"]
            })
    return pd.DataFrame(rows)

def build_feature_dataframe(df):
    features = {}

    # Conexiones → NumPersonas
    conexiones = df[df["name"] == "conexiones"]
    if not conexiones.empty:
        features["NumPersonas"] = conexiones.groupby("time")["value"].sum()

    # Electricidad
    energia = df[df["name"] == "15m"]
    if not energia.empty:
        features["Energía"] = energia.groupby("time")["value"].sum()

    # Sensores directos
    mapping = {
        "CO2": "CO2",
        "Temperature": "Temperatura",
        "Humidity": "Humedad",
        "VocIndex": "Mass Concentration"
    }
    for raw, col in mapping.items():
        temp = df[df["name"] == raw]
        if not temp.empty:
            features[col] = temp.set_index("time")["value"]

    final_df = pd.DataFrame(features)
    final_df.sort_index(inplace=True)
    return final_df

def resample_15min(df):
    df_15 = df.resample("15min").agg({
        "CO2": "mean",
        "Temperatura": "mean",
        "Humedad": "mean",
        "Mass Concentration": "mean",
        "NumPersonas": "sum",
        "Energía": "sum"
    })
    df_15 = df_15.interpolate(method="time").bfill().ffill()
    return df_15

def add_time_features(df):
    df = df.copy()
    df["hora"] = df.index.hour
    df["dia_semana"] = df.index.dayofweek
    df["fin_de_semana"] = (df["dia_semana"] >= 5).astype(int)
    df["mes"] = df.index.month
    df["dia_mes"] = df.index.day
    return df

def add_cyclic_features(df):
    df = df.copy()
    df["hora_sin"] = np.sin(2 * np.pi * df["hora"] / 24)
    df["hora_cos"] = np.cos(2 * np.pi * df["hora"] / 24)
    df["dia_sin"] = np.sin(2 * np.pi * df["dia_semana"] / 7)
    df["dia_cos"] = np.cos(2 * np.pi * df["dia_semana"] / 7)
    df["mes_sin"] = np.sin(2 * np.pi * (df["mes"] - 1) / 12)
    df["mes_cos"] = np.cos(2 * np.pi * (df["mes"] - 1) / 12)
    df["dm_sin"] = np.sin(2 * np.pi * (df["dia_mes"] - 1) / 31)
    df["dm_cos"] = np.cos(2 * np.pi * (df["dia_mes"] - 1) / 31)
    df.drop(columns=["hora", "dia_semana", "mes", "dia_mes"], inplace=True)
    return df

def dataframe_to_json_records(df: pd.DataFrame):
    df_out = df.copy()
    df_out = df_out.reset_index()
    df_out["time"] = df_out["time"].astype(str)
    return df_out.to_dict(orient="records")
