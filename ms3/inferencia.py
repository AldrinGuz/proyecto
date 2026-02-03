import numpy as np
import joblib
from tensorflow.keras.models import load_model

# Cargar modelos entrenados en Kaggle
IF_MODEL = joblib.load("isolation_forest.pkl")
OCSVM_MODEL = joblib.load("ocsvm.pkl")
AE_MODEL = load_model("autoencoder.h5")

def ini_inferencia(payload: dict):

    X_std = np.array(payload["standard"])
    X_rob = np.array(payload["robust"])

    if_scores = IF_MODEL.decision_function(X_rob)
    if_pred = IF_MODEL.predict(X_rob)  # 1 normal, -1 anomalía

    svm_scores = OCSVM_MODEL.decision_function(X_std)
    svm_pred = OCSVM_MODEL.predict(X_std)

    recon = AE_MODEL.predict(X_std, verbose=0)
    ae_mse = np.mean(np.square(X_std - recon), axis=1)

    AE_THRESHOLD = 1.0846233885549623
    ae_pred = (ae_mse > AE_THRESHOLD).astype(int)

    return {
        "isolation_forest": {
            "scores": if_scores.tolist(),
            "anomaly": (if_pred == -1).astype(int).tolist()
        },
        "one_class_svm": {
            "scores": svm_scores.tolist(),
            "anomaly": (svm_pred == -1).astype(int).tolist()
        },
        "autoencoder": {
            "mse": ae_mse.tolist(),
            "anomaly": ae_pred.tolist()
        }
    }
