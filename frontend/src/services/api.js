const API_URL = "http://ms4:8004";

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