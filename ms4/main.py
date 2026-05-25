from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import httpx
import json
import os
import datetime

app = FastAPI(title="MS4 - Orquestador de Consenso e Inteligencia")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permite peticiones desde el frontend (Vite)
    allow_credentials=True,
    allow_methods=["*"], # Permite OPTIONS, POST, GET, etc.
    allow_headers=["*"],
)

# URLs de los modelos (Microservicios 3.x)
MS3_URLS = {
    "ocsvm": "http://ms3_ocsvm:8001/predict",
    "isoforest": "http://ms3_iforest:8002/predict",
    "autoencoder": "http://ms3_autoencoder:8003/predict"
}

# Rutas de almacenamiento persistente
LOG_DIR = "/app/data"
LOG_FILE = os.path.join(LOG_DIR, "log.txt")
STATE_FILE = os.path.join(LOG_DIR, "ultimo_estado.json")

# Aseguramos que el directorio de datos existe
os.makedirs(LOG_DIR, exist_ok=True)

def escribir_en_log(datos_json: dict):
    """
    Escribe el JSON Inteligente en el archivo log.txt con una cabecera temporal.
    Usa formato append ('a') para no borrar los registros anteriores.
    """
    try:
        timestamp_log = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n==================== REGISTRO KUNNA: {timestamp_log} ====================\n")
            f.write(json.dumps(datos_json, indent=4, ensure_ascii=False))
            f.write("\n")
    except Exception as e:
        print(f"[ERROR LOGGER] No se pudo escribir en log.txt: {e}")

def guardar_ultimo_estado(datos_json: dict):
    """
    Guarda el snapshot más reciente en un archivo JSON independiente
    para dar soporte a las peticiones de refresco del Frontend.
    """
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(datos_json, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"[ERROR CACHE] No se pudo guardar el último estado: {e}")


@app.post("/aggregate")
async def aggregate_results(data: dict):
    """
    Recibe datos escalados, reales y alertas del MS2.
    Coordina la votación y el aislamiento de anomalías en paralelo.
    """
    # 1. Validación de datos de entrada fuera del try-except para evitar colisiones con HTTPException
    datos_escalados = data.get("datos_escalados", [])
    datos_reales = data.get("datos_reales", [])
    alertas_hw = data.get("alertas_hardware", [])

    if not datos_escalados:
        # Si la petición viene anidada por un nivel extra en algunas pruebas manuales
        if "data" in data and isinstance(data["data"], dict):
            inner_data = data["data"]
            datos_escalados = inner_data.get("datos_escalados", [])
            datos_reales = inner_data.get("datos_reales", [])
            alertas_hw = inner_data.get("alertas_hardware", [])
        
        # Volvemos a comprobar tras intentar desanidar
        if not datos_escalados:
            raise HTTPException(status_code=400, detail="Faltan datos escalados en el payload enviado al orquestador")

    try:
        # 2. Llamadas en paralelo a los modelos del MS3 usando httpx
        async with httpx.AsyncClient() as client:
            tasks = [
                client.post(MS3_URLS["ocsvm"], json={"data": datos_escalados}, timeout=5.0),
                client.post(MS3_URLS["isoforest"], json={"data": datos_escalados}, timeout=5.0),
                client.post(MS3_URLS["autoencoder"], json={"data": datos_escalados}, timeout=5.0)
            ]
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)

        # 3. Extraer resultados y manejar posibles caídas de modelos
        results = {}
        model_names = ["ocsvm", "isoforest", "autoencoder"]
        
        for name, resp in zip(model_names, responses):
            if isinstance(resp, Exception):
                results[name] = {"error": str(resp), "is_anomaly": 0}
            else:
                # Si el modelo retorna error interno (ej. 500), lo manejamos de forma segura
                if hasattr(resp, "status_code") and resp.status_code != 200:
                    results[name] = {"error": f"HTTP Error {resp.status_code}", "is_anomaly": 0}
                else:
                    results[name] = resp.json()

        # 4. LÓGICA DE CONSENSO (Último instante de tiempo - fila 4)
        votos = [
            results["ocsvm"].get("is_anomaly", 0),
            results["isoforest"].get("is_anomaly", 0),
            results["autoencoder"].get("is_anomaly", 0)
        ]
        
        # Asegurar que se manejan booleanos o enteros correctamente
        votos_int = [1 if v else 0 for v in votos]
        consenso_anomalia = 1 if sum(votos_int) >= 2 else 0

        # 5. AISLAMIENTO DE COMPORTAMIENTO (Inteligencia del Autoencoder)
        culpable = "Ninguno"
        error_por_variable = {}
        
        if results["autoencoder"].get("is_anomaly") == 1:
            error_por_variable = results["autoencoder"].get("feature_errors", {})
            if error_por_variable:
                culpable = max(error_por_variable, key=error_por_variable.get)

        # 6. CONSTRUCCIÓN DEL JSON INTELIGENTE
        final_response = {
            "timestamp": datos_reales[-1].get("timestamp_rango") if datos_reales else datetime.datetime.now().isoformat(),
            "consenso": {
                "hay_anomalia": bool(consenso_anomalia),
                "nivel_critico": "ALTO" if sum(votos_int) == 3 else "MEDIO" if sum(votos_int) == 2 else "BAJO",
                "votos_detalle": {
                    "ocsvm": bool(results["ocsvm"].get("is_anomaly", 0)),
                    "isoforest": bool(results["isoforest"].get("is_anomaly", 0)),
                    "autoencoder": bool(results["autoencoder"].get("is_anomaly", 0))
                }
            },
            "analisis_causa": {
                "culpable_probable": culpable,
                "error_distribucion": error_por_variable,
                "comentario": f"Detección basada en {culpable}" if consenso_anomalia else "Estado estable"
            },
            "datos_graficas": {
                "actuales": datos_reales[-1] if datos_reales else {},
                "historico_ventana": datos_reales
            },
            "alertas_hardware": alertas_hw
        }

        # 7. PERSISTENCIA EN ARCHIVOS
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, escribir_en_log, final_response)
        await loop.run_in_executor(None, guardar_ultimo_estado, final_response)

        return final_response

    except Exception as e:
        print(f"Error de ejecución en Orquestador: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/aggregate")
async def get_latest_data():
    """
    Ruta GET complementaria para el Frontend.
    """
    if not os.path.exists(STATE_FILE):
        return {
            "timestamp": datetime.datetime.now().isoformat(),
            "consenso": {
                "hay_anomalia": False,
                "nivel_critico": "BAJO",
                "votos_detalle": {"ocsvm": False, "isoforest": False, "autoencoder": False}
            },
            "analisis_causa": {
                "culpable_probable": "Ninguno",
                "error_distribucion": {},
                "comentario": "Iniciando sistema... Esperando datos de sensores."
            },
            "datos_graficas": {
                "actuales": {},
                "historico_ventana": []
            },
            "alertas_hardware": []
        }
    
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo recuperar el estado actual: {str(e)}")


@app.get("/status")
async def health_check():
    return {"status": "online", "service": "Orchestrator"}