import os
import glob
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask


LANDCOVER_DIR = "data/landcover/"
CATCHMENTS_PATH = "data/Ancillary/global_catchments_cci/global_catchments_cci.shp"


def extract_land_cover(catchments, catchment_id):
    lc_files = glob.glob(LANDCOVER_DIR + "*.tif")
    if not lc_files or catchment_id not in catchments.index:
        return np.nan

    geom = catchments.loc[catchment_id, "geometry"]
    if geom is None or geom.is_empty:
        return np.nan

    values = []

    for lc_file in lc_files:
        with rasterio.open(lc_file) as src:
            geom_mask = gpd.GeoSeries([geom], crs=catchments.crs).to_crs(src.crs).iloc[0]

            try:
                out_image, _ = mask(src, [geom_mask], crop=True, filled=False)
            except ValueError:
                continue

            band = out_image[0]
            if band.size == 0:
                continue

            if np.ma.isMaskedArray(band):
                data = band.compressed()
            else:
                data = band.ravel()

            if src.nodata is not None:
                data = data[data != src.nodata]

            data = data[data != 0]

            if data.size != 0:
                values.append(data)

    if not values:
        return np.nan

    values = np.concatenate(values)
    unique, counts = np.unique(values, return_counts=True)
    return unique[np.argmax(counts)]


def main():
    df = pd.read_csv("outputs/final_dataset.csv")
    catchments = gpd.read_file(CATCHMENTS_PATH)
    unique_ids = sorted(df["catchment_id"].unique())
    print(f"Total catchments: {len(unique_ids)}")
    print("Sample IDs:", unique_ids[:10])
    print("Enter a catchment ID from the available list")

    while True:
        while True:
            user_input = input("Enter catchment ID: ")

            try:
                catchment_id = int(user_input)
            except ValueError:
                print("Error: please enter a valid integer catchment ID.")
                continue

            if catchment_id not in unique_ids:
                print("Invalid ID. Please choose a valid catchment ID.")
                continue

            break

        if "catchment_id" in catchments.columns:
            selected = catchments[catchments["catchment_id"] == catchment_id]
        else:
            selected = catchments.loc[[catchment_id]]

        plt.figure()
        catchments.plot(color="lightgray", edgecolor="black")
        selected.plot(color="red")
        plt.title(f"Catchment {catchment_id} location")
        plt.xlabel("Longitude")
        plt.ylabel("Latitude")
        os.makedirs("outputs", exist_ok=True)
        map_path = f"outputs/catchment_{catchment_id}_map.png"
        plt.savefig(map_path)
        plt.close()
        print(f"Map saved to {map_path}")

        subset = df[df["catchment_id"] == catchment_id]

        print("-" * 40)
        if subset.empty:
            print("No data found for this catchment")
        else:
            subset = subset.copy()
            subset["date"] = pd.to_datetime(subset["date"])
            land_cover = extract_land_cover(catchments, catchment_id)
            print(f"Dominant land cover class: {land_cover}")

            while True:
                start_date = input("Enter start date (YYYY-MM): ").strip()
                end_date = input("Enter end date (YYYY-MM): ").strip()

                try:
                    start_date = pd.to_datetime(start_date)
                    end_date = pd.to_datetime(end_date)
                except ValueError:
                    print("Invalid date format. Please use YYYY-MM.")
                    continue

                filtered_subset = subset[
                    (subset["date"] >= start_date) & (subset["date"] <= end_date)
                ]

                if filtered_subset.empty:
                    print("No data available for this date range.")
                    continue

                subset = filtered_subset.copy()
                print(f"Showing data from {start_date.date()} to {end_date.date()}")
                break

            subset["land_cover"] = land_cover
            subset["rainfall_mm"] = subset["rainfall"] * 1000
            display_subset = subset[
                ["catchment_id", "date", "burned_area", "rainfall_mm", "land_cover"]
            ].rename(
                columns={
                    "burned_area": "burned_area (m²)",
                    "rainfall_mm": "rainfall (mm)",
                }
            )
            print(f"Data for catchment {catchment_id}:")
            print(display_subset.to_string(index=False))
            print(f"Average burned_area (m²): {subset['burned_area'].mean()}")
            print(f"Average rainfall (mm): {subset['rainfall_mm'].mean()}")

            export_choice = input("Do you want to export this dataset to CSV? (y/n): ")
            if export_choice.strip().lower() == "y":
                os.makedirs("outputs", exist_ok=True)
                filename = f"outputs/catchment_{catchment_id}.csv"
                export_subset = subset.copy()
                export_subset["rainfall"] = export_subset["rainfall"] * 1000
                export_subset = export_subset.rename(
                    columns={
                        "rainfall": "rainfall (mm)",
                        "burned_area": "burned_area (m²)",
                    }
                )
                export_subset = export_subset[
                    [
                        "catchment_id",
                        "date",
                        "burned_area (m²)",
                        "rainfall (mm)",
                        "land_cover",
                    ]
                ]
                export_subset.to_csv(filename, index=False)
                print(f"Dataset exported to {filename}")

            subset = subset.sort_values("date")

            plt.figure()
            plt.plot(subset["date"], subset["burned_area"])
            plt.title("Burned Area Over Time (m²)")
            plt.xlabel("Date")
            plt.ylabel("Burned Area (m²)")
            plt.grid(True)
            plt.savefig("outputs/plot_burned_area.png")
            plt.close()

            plt.figure()
            plt.plot(subset["date"], subset["rainfall_mm"])
            plt.title("Rainfall Over Time (mm)")
            plt.xlabel("Date")
            plt.ylabel("Rainfall (mm)")
            plt.grid(True)
            plt.savefig("outputs/plot_rainfall.png")
            plt.close()
            print("Plots saved in outputs folder")
        print("-" * 40)

        choice = input("Do you want to query another catchment? (y/n): ").strip().lower()
        if choice in ["y", "yes"]:
            continue
        elif choice in ["n", "no"]:
            print("Exiting tool.")
            break
        else:
            print("Invalid input. Please enter 'y' or 'n'.")
            continue


if __name__ == "__main__":
    main()
