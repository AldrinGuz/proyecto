from fastapi import FastAPI
import httpx
import asyncio

app = FastAPI(title="MS4 - Orquestador Asíncrono")

MS3_URLS = {
    "ocsvm": "http://ms3_ocsvm:8001/predict",
    "isoforest": "http://ms3_iforest:8002/predict",
    "autoencoder": "http://ms3_autoencoder:8003/predict"
}

# Memoria del último resultado
last_status = {
    "sensors": None,
    "models": None,
    "final": None
}

async def fetch_prediction(client, model_name, url, payload):
    """ Función asíncrona para hacer la petición HTTP sin bloquear el servidor """
    try:
        response = await client.post(url, json=payload, timeout=80.0)
        response.raise_for_status()
        return model_name, response.json()["prediction"]
    except Exception as e:
        print(f"Error en {model_name}: {e}")
        return model_name, 0 # En caso de caída de un modelo, asume 0 para no frenar la app

@app.post("/aggregate")
async def aggregate_predictions(request: dict):
    raw = request.get("raw", [])
    robust = request.get("robust", [])

    if not robust:
        return {"error": "No data received"}

    # Llamada en PARALELO a los 3 microservicios
    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_prediction(client, "ocsvm", MS3_URLS["ocsvm"], robust),
            fetch_prediction(client, "isoforest", MS3_URLS["isoforest"], robust),
            fetch_prediction(client, "autoencoder", MS3_URLS["autoencoder"], robust)
        ]
        
        # Esperamos a que los 3 terminen simultáneamente
        resultados = await asyncio.gather(*tasks)
        
    # Convertimos la lista de tuplas en un diccionario
    votos = dict(resultados)

    vote_count = (
        votos.get("ocsvm", 0) +
        votos.get("isoforest", 0) +
        votos.get("autoencoder", 0)
    )

    final = 1 if vote_count >= 2 else 0

    global last_status
    last_status = {
        # Guardamos solo el último registro crudo para el Frontend
        "sensors": raw[-1] if raw else None,
        "models": votos,
        "final": final
    }

    return {"message": "Predicción actualizada", "status": last_status}
    
@app.get("/status")
async def get_status():
    return last_status