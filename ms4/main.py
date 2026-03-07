from fastapi import FastAPI, Request
import requests

MS3_URLS = {
    "ocsvm": "http://ms3_ocsvm:8001/predict",
    "isoforest": "http://ms3_iforest:8002/predict",
    "autoencoder": "http://ms3_autoencoder:8003/predict"
}

app = FastAPI(title="Orquestador de Anomalías")

@app.post("/aggregate")
async def aggregate_predictions(request: dict):
    raw = request["raw"]
    standard = request["standard"]
    robust = request["robust"]

    ocsvm = requests.post(
        MS3_URLS["ocsvm"],
        json=standard
    ).json()

    isoforest = requests.post(
        MS3_URLS["isoforest"],
        json=robust
    ).json()

    autoencoder = requests.post(
        MS3_URLS["autoencoder"],
        json=standard
    ).json()

    votes = (
            ocsvm["predictions"][0]
            + isoforest["predictions"][0]
            + autoencoder["predictions"][0]
        )
    final = 1 if vote >= 2 else 0

    return {
        "sensors": raw,
        "ocsvm": ocsvm,
        "isoforest": isoforest,
        "autoencoder": autoencoder,
        "final": final
    }