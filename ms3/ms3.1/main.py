from fastapi import FastAPI, Request
import pandas as pd
import joblib
import numpy as np

model = joblib.load("modelo_one_class_svm.pkl") 

app = FastAPI(title="MS3 - One Class SVM")

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

    pred = model.predict(df_actual)[0]
    es_anomalia = 1 if pred == -1 else 0

    return {"prediction": es_anomalia}