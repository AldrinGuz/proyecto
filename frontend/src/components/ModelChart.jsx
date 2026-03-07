import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale
} from "chart.js";

ChartJS.register(BarElement, CategoryScale, LinearScale);

function ModelChart({ ocsvm, isoforest, autoencoder }) {

  const data = {
    labels: ["OCSVM", "IsolationForest", "Autoencoder"],
    datasets: [
      {
        label: "Resultado modelo",
        data: [ocsvm, isoforest, autoencoder]
      }
    ]
  };

  return (
    <div>
      <h3>Resultados de Modelos</h3>
      <Bar data={data} />
    </div>
  );
}

export default ModelChart;