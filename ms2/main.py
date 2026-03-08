from fastapi import FastAPI, Request
import pandas as pd
import numpy as np
import joblib
import requests

# Escaladores ya entrenados
scaler_standard = joblib.load("scalers/standarscaler.pkl")
scaler_robust = joblib.load("scalers/robustscaler.pkl")

# Columnas físicas que serán escaladas
SCALERS_COLS = [
    "CO2",
    "Temp",
    "Humedad",
    "NumPers",
    "Energía",
    "VOC"
]

app = FastAPI(title="MS2 - Preprocesador de datos")

@app.post("/preprocess")
async def preprocess_data(request: Request):
    payload = await request.json()

    dfs = payload_to_dataframe(payload)

    df_co2 = preprocesar(dfs["CO2"], "CO2")
    df_temp = preprocesar(dfs["Temperature"], "Temp")
    df_hum = preprocesar(dfs["Humidity"], "Humedad")
    df_voc = preprocesar(dfs["VocIndex"], "VOC")
    df_ene = preprocesar(dfs["15m"], "Energía", "sum", "sum")
    df_con = preprocesar(dfs["conexiones"], "NumPers", "sum", "mean")

    df_final = pd.concat(
        [df_temp, df_hum, df_co2, df_voc, df_ene, df_con],
        axis=1
    )

    df_final = delete_NaN(df_final)
    df_final = add_time_features(df_final)
    df_final = add_cyclic_features(df_final)

    df_standard = df_final.copy()
    df_standard[SCALERS_COLS] = scaler_standard.transform(df_standard[SCALERS_COLS])

    df_robust = df_final.copy()
    df_robust[SCALERS_COLS] = scaler_robust.transform(df_robust[SCALERS_COLS])

    print("\n========== DATAFRAME FINAL ==========")
    print("STANDARD SCALER:")
    print(df_standard.head())
    print("ROBUST SCALER:")
    print(df_robust.head())
    print("=====================================\n")

    #Retornamos los datos escalados
    # Convertimos DataFrame
    data_to_send = {
        "raw": dataframe_to_json_records(df_final),
        "standard": dataframe_to_json_records(df_standard),
        "robust": dataframe_to_json_records(df_robust)
    }

    response = requests.post(
        "http://ms4:8004/aggregate",
        json=data_to_send
    )

    return response.json()

# ---------------- Funciones auxiliares ----------------
def preprocesar(df, variable, unify="mean", agg="mean"):

    df = df[["time", "value"]].copy()
    df = df.rename(columns={"time": "timestamp", "value": variable})

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df[variable] = pd.to_numeric(df[variable], errors="coerce")

    # Eliminar nulos
    df = df.dropna(subset=["timestamp", variable])

    # Normalizar precisión temporal (evita microsegundos distintos)
    df["timestamp"] = df["timestamp"].dt.floor("min")

    # Unificar sensores en mismo instante
    if unify == "sum":
        df = df.groupby("timestamp", as_index=False)[variable].sum()
    elif unify == "mean":
        df = df.groupby("timestamp", as_index=False)[variable].mean()
    else:
        raise ValueError("unify debe ser 'mean' o 'sum'")

    df = df.set_index("timestamp").sort_index()

    # Agregación en ventanas de 15 minutos
    if agg == "mean":
        df = df.resample("15min").mean()
    elif agg == "sum":
        df = df.resample("15min").sum()
    else:
        raise ValueError("agg debe ser 'mean' o 'sum'")

    return df

def payload_to_dataframe(payload):
    rows = []

    for group in payload:
        for item in group:
            rows.append({
                "time": item["time"],
                "value": item["value"],
                "name": item["name"]
            })

    df = pd.DataFrame(rows)

    return {
        name: df[df["name"] == name].copy()
        for name in df["name"].unique()
    }

def delete_NaN(df):
    df_clean = df.copy()
    df_clean = df_clean[df_clean.isna().mean(axis=1) <= 0.3]
    df_clean["NumPers"] = df_clean["NumPers"].interpolate(method="time",limit=5)
    df_clean = df_clean.dropna()
    return df_clean

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
    df_out = df_out.drop(columns=["timestamp"])
    return df_out.to_dict(orient="records")

"""
def safe_get(dfs, key):
    if key not in dfs:
        raise ValueError(f"Falta sensor {key} en payload")
    return dfs[key]
"""