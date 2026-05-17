/**
 * Revisa si algún sensor NO DEVOLVIÓ NINGÚN DATO en la ventana de 75 minutos.
 * Si es así, inyecta 5 puntos falsos (-9999) solo para ese sensor.
 * @param {*} data 
 * @param {{field:string, values:string[]}[]} filters Filtros aplicados a la petición de API
 * @param {string} taskName Nombre del sensor Opcional
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
 * @param {{field:string, values:string[]}[]} filters Filtros aplicados a la petición de API
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