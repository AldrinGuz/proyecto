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
const listCLIMA = ["sensor-voc-1", "sensor-voc-2", "sensor-voc-3", "sensor-voc-4"];
const listELECTRICIDAD = ["6339579", "6339651", "9688827", "6339566"];

// Caché de estado en memoria para el "Arranque en Caliente" e imputación progresiva
const cacheUltimosValores = {
    clima: {},
    electricidad: {},
    conexiones: {}
};

// Inicialización de la caché con valores base seguros para evitar fallos si el primer fetch falla
listCLIMA.forEach(s => {
    cacheUltimosValores.clima[`tem_${s}`] = 22.0;
    cacheUltimosValores.clima[`hum_${s}`] = 40.0;
    cacheUltimosValores.clima[`co2_${s}`] = 450.0;
    cacheUltimosValores.clima[`voc_${s}`] = 30.0;
});
listELECTRICIDAD.forEach(s => cacheUltimosValores.electricidad[`elec_${s}`] = 0.0);
listCONEXIONES.forEach(s => cacheUltimosValores.conexiones[s] = 0);

app.get("/fetch-data", async (req, res) => {
    const msg = await fetchAndSendData();
    res.json({ message: "Pipeline ejecutado manualmente", data: msg });
});

app.listen(PORT, () => {
    console.log("MS1 activado. Puerto:", PORT);
    fetchAndSendData();
    setInterval(fetchAndSendData, 15 * 60 * 1000);
});

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
            const data = await getData(task.token, task.filters);
            listData.push(data);
        } catch (err) {
            console.error(`[ERROR RED] Fallo al conectar con Kunna para ${task.name}.`);
            listData.push([]);
        }
    }

    datosEnviar = alinearYCompletarDatosEnVentanas(listData);
    // Enviamos los datos al MS2 y esperamos a que termine antes de retornar
    await sendData(MS_URL, datosEnviar, " (Bloque de 75 min)");
    
    return datosEnviar;
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

/**
 * Envía los datos al destino  mediante un metodo POST. Si no se completa la operación saldrá un mensaje de aborto.
 * @param {string} URL Destino de envío, el microservcio 2
 * @param {{}[]} datos 
 * @param {string} msg Opcional, un mensaje que se muestre con cada envío a modo de feedback
 */
async function sendData(URL,datos,msg=""){
    try {
        const response = await fetch(URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        console.log(`[EXITO] Se han enviado los datos al MS2.${msg}`);
    } catch (err) {
        console.error("[CRITICO] No se pudo enviar la información al MS2:", err.message);
    }
}

/**
 * Convierte el bloque de 75 minutos en 5 ventanas secuenciales de 15 minutos.
 */
function alinearYCompletarDatosEnVentanas(listData) {
    const ventanasDeTiempo = [];
    const alertasHardware = [];
    
    const endMs = new Date().getTime();
    const intervaloMs = 15 * 60 * 1000; // 15 minutos

    // Creamos 5 cubos de tiempo (T-75, T-60, T-45, T-30, T-15) cronológicamente
    for (let i = 5; i > 0; i--) {
        const startRango = endMs - (i * intervaloMs);
        const endRango = endMs - ((i - 1) * intervaloMs);
        
        const isUltimaVentana = (i === 1); // Solo alertamos si falla en el instante "actual"
        const snapshot = procesarVentanaUnica(listData, startRango, endRango, isUltimaVentana, alertasHardware);
        
        // Agregar timestamp para que MS2 pueda extraer 'hora_sin', 'hora_cos', etc.
        snapshot.timestamp_rango = new Date(endRango).toISOString();
        ventanasDeTiempo.push(snapshot);
    }

    return { 
        payloadParaMS2: ventanasDeTiempo, // Ahora es un array de 5 objetos
        alertas: alertasHardware 
    };
}

/**
 * Procesa una única ventana de tiempo de 15 minutos.
 */
function procesarVentanaUnica(listData, startMs, endMs, isUltimaVentana, alertasHardware) {
    const datosListosParaIA = {};
    const timestampActual = new Date(endMs).toISOString();

    // 1. PROCESAR CLIMA
    listCLIMA.forEach(sensor => {
        const temp = buscarUltimoValorEnRango(listData, "Temperature", sensor, startMs, endMs);
        const hum = buscarUltimoValorEnRango(listData, "Humidity", sensor, startMs, endMs);
        const co2 = buscarUltimoValorEnRango(listData, "CO2", sensor, startMs, endMs);
        const voc = buscarUltimoValorEnRango(listData, "VocIndex", sensor, startMs, endMs);

        // Imputación Temperatura
        if (temp === null) {
            if (isUltimaVentana) alertasHardware.push({ tipo: "OFFLINE", sensor: sensor, variable: "Temperature", time: timestampActual });
            datosListosParaIA[`tem_${sensor}`] = cacheUltimosValores.clima[`tem_${sensor}`];
        } else {
            datosListosParaIA[`tem_${sensor}`] = temp;
            cacheUltimosValores.clima[`tem_${sensor}`] = temp;
        }

        // Imputación Humedad
        if (hum === null) {
            if (isUltimaVentana) alertasHardware.push({ tipo: "OFFLINE", sensor: sensor, variable: "Humidity", time: timestampActual });
            datosListosParaIA[`hum_${sensor}`] = cacheUltimosValores.clima[`hum_${sensor}`];
        } else {
            datosListosParaIA[`hum_${sensor}`] = hum;
            cacheUltimosValores.clima[`hum_${sensor}`] = hum;
        }

        // Imputación CO2
        if (co2 === null) {
            if (isUltimaVentana) alertasHardware.push({ tipo: "OFFLINE", sensor: sensor, variable: "CO2", time: timestampActual });
            datosListosParaIA[`co2_${sensor}`] = cacheUltimosValores.clima[`co2_${sensor}`];
        } else {
            datosListosParaIA[`co2_${sensor}`] = co2;
            cacheUltimosValores.clima[`co2_${sensor}`] = co2;
        }

        // Imputación VOC
        if (voc === null) {
            if (isUltimaVentana) alertasHardware.push({ tipo: "OFFLINE", sensor: sensor, variable: "VocIndex", time: timestampActual });
            datosListosParaIA[`voc_${sensor}`] = cacheUltimosValores.clima[`voc_${sensor}`];
        } else {
            datosListosParaIA[`voc_${sensor}`] = voc;
            cacheUltimosValores.clima[`voc_${sensor}`] = voc;
        }
    });

    // 2. PROCESAR ELECTRICIDAD
    listELECTRICIDAD.forEach(medidor => {
        const elec = buscarUltimoValorEnRango(listData, "electricityfacility", medidor, startMs, endMs) ?? 
                     buscarUltimoValorEnRango(listData, "generalelectricity", medidor, startMs, endMs); 
        
        if (elec === null) {
            if (isUltimaVentana) alertasHardware.push({ tipo: "OFFLINE", sensor: medidor, variable: "electricity", time: timestampActual });
            datosListosParaIA[`elec_${medidor}`] = cacheUltimosValores.electricidad[`elec_${medidor}`];
        } else {
            datosListosParaIA[`elec_${medidor}`] = elec;
            cacheUltimosValores.electricidad[`elec_${medidor}`] = elec;
        }
    });

    // 3. PROCESAR CONEXIONES (Alumnos) - Imputación por AP individual para mayor precisión
    let totalConexionesActuales = 0;
    let apsCaidos = 0;

    listCONEXIONES.forEach(ap => {
        const conn = buscarUltimoValorEnRango(listData, "connections", ap, startMs, endMs);
        
        if (conn === null) {
            apsCaidos++;
            totalConexionesActuales += cacheUltimosValores.conexiones[ap]; // Sumamos el último valor conocido del AP
        } else {
            totalConexionesActuales += conn;
            cacheUltimosValores.conexiones[ap] = conn;
        }
    });

    if (apsCaidos > 0 && isUltimaVentana) {
        alertasHardware.push({ tipo: "WARNING_AP", mensaje: `${apsCaidos} Puntos de acceso WiFi caídos`, time: timestampActual });
    }
    
    datosListosParaIA['total_alumnos'] = totalConexionesActuales;

    return datosListosParaIA;
}

/**
 * Busca el valor más reciente DENTRO del rango de tiempo específico (startMs a endMs).
 */
function buscarUltimoValorEnRango(listData, magnitudeReal, deviceId, startMs, endMs) {
    let ultimoValor = null;
    let fechaMasRecienteEnRango = 0;

    for (const respuesta of listData) {
        if (!respuesta || !respuesta.data || !respuesta.data.records) continue;

        for (const record of respuesta.data.records) {
            if (record.device_id === deviceId && record.magnitude === magnitudeReal) {
                const tiempoRegistro = new Date(record.timestamp).getTime();
                
                // Filtramos SOLO los que caen dentro de la ventana de 15 mins actual
                if (tiempoRegistro >= startMs && tiempoRegistro <= endMs) {
                    if (tiempoRegistro > fechaMasRecienteEnRango) {
                        fechaMasRecienteEnRango = tiempoRegistro;
                        ultimoValor = record.value;
                    }
                }
            }
        }
    }
    
    return ultimoValor;
}