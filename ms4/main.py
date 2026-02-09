from fastapi import FastAPI, Request
import requests

MS3_URLS = {
    "ocsvm": "http://localhost:8001/predict",
    "isoforest": "http://localhost:8002/predict",
    "autoencoder": "http://localhost:8003/predict"
}

app = FastAPI(title="Orquestador de Anomalías")

@app.post("/aggregate")
async def aggregate_predictions(request: dict):
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

    final = []
    votes = (
            ocsvm["predictions"][i]
            + isoforest["predictions"][i]
            + autoencoder["predictions"][i]
        )
    final.append(1 if votes >= 2 else 0)

    return {
        "ocsvm": ocsvm,
        "isoforest": isoforest,
        "autoencoder": autoencoder
    }