require("dotenv").config();

const fs = require("fs");
const path = require("path");

const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const K_CONEXIONES = process.env.K_CONEXIONES;
const K_HUMEDAD = process.env.K_CLIMA;
const K_CO2 = process.env.K_CLIMA;
const K_TEMPERATURA = process.env.K_CLIMA;
const K_PARTICULAS = process.env.K_CLIMA;
const K_ELECTRICIDAD = process.env.K_ELECTRICIDAD;

const listCONEXIONES = ["inal.36.0.11","inal.36.0.12","inal.36.0.13","inal.36.0.15","inal.36.0.16","inal.36.0.17","inal.36.0.62","inal.36.0.68","inal.36.1.18","inal.36.1.20","inal.36.1.21","inal.36.1.4","inal.36.1.64","inal.36.1.66","inal.36.s.1","inal.36.s.10","inal.36.s.2","inal.36.s.3","inal.36.s.5","inal.36.s.6","inal.36.s.61","inal.36.s.67","inal.36.s.7","inal.36.s.8","inal.36.s.9"];
const listCLIMA = ["GB/INF1-0036P1010","GB/INF2-0036P1011","GB/INF3-0036PB031","GB/INF4-0036PS062","GB/INF5-0036PS063"];
const listELECTRICIDAD = ["0036 German Bernacer A/A","0036 German Bernacer Aire Acond.","0036 German Bernacer-Servicios Generales","0036 Germán Bernácer"];

const filenames = [
    "conexiones.csv",
    "humedad.csv",
    "co2.csv",
    "temperatura.csv",
    "particulas.csv",
    "electricidad.csv"
];

app.get("/fetch-data", async (req, res) => {
    try {
        const listData = [];
        var size = 0;
        listData.push(await getData(K_CONEXIONES,[{filter:"uid",values:listCONEXIONES}]));
        listData.push(await getData(K_HUMEDAD,[{filter:"name",values:["Humidity"]},{filter:"alias",values:listCLIMA}]));
        listData.push(await getData(K_CO2,[{filter:"name",values:["CO2"]},{filter:"alias",values:listCLIMA}]));
        listData.push(await getData(K_TEMPERATURA,[{filter:"name",values:["Temperature"]},{filter:"alias",values:listCLIMA}]));
        listData.push(await getData(K_PARTICULAS,[{filter:"name",values:["VocIndex"]},{filter:"alias",values:listCLIMA}]));
        listData.push(await getData(K_ELECTRICIDAD,[{filter:"name",values:["15m"]},{filter:"description_origin",values:listELECTRICIDAD}]));

        listData.forEach((data, i) => {
            if (data.code !== "20000-00000" || !data.result) {
                throw new Error("Error en Kunna API");
            }

            const rows = extractTimeValueName(data);
            writeCSV(filenames[i], rows);
        });

        res.status(200).json({
            message: "CSV generados correctamente",
            files: filenames
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
    const response = await fetch(`https://openapi.kunna.es/data/${token}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            time_start: "2025-01-17T09:18:38Z",
            time_end: "2025-01-17T11:18:38Z",
            filters: filters,
            count: false,
            order: "DESC"
        })
    });

    return await response.json();
}

function extractTimeValueName(data) {
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

function writeCSV(filename, rows) {
    const header = "time,value,name\n";
    const content = rows
        .map(r => `${r.time},${r.value},${r.name}`)
        .join("\n");

    fs.writeFileSync(
        path.join(__dirname, filename),
        header + content,
        "utf8"
    );
}