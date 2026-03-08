from fastapi import FastAPI
import requests

app = FastAPI(title="MS4 - Orquestador")

MS3_URLS = {
    "ocsvm": "http://ms3_ocsvm:8001/predict",
    "isoforest": "http://ms3_iforest:8002/predict",
    "autoencoder": "http://ms3_autoencoder:8003/predict"
}

# memoria del último resultado
last_status = {
    "sensors": None,
    "models": None,
    "final": None
}


@app.post("/aggregate")
async def aggregate_predictions(request: dict):

    raw = request["raw"]
    standard = request["standard"]
    robust = request["robust"]

    ocsvm = requests.post(MS3_URLS["ocsvm"], json=standard).json()
    isoforest = requests.post(MS3_URLS["isoforest"], json=robust).json()
    autoencoder = requests.post(MS3_URLS["autoencoder"], json=standard).json()

    vote = (
        ocsvm["predictions"][0] +
        isoforest["predictions"][0] +
        autoencoder["predictions"][0]
    )

    final = 1 if vote >= 2 else 0

    global last_status

    last_status = {
        "sensors": raw,
        "models": {
            "ocsvm": ocsvm["predictions"][0],
            "isoforest": isoforest["predictions"][0],
            "autoencoder": autoencoder["predictions"][0]
        },
        "final": final
    }

    return {"message": "Predicción actualizada"}
    

@app.get("/status")
async def get_status():
    return last_status