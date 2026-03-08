from fastapi import FastAPI, Request
import pandas as pd
from tensorflow.keras.models import load_model
import numpy as np

# Cargar modelo
model = load_model("autoencoder_tf.keras", compile=False)

THRESHOLD = 0.03

app = FastAPI(title="MS3 - Autoencoder")

@app.post("/predict")
async def predict(request: Request):
    payload = await request.json()
    df = pd.DataFrame(payload)
    df = df.astype(float)

    reconstructions = model.predict(df)
    mse = np.mean(np.power(df - reconstructions, 2), axis=1)

    preds = [1 if e > THRESHOLD else 0 for e in mse]

    return {"predictions": preds}

