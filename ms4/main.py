from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import sqlite3
import json
from datetime import datetime
from pathlib import Path

app = FastAPI(title="MS4 - Orquestador Asíncrono")

# Configuración CORS para permitir conexiones del frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===================================================
# BASE DE DATOS SQLite (alternativa a LiteDB para Python)
# ===================================================
DB_PATH = "/app/data/predictions.db"

def init_db():
    """Inicializar la base de datos SQLite"""
    Path("/app/data").mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            sensors TEXT,
            models TEXT,
            final INTEGER
        )
    """)
    # Tabla para relacionar predicciones con usuarios
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prediction_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prediction_id INTEGER,
            user_id INTEGER,
            saved_at TEXT,
            FOREIGN KEY (prediction_id) REFERENCES predictions(id)
        )
    """)
    conn.commit()
    conn.close()

def save_prediction(sensors, models, final):
    """Guardar predicción en la base de datos"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO predictions (timestamp, sensors, models, final) VALUES (?, ?, ?, ?)",
        (datetime.now().isoformat(), json.dumps(sensors), json.dumps(models), final)
    )
    conn.commit()
    conn.close()

def get_history(limit=100):
    """Obtener historial de predicciones"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT timestamp, sensors, models, final FROM predictions ORDER BY id DESC LIMIT ?",
        (limit,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "timestamp": row[0],
            "sensors": json.loads(row[1]),
            "models": json.loads(row[2]),
            "final": row[3]
        }
        for row in rows
    ]

# Inicializar base de datos al iniciar
init_db()

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

    # Guardar en la base de datos SQLite
    save_prediction(last_status["sensors"], last_status["models"], final)

    return {"message": "Predicción actualizada", "status": last_status}
    
@app.get("/status")
async def get_status():
    return last_status

@app.get("/history")
async def get_history_endpoint(limit: int = 100):
    """Obtener historial de predicciones"""
    return {"history": get_history(limit)}

@app.post("/save")
async def save_manual_prediction(request: dict):
    """
    Guardar manualmente un registro con información del usuario.
    Payload esperado: { usuario: 1, fecha: "2024-01-01T12:00:00", estado: { sensors, models, final } }
    """
    usuario = request.get("usuario", 1)
    fecha = request.get("fecha")  # Fecha enviada desde el frontend
    estado = request.get("estado", {})
    
    sensors = estado.get("sensors")
    models = estado.get("models")
    final = estado.get("final")
    
    # Usar la fecha proporcionada o la actual
    timestamp = fecha if fecha else datetime.now().isoformat()
    
    # Guardar en la base de datos con información del usuario
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO predictions (timestamp, sensors, models, final) VALUES (?, ?, ?, ?)",
        (timestamp, json.dumps(sensors), json.dumps(models), final)
    )
    pred_id = cursor.lastrowid
    
    # Agregar información del usuario
    cursor.execute(
        "INSERT INTO prediction_users (prediction_id, user_id, saved_at) VALUES (?, ?, ?)",
        (pred_id, usuario, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    
    return {"message": "Registro guardado", "id": pred_id, "usuario": usuario, "fecha": timestamp}