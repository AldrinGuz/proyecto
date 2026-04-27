const API_URL = "/api";

export async function getStatus() {
  const response = await fetch(`${API_URL}/status`);
  return response.json();
}

export async function getPredictions(data) {
  const response = await fetch(`${API_URL}/aggregate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
  return response.json();
}

export async function saveRecord(estado) {
  const payload = {
    usuario: 1,
    fecha: new Date().toISOString(),
    estado: estado
  };
  const response = await fetch(`${API_URL}/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return response.json();
}