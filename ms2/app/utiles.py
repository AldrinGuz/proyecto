def build_dataframe(payload):
    df = pd.DataFrame(
        payload["values"],
        columns=payload["columns"]
    )

    df["time"] = pd.to_datetime(df["time"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    # Agrupar conexiones
    df = (
        df.groupby("time", as_index=False)["value"]
        .sum()
        .rename(columns={"value": "NumPersonas"})
    )

    return df
def add_temporal_features(df):
    df["hora"] = df["time"].dt.hour
    df["dia_semana"] = df["time"].dt.weekday
    df["fin_de_semana"] = df["dia_semana"].isin([5, 6]).astype(int)
    df["mes"] = df["time"].dt.month
    df["dia_mes"] = df["time"].dt.day
    return df
    
def cyclic_encoding(df):
    df["hora_sin"] = np.sin(2 * np.pi * df["hora"] / 24)
    df["hora_cos"] = np.cos(2 * np.pi * df["hora"] / 24)

    df["dia_sin"] = np.sin(2 * np.pi * df["dia_semana"] / 7)
    df["dia_cos"] = np.cos(2 * np.pi * df["dia_semana"] / 7)

    df["mes_sin"] = np.sin(2 * np.pi * df["mes"] / 12)
    df["mes_cos"] = np.cos(2 * np.pi * df["mes"] / 12)

    df["dm_sin"] = np.sin(2 * np.pi * df["dia_mes"] / 31)
    df["dm_cos"] = np.cos(2 * np.pi * df["dia_mes"] / 31)

    return df
