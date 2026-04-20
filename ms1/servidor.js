require("dotenv").config();

const express = require("express");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Para trabajar en local sin certificados
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MS_URL = process.env.MS_URL || "http://ms2:8000/preprocess";

const K_CONEXIONES = process.env.K_CONEXIONES;
const K_HUMEDAD = process.env.K_CLIMA;
const K_CO2 = process.env.K_CLIMA;
const K_TEMPERATURA = process.env.K_CLIMA;
const K_PARTICULAS = process.env.K_CLIMA;
const K_ELECTRICIDAD = process.env.K_ELECTRICIDAD;

const listCONEXIONES = ["inal.36.0.11", "inal.36.0.12", "inal.36.0.13", "inal.36.0.15", "inal.36.0.16", "inal.36.0.17", "inal.36.0.62", "inal.36.0.68", "inal.36.1.18", "inal.36.1.20", "inal.36.1.21", "inal.36.1.4", "inal.36.1.64", "inal.36.1.66", "inal.36.s.1", "inal.36.s.10", "inal.36.s.2", "inal.36.s.3", "inal.36.s.5", "inal.36.s.6", "inal.36.s.61", "inal.36.s.67", "inal.36.s.7", "inal.36.s.8", "inal.36.s.9"];
const listCLIMA = ["sensor-voc-1", "sensor-voc-2", "sensor-voc-3", "sensor-voc-4", "sensor-voc-5"];
const listELECTRICIDAD = ["6339579", "6339651", "9688827", "6339566"];

// MAPA CRÍTICO: Relaciona los IDs eléctricos con la descripción que MS2 necesita
const MAPA_ELECTRICIDAD = {
    "6339579": "0036 German Bernacer A/A",
    "6339651": "0036 German Bernacer Aire Acond.",
    "9688827": "0036 German Bernacer-Servicios Generales",
    "6339566": "0036 Germán Bernácer"
};

app.get("/fetch-data", async (req, res) => {
    await fetchAndSendData();
    res.json({ message: "Pipeline ejecutado manualmente" });
});

app.listen(PORT, () => {
    console.log("MS1 activado. Puerto:", PORT);
    fetchAndSendData();
    setInterval(fetchAndSendData, 15 * 60 * 1000);
});

/**
 * Revisa si algún sensor NO DEVOLVIÓ NINGÚN DATO en la ventana de 75 minutos.
 * Si es así, inyecta 5 puntos falsos (-9999) solo para ese sensor.
 */
function completarSensores(data, filters, taskName) {
    const magnitudesEsperadas = filters.find(f => f.field === "magnitude").values;
    const sensoresEsperados = filters.find(f => f.field === "device_id").values;

    if (!data || !data.data || !data.data.records || data.data.records.length === 0) {
        console.log(`[WARN] ⚠️ Kunna devolvió 0 datos para ${taskName}. Generando anomalía total...`);
        return generateSyntheticAnomaly(filters);
    }

    const records = data.data.records;
    const sensoresRecibidos = new Set();
    records.forEach(r => {
        const id = r.device_id || r.uid;
        if (id) sensoresRecibidos.add(id);
    });

    const plantillas = {};
    magnitudesEsperadas.forEach(mag => {
        const ejemplo = records.find(r => r.magnitude === mag || r.metric === mag);
        if (ejemplo) {
            plantillas[mag] = { metric: ejemplo.metric || mag, description: ejemplo.description || "" };
        } else {
            plantillas[mag] = { metric: mag, description: "Injected" };
        }
    });

    const now = new Date();
    let sensoresRellenados = new Set();
    
    sensoresEsperados.forEach(sensor => {
        if (!sensoresRecibidos.has(sensor)) {
            sensoresRellenados.add(sensor);
            
            for (let i = 0; i < 5; i++) {
                const ts = new Date(now.getTime() - (i * 15 * 60 * 1000)).toISOString();
                magnitudesEsperadas.forEach(mag => {
                    records.push({
                        timestamp: ts,
                        device_id: sensor,
                        magnitude: mag,
                        metric: plantillas[mag].metric,
                        description: plantillas[mag].description,
                        description_origin: MAPA_ELECTRICIDAD[sensor] || "", // <-- FIX: Inyectamos el texto exacto
                        value: -9999
                    });
                });
            }
        }
    });

    if (sensoresRellenados.size > 0) {
        console.log(`[INFO] 🛠️  ${taskName}: Falta información total de algunos sensores.`);
        console.log(`[INFO] 📡 Sensores inyectados: ${Array.from(sensoresRellenados).join(", ")}`);
    }

    return data;
}

/**
 * Genera un bloque completo de datos falsos (-9999) simulando 5 puntos temporales (75 min)
 */
function generateSyntheticAnomaly(filters) {
    const magnitudes = filters.find(f => f.field === "magnitude").values;
    const deviceIds = filters.find(f => f.field === "device_id").values;
    
    const records = [];
    const now = new Date();
    
    for (let i = 0; i < 5; i++) {
        const ts = new Date(now.getTime() - (i * 15 * 60 * 1000)).toISOString();
        for (const uid of deviceIds) {
            for (const mag of magnitudes) {
                records.push({
                    timestamp: ts,
                    device_id: uid,
                    magnitude: mag,
                    metric: mag,
                    description: "Synthetic Anomaly",
                    description_origin: MAPA_ELECTRICIDAD[uid] || "", // <-- FIX: Inyectamos el texto exacto
                    value: -9999
                });
            }
        }
    }

    return {
        is_synthetic_anomaly: true,
        data: { records: records, metadata: [] }
    };
}

async function fetchAndSendData() {
    const listData = [];
    
    const fetchTasks = [
        { name: "CO2", token: K_CO2, filters: [{field:"magnitude",values:["CO2"]},{field:"device_id",values:listCLIMA}] },
        { name: "Temperatura", token: K_TEMPERATURA, filters: [{field:"magnitude",values:["Temperature"]},{field:"device_id",values:listCLIMA}] },
        { name: "Humedad", token: K_HUMEDAD, filters: [{field:"magnitude",values:["Humidity"]},{field:"device_id",values:listCLIMA}] },
        { name: "Conexiones", token: K_CONEXIONES, filters: [{field:"magnitude",values:["connections"]},{field:"device_id",values:listCONEXIONES}] },
        { name: "Electricidad", token: K_ELECTRICIDAD, filters: [{field:"magnitude",values:["electricityfacility","generalelectricity"]},{field:"device_id",values:listELECTRICIDAD}] },
        { name: "Partículas", token: K_PARTICULAS, filters: [{field:"magnitude",values:["VocIndex"]},{field:"device_id",values:listCLIMA}] }
    ];

    console.log(`\n--- Iniciando recolección de datos (${new Date().toISOString()}) ---`);

    for (const task of fetchTasks) {
        try {
            let data = await getData(task.token, task.filters);
            data = completarSensores(data, task.filters, task.name);
            console.log(`[OK] Paquete de ${task.name} íntegro y preparado.`);
            listData.push(data);
        } catch (err) {
            console.error(`[ERROR RED] Fallo al conectar con Kunna para ${task.name}. Inyectando anomalía total...`);
            listData.push(generateSyntheticAnomaly(task.filters));
        }
    }

    try {
        const response = await fetch(MS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(listData)
        });
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        console.log(`[EXITO] 🚀 Se han enviado los 6 bloques completos de datos al MS2.`);
    } catch (err) {
        console.error("[CRITICO] No se pudo enviar la información al MS2:", err.message);
    }
}

async function getData(token, filters) {
    const end = new Date();
    const start = new Date(end.getTime() - 75 * 60 * 1000); 

    const response = await fetch(`https://api.kunna.io/openapi/measurements/query/data/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-token-open-api": token
        },
        body: JSON.stringify({
            time_range: {
                start: start.toISOString(),
                end: end.toISOString()
            },
            filters: filters
        })
    });
    
    return await response.json();
}