/**
 * Realiza una petición tipo POST a la API de Kunna (versión actual 16/05/2026). Toma los datos desde
 * el momento en el que realiza la petición hasta los 75min anteriores.
 * @param {string} token Seguridad, debe ser dado por el servicio técnico
 * @param {{field:string, values:string[]}[]} filters Filtros aplicados a la petición de API
 * @returns 
 */
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
async function sendData(URL,datos,msg){
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