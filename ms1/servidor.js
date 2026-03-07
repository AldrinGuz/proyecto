require("dotenv").config();

const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const MS_URL = process.env.MS_URL;

const K_CONEXIONES = process.env.K_CONEXIONES;
const K_HUMEDAD = process.env.K_CLIMA;
const K_CO2 = process.env.K_CLIMA;
const K_TEMPERATURA = process.env.K_CLIMA;
const K_PARTICULAS = process.env.K_CLIMA;
const K_ELECTRICIDAD = process.env.K_ELECTRICIDAD;

const listCONEXIONES = ["inal.36.0.11","inal.36.0.12","inal.36.0.13","inal.36.0.15","inal.36.0.16","inal.36.0.17","inal.36.0.62","inal.36.0.68","inal.36.1.18","inal.36.1.20","inal.36.1.21","inal.36.1.4","inal.36.1.64","inal.36.1.66","inal.36.s.1","inal.36.s.10","inal.36.s.2","inal.36.s.3","inal.36.s.5","inal.36.s.6","inal.36.s.61","inal.36.s.67","inal.36.s.7","inal.36.s.8","inal.36.s.9"];
const listCLIMA = ["sensor-voc-1","sensor-voc-2","sensor-voc-3","sensor-voc-4","sensor-voc-5"];
const listELECTRICIDAD = ["0036 German Bernacer A/A","0036 German Bernacer Aire Acond.","0036 German Bernacer-Servicios Generales","0036 Germán Bernácer"];

app.get("/fetch-data", async (req, res) => {
    try {
        let rows = [];
        const listData = [
            await getData(K_CO2,[{field:"magnitude",values:["CO2"]},{field:"device_id",values:listCLIMA}]),
            await getData(K_TEMPERATURA,[{field:"magnitude",values:["Temperature"]},{field:"device_id",values:listCLIMA}]),
            await getData(K_HUMEDAD,[{field:"magnitude",values:["Humidity"]},{field:"device_id",values:listCLIMA}]),
            await getData(K_CONEXIONES,[{field:"device_id",values:listCONEXIONES}]),
            await getData(K_ELECTRICIDAD,[{field:"magnitude",values:["15m"]},{field:"description_origin",values:listELECTRICIDAD}]),
            await getData(K_PARTICULAS,[{field:"magnitude",values:["VocIndex"]},{field:"device_id",values:listCLIMA}])
        ];

        for (const data of listData) {
            if (data.code !== "20000-00000" || !data.result) {
                throw new Error("Error en Kunna API");
            } else {
                rows.push(createMessage(data))
            }
        }
        
        await fetch(MS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rows)
        });

        res.status(200).json({
            message: "Datos enviados correctamente a MS2",
            ms2: rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno en MS1" });
    }
});


app.listen(PORT, () => { console.log("MS1 activado. Esta escuchando en el puerto: "+PORT); });

/**
 * @param {String} token  
 * @param {{filter:string,values:string[]}[]} filters 
*/
async function getData(token,filters) {
    const response = await fetch(`https://api.kunna.io/openapi/measurements/query/data/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-token-open-api": token,
        },
        body: JSON.stringify({
            time_range: {
                start: "2025-06-01T07:00:00Z",
                end: "2025-06-01T07:15:00Z"
            },
            filters: filters,
        })
    });

    return await response.json();
}

function createMessage(data) {
    const { columns, values } = data.result;

    const idxTime = columns.indexOf("time");
    const idxValue = columns.indexOf("value");
    const idxName = columns.indexOf("name");

    if (idxTime === -1 || idxValue === -1 || idxName === -1) {
        throw new Error("Columnas necesarias no encontradas");
    }

    return values.map(row => ({
        time: row[idxTime],
        value: row[idxValue],
        name: row[idxName]
    }));
}
