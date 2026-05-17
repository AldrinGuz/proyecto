from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
import httpx
import pandas as pd
import numpy as np

app = FastAPI(title="MS4 - Orquestador de Consenso e Inteligencia")

# URLs de los modelos (Microservicios 3.x)
MS3_URLS = {
    "ocsvm": "http://ms3_ocsvm:8001/predict",
    "isoforest": "http://ms3_iforest:8002/predict",
    "autoencoder": "http://ms3_autoencoder:8003/predict"
}

@app.post("/aggregate")
async def aggregate_results(data: dict):
    """
    Recibe datos escalados, reales y alertas del MS2.
    Coordina la votación y el aislamiento de anomalías.
    """
    try:
        datos_escalados = data.get("datos_escalados", [])
        datos_reales = data.get("datos_reales", [])
        alertas_hw = data.get("alertas_hardware", [])

        if not datos_escalados:
            raise HTTPException(status_code=400, detail="Faltan datos escalados")

        # 1. Llamadas en paralelo a los modelos del MS3
        # Usamos asyncio para no bloquear el hilo mientras esperamos a los 3 modelos
        async with httpx.AsyncClient() as client:
            tasks = [
                client.post(MS3_URLS["ocsvm"], json={"data": datos_escalados}, timeout=100.0),
                client.post(MS3_URLS["isoforest"], json={"data": datos_escalados}, timeout=100.0),
                client.post(MS3_URLS["autoencoder"], json={"data": datos_escalados}, timeout=100.0)
            ]
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)

        # 2. Extraer resultados y manejar posibles caídas de modelos
        results = {}
        model_names = ["ocsvm", "isoforest", "autoencoder"]
        
        for name, resp in zip(model_names, responses):
            if isinstance(resp, Exception):
                results[name] = {"error": str(resp), "anomaly": 0}
            else:
                results[name] = resp.json()

        # 3. LÓGICA DE CONSENSO (Último instante de tiempo - fila 4)
        # 1 significa Anomalía, 0 significa Normal
        votos = [
            results["ocsvm"].get("is_anomaly", 0),
            results["isoforest"].get("is_anomaly", 0),
            results["autoencoder"].get("is_anomaly", 0)
        ]
        
        # Consenso: Si 2 o más modelos dicen que hay anomalía
        consenso_anomalia = 1 if sum(votos) >= 2 else 0

        # 4. AISLAMIENTO DE COMPORTAMIENTO (Inteligencia del Autoencoder)
        # Si el Autoencoder detectó anomalía, buscamos el "culpable"
        culpable = "Ninguno"
        error_por_variable = {}
        
        if results["autoencoder"].get("is_anomaly") == 1:
            # El MS3 del Autoencoder debe devolver el 'reconstruction_error' por columna
            error_por_variable = results["autoencoder"].get("feature_errors", {})
            if error_por_variable:
                # El culpable es la columna con el error de reconstrucción más alto
                culpable = max(error_por_variable, key=error_por_variable.get)

        # 5. CONSTRUCCIÓN DEL JSON INTELIGENTE
        # Este es el objeto que el Frontend usará para pintar y alertar
        final_response = {
            "timestamp": datos_reales[-1].get("timestamp_rango"),
            "consenso": {
                "hay_anomalia": bool(consenso_anomalia),
                "nivel_critico": "ALTO" if sum(votos) == 3 else "MEDIO" if sum(votos) == 2 else "BAJO",
                "votos_detalle": {
                    "ocsvm": bool(results["ocsvm"].get("is_anomaly")),
                    "isoforest": bool(results["isoforest"].get("is_anomaly")),
                    "autoencoder": bool(results["autoencoder"].get("is_anomaly"))
                }
            },
            "analisis_causa": {
                "culpable_probable": culpable,
                "error_distribucion": error_por_variable, # Top errores para el gráfico de barras
                "comentario": f"Detección basada en {culpable}" if consenso_anomalia else "Estado estable"
            },
            "datos_graficas": {
                "actuales": datos_reales[-1],
                "historico_ventana": datos_reales # Las 5 filas para las mini-gráficas
            },
            "alertas_hardware": alertas_hw
        }

        # Aquí podrías añadir la lógica de GUARDAR en base de datos si se solicita
        # p.ej: await save_to_db(final_response)

        return final_response

    except Exception as e:
        print(f"Error en Orquestador: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status")
async def health_check():
    return {"status": "online", "service": "Orchestrator"}