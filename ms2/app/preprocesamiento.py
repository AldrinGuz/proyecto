import pandas as pd
import numpy as np
import joblib

# Cargar scalers entrenados en Kaggle
SCALER_STD = joblib.load("app/scalers/scaler_standard.pkl")
SCALER_ROB = joblib.load("app/scalers/scaler_robust.pkl")

FEATURE_COLUMNS = [
    "CO2",
    "Temperatura",
    "Humedad",
    "NumPersonas",
    "Energía",
    "Mass Concentration",
    "hora_sin",
    "hora_cos",
    "dia_sin",
    "dia_cos",
    "fin_de_semana",
    "mes_sin",
    "mes_cos",
    "dm_sin",
    "dm_cos"
]

def preprocess(payload: dict):
    df = build_dataframe(payload)
    df = add_temporal_features(df)
    df = cyclic_encoding(df)
    df = df[FEATURE_COLUMNS]

    X_std = SCALER_STD.transform(df)
    X_rob = SCALER_ROB.transform(df)

    return X_std, X_rob
