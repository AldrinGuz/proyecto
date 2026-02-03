require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const K_CONEXIONES = process.env.K_CONEXIONES;
const MS_URL = process.env.MS_URL;

app.post("/fetch-data", async (req, res) => {
    try {
        const response = await fetch(`https://openapi.kunna.es/data/${K_CONEXIONES}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                time_start: "2025-01-17T05:18:38Z",
                time_end: "2025-01-19T05:18:38Z",
                filters: [
                    { filter: "name", values: ["conexiones"] },
                    { filter: "uid", values: ["inal.33.1.12", "inal.33.1.13"] }
                ],
                limit: 100,
                count: false,
                order: "DESC"
            })
        });

        const data = await response.json();
        //Si no es aceptada la petici�n
        if (data.code !== "20000-00000" || !data.result) {
            return res.status(502).json({
                error: "Error en Kunna API",
                details: data
            });
        }
        //Por el contrario se acepta
        var ms2response = await fetch(MS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data.result)
        });

        var ms2status = await ms2response.json();

        return res.status(200).json({
            source: "kunna",
            datos: data.result.values.length
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno en MS1" });
    }
});

app.listen(PORT, () => { console.log("MS1 activado. Esta escuchando en el puerto: "+PORT); });