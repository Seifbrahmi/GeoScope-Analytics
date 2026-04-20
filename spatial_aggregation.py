from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask


RASTER_DIR = Path("data/firecci")
LANDCOVER_DIR = Path("data/landcover")
CATCHMENTS_PATH = Path("data/Ancillary/global_catchments_cci/global_catchments_cci.shp")
OUTPUT_PATH = Path("backend/outputs/burned_area_timeseries.csv")


def extract_date(raster_path: Path) -> str:
    """
    Extract date from filename robustly.
    Works with formats like:
    - FireCCI_2021_06.tif
    - FireCCI51_2021_06_NA.tif
    - 20210601-ESACCI-...
    """
    name = raster_path.stem

    # Case 1: YYYYMMDD format
    if name[:8].isdigit():
        year = name[:4]
        month = name[4:6]
        return f"{year}-{month}"

    # Case 2: split with underscores
    parts = name.split("_")

    for i, part in enumerate(parts):
        if part.isdigit() and len(part) == 4:  # year
            year = part
            if i + 1 < len(parts):
                month = parts[i + 1]
                return f"{year}-{month.zfill(2)}"

    return "unknown"


def extract_land_cover(catchments: gpd.GeoDataFrame, catchment_id: int) -> float:
    lc_files = sorted(LANDCOVER_DIR.glob("*.tif"))
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


def load_catchments() -> gpd.GeoDataFrame:
    catchments = gpd.read_file(CATCHMENTS_PATH)
    catchments = catchments.cx[-170:-50, 10:80]
    return catchments.to_crs(epsg=6933)


def build_land_cover_lookup(catchments: gpd.GeoDataFrame | None = None) -> dict[int, float]:
    if catchments is None:
        catchments = load_catchments()

    print("Computing dominant land cover per catchment...")
    return {
        idx: extract_land_cover(catchments, idx) for idx in catchments.index
    }


def main():
    print("Starting spatial aggregation...")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # load catchments (metric CRS)
    catchments = load_catchments()
    print(f"Number of catchments being processed: {len(catchments)}")

    land_cover_by_catchment = build_land_cover_lookup(catchments)

    raster_files = sorted([f for f in RASTER_DIR.glob("*.tif") if "-JD.tif" in f.name])
    print(f"Number of JD raster files: {len(raster_files)}")

    print("\nRaster files found:")
    for raster_path in raster_files:
        print(f"- {raster_path.name}")

    if not raster_files:
        print(f"Warning: no raster files found in {RASTER_DIR}")
        return

    # prepare mask CRS once
    with rasterio.open(raster_files[0]) as src:
        catchments_mask = catchments.to_crs(src.crs)

    results = []
    total_files = len(raster_files)

    for file_index, raster_path in enumerate(raster_files, start=1):
        print(f"\nProcessing file {file_index}/{total_files}: {raster_path.name}")

        date = extract_date(raster_path)
        print(f"Extracted date: {date}")

        with rasterio.open(raster_path) as src:
            total = len(catchments)

            for i, idx in enumerate(catchments.index):
                print(f"Processing catchment {i+1}/{total}")

                geom_metric = catchments.loc[idx, "geometry"]
                geom_mask = catchments_mask.loc[idx, "geometry"]
                burned_area = 0

                if (
                    geom_metric is not None
                    and not geom_metric.is_empty
                    and geom_mask is not None
                    and not geom_mask.is_empty
                ):
                    catchment_area = geom_metric.area

                    try:
                        out_image, _ = mask(src, [geom_mask], crop=True, filled=False)
                        band = out_image[0]

                        if band.size != 0:
                            # robust valid pixel handling
                            if np.ma.isMaskedArray(band):
                                valid_pixels = ~band.mask
                                data = band.data
                            else:
                                valid_pixels = ~np.isnan(band)
                                data = band

                            total_pixels = np.count_nonzero(valid_pixels)

                            if total_pixels != 0:
                                burned_pixels = np.count_nonzero(
                                    (data > 0) & valid_pixels
                                )
                                burned_ratio = burned_pixels / total_pixels
                                burned_area = burned_ratio * catchment_area
                    except ValueError:
                        burned_area = 0

                results.append(
                    {
                        "catchment_id": idx,
                        "date": date,
                        "burned_area": burned_area,
                        "land_cover": land_cover_by_catchment.get(idx, np.nan),
                    }
                )

    df = pd.DataFrame(results)
    df.to_csv(OUTPUT_PATH, index=False)

    print("\nDone!")
    print("Columns:", df.columns.tolist())
    print(df.head())
    print(f"Results saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
