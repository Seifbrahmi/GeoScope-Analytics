import pandas as pd


def main():
    fire = pd.read_csv("backend/outputs/burned_area_timeseries.csv")
    rain = pd.read_csv("backend/outputs/rainfall_timeseries.csv")

    df = pd.merge(fire, rain, on=["catchment_id", "date"])
    df["rainfall"] = df["rainfall"].fillna(0)

    df = df[["catchment_id", "date", "burned_area", "rainfall", "land_cover"]]
    df.to_csv("backend/outputs/final_dataset.csv", index=False)

    print(f"Number of rows: {len(df)}")
    print(df.head())


if __name__ == "__main__":
    main()
