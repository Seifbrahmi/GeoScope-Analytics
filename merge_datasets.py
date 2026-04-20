from pathlib import Path

import pandas as pd
from spatial_aggregation import build_land_cover_lookup


BURNT_AREA_PATH = Path("backend/outputs/burned_area_timeseries.csv")
RAINFALL_PATH = Path("backend/outputs/rainfall_timeseries.csv")
FINAL_DATASET_PATH = Path("backend/outputs/final_dataset.csv")


def ensure_land_cover_column(fire: pd.DataFrame) -> pd.DataFrame:
    if "land_cover" in fire.columns:
        return fire

    print("land_cover missing from burned_area_timeseries.csv; recomputing from land cover rasters...")
    land_cover_lookup = build_land_cover_lookup()
    land_cover_df = pd.DataFrame(
        [
            {
                "catchment_id": catchment_id,
                "land_cover": pd.NA if pd.isna(land_cover) else int(land_cover),
            }
            for catchment_id, land_cover in land_cover_lookup.items()
        ]
    )

    fire = pd.merge(fire, land_cover_df, on="catchment_id", how="left")
    fire.to_csv(BURNT_AREA_PATH, index=False)
    print("Updated burned area timeseries with land_cover.")
    return fire


def main():
    fire = pd.read_csv(BURNT_AREA_PATH)
    rain = pd.read_csv(RAINFALL_PATH)

    fire["catchment_id"] = pd.to_numeric(fire["catchment_id"], errors="coerce").astype("Int64")
    rain["catchment_id"] = pd.to_numeric(rain["catchment_id"], errors="coerce").astype("Int64")
    fire = ensure_land_cover_column(fire)

    df = pd.merge(fire, rain, on=["catchment_id", "date"])
    df["rainfall"] = df["rainfall"].fillna(0)

    if "land_cover" not in df.columns:
        df["land_cover"] = pd.NA

    df = df[["catchment_id", "date", "burned_area", "rainfall", "land_cover"]]
    df.to_csv(FINAL_DATASET_PATH, index=False)

    print(f"Number of rows: {len(df)}")
    print("Columns:", df.columns.tolist())
    print("Missing land_cover values:", int(df["land_cover"].isna().sum()))
    print(df.head())


if __name__ == "__main__":
    main()
