from flask import Flask, request, jsonify, send_from_directory, url_for
from flask_cors import CORS
from functools import lru_cache
from pathlib import Path
import json
import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.mask import mask
from rasterio.transform import array_bounds
from rasterio.warp import transform_bounds


app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent.parent
DATASET_PATH = Path(__file__).resolve().parent / "outputs" / "final_dataset.csv"
FIRECCI_DIR = BASE_DIR / "data" / "firecci"
OVERLAY_DIR = Path(__file__).resolve().parent / "outputs" / "burned_overlays"
OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
MAX_OVERLAY_DIMENSION = 1600
CATCHMENTS_PATH = BASE_DIR / "frontend" / "data" / "catchments.geojson"
CATCHMENT_ID_MAP_PATH = BASE_DIR / "frontend" / "data" / "catchment-id-map.json"


def load_dataset():
    dataset = pd.read_csv(DATASET_PATH)
    dataset["date"] = pd.to_datetime(dataset["date"])
    dataset["catchment_id"] = dataset["catchment_id"].astype(str)

    if "land_cover" in dataset.columns:
        dataset["land_cover"] = pd.to_numeric(dataset["land_cover"], errors="coerce")
    else:
        dataset["land_cover"] = pd.NA

    print("Dataset columns:", dataset.columns.tolist())
    print(dataset.head())
    return dataset


def serialize_records(frame: pd.DataFrame):
    records = frame.copy()
    if "date" in records.columns:
        records["date"] = records["date"].dt.strftime("%Y-%m")
    records["land_cover"] = records["land_cover"].apply(
        lambda value: None if pd.isna(value) else int(value)
    )
    return records.to_dict(orient="records")


@lru_cache(maxsize=1)
def load_catchment_geometries():
    if not CATCHMENTS_PATH.exists() or not CATCHMENT_ID_MAP_PATH.exists():
        return {}

    with CATCHMENT_ID_MAP_PATH.open("r", encoding="utf-8") as file:
        outlet_to_catchment = {
            str(outlet_id): str(catchment_id)
            for outlet_id, catchment_id in json.load(file).items()
        }

    with CATCHMENTS_PATH.open("r", encoding="utf-8") as file:
        geojson = json.load(file)

    geometries = {}
    for feature in geojson.get("features", []):
        properties = feature.get("properties") or {}
        outlet_id = properties.get("Outlet_id")
        if outlet_id is None:
            continue

        catchment_id = outlet_to_catchment.get(str(outlet_id))
        geometry = feature.get("geometry")
        if catchment_id and geometry:
            geometries[catchment_id] = geometry

    return geometries


def month_start_range(start_date: str, end_date: str):
    start = pd.to_datetime(start_date).to_period("M").to_timestamp()
    end = pd.to_datetime(end_date).to_period("M").to_timestamp()
    return pd.date_range(start=start, end=end, freq="MS")


def get_firecci_confidence_path(month_start: pd.Timestamp):
    filename = f"{month_start.strftime('%Y%m01')}-ESACCI-L3S_FIRE-BA-MODIS-AREA_1-fv5.1-CL.tif"
    path = FIRECCI_DIR / filename
    return path if path.exists() else None


def colorize_burned_area(confidence_grid: np.ndarray):
    rgba = np.zeros((confidence_grid.shape[0], confidence_grid.shape[1], 4), dtype=np.uint8)
    valid_mask = np.isfinite(confidence_grid) & (confidence_grid > 0)

    if not np.any(valid_mask):
        return rgba

    values = confidence_grid[valid_mask].astype(np.float32)
    lower = float(np.percentile(values, 5))
    upper = float(np.percentile(values, 98))

    if upper <= lower:
        upper = float(values.max())
        lower = float(values.min())

    span = max(upper - lower, 1.0)
    normalized = np.clip((confidence_grid.astype(np.float32) - lower) / span, 0, 1)
    normalized = np.power(normalized, 0.75)
    normalized_safe = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=0.0)

    palette = np.array([
        [254, 229, 217],
        [252, 174, 145],
        [251, 106, 74],
        [222, 45, 38],
        [165, 15, 21]
    ], dtype=np.float32)
    scaled = normalized_safe * (len(palette) - 1)
    low_index = np.floor(scaled).astype(np.int32)
    high_index = np.clip(low_index + 1, 0, len(palette) - 1)
    blend = (scaled - low_index)[..., None]
    colors = palette[low_index] * (1 - blend) + palette[high_index] * blend

    rgba[..., :3] = np.where(valid_mask[..., None], colors.astype(np.uint8), 0)
    rgba[..., 3] = np.where(valid_mask, np.clip(110 + normalized_safe * 145, 0, 255), 0).astype(np.uint8)
    return rgba


def get_leaflet_bounds(src):
    if src.crs is None or getattr(src.crs, "is_geographic", False):
        minx, miny, maxx, maxy = src.bounds
        return [[miny, minx], [maxy, maxx]]

    minx, miny, maxx, maxy = transform_bounds(
        src.crs,
        "EPSG:4326",
        *src.bounds,
        densify_pts=21
    )
    return [[miny, minx], [maxy, maxx]]


def build_overlay_bounds(transform, height: int, width: int):
    left, bottom, right, top = array_bounds(height, width, transform)
    return [[bottom, left], [top, right]]


def get_burned_area_legend():
    return {
        "title": "Burned Area Intensity",
        "min_label": "Low",
        "max_label": "High",
        "colors": ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
        "position": "bottomright"
    }


def build_burned_area_overlay(catchment_id: str, start_date: str, end_date: str):
    raster_paths = [
        path for path in (
            get_firecci_confidence_path(month_start)
            for month_start in month_start_range(start_date, end_date)
        )
        if path is not None
    ]

    if not raster_paths:
        return None

    catchment_geometries = load_catchment_geometries()
    catchment_geometry = catchment_geometries.get(str(catchment_id))
    if not catchment_geometry:
        return None

    overlay_name = (
        f"burned_area_{catchment_id}_{pd.to_datetime(start_date):%Y%m%d}_{pd.to_datetime(end_date):%Y%m%d}.png"
    )
    overlay_path = OVERLAY_DIR / overlay_name
    metadata_path = overlay_path.with_suffix(".json")

    if overlay_path.exists() and metadata_path.exists():
        with metadata_path.open("r", encoding="utf-8") as file:
            metadata = json.load(file)
        legend = {}
        legend.update(metadata.get("legend") or {})
        legend.update(get_burned_area_legend())
        return {
            "image_url": request.host_url.rstrip("/") + url_for("serve_overlay", filename=overlay_name),
            "bounds": metadata["bounds"],
            "opacity": 0.82,
            "legend": legend,
            "has_burned_data": bool(metadata.get("has_burned_data", True))
        }

    aggregate = None
    bounds = None

    for raster_path in raster_paths:
        with rasterio.open(raster_path) as src:
            clipped, clipped_transform = mask(
                src,
                [catchment_geometry],
                crop=True,
                filled=False
            )

            clipped_data = np.asarray(clipped[0], dtype=np.float32)
            clipped_data[np.ma.getmaskarray(clipped[0])] = np.nan
            aggregate = clipped_data if aggregate is None else np.fmax(aggregate, clipped_data)

            if bounds is None:
                bounds = build_overlay_bounds(
                    clipped_transform,
                    clipped_data.shape[0],
                    clipped_data.shape[1]
                )

    if aggregate is None or bounds is None:
        return None

    rgba = colorize_burned_area(aggregate)
    if not np.any(rgba[..., 3] > 0):
        return None

    image = Image.fromarray(rgba, mode="RGBA")
    if max(image.size) > MAX_OVERLAY_DIMENSION:
        scale = MAX_OVERLAY_DIMENSION / float(max(image.size))
        resized = (
            max(1, int(round(image.size[0] * scale))),
            max(1, int(round(image.size[1] * scale)))
        )
        image = image.resize(resized, Image.Resampling.LANCZOS)

    image.save(overlay_path, optimize=True)

    legend = get_burned_area_legend()

    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump({"bounds": bounds, "legend": legend, "has_burned_data": True}, file)

    return {
        "image_url": request.host_url.rstrip("/") + url_for("serve_overlay", filename=overlay_name),
        "bounds": bounds,
        "opacity": 0.82,
        "legend": legend,
        "has_burned_data": True
    }


@app.route("/overlays/<path:filename>", methods=["GET"])
def serve_overlay(filename: str):
    return send_from_directory(OVERLAY_DIR, filename)


@app.route("/query", methods=["GET"])
def query_data():
    df = load_dataset()
    requested_id = request.args.get("catchment_id")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    requested_id = str(requested_id)

    if requested_id not in df["catchment_id"].values:
        requested_id = df["catchment_id"].iloc[0]

    print("Requested ID:", requested_id)
    print("Available IDs:", df["catchment_id"].unique()[:10])

    subset = df[
        (df["catchment_id"] == requested_id)
        & (df["date"] >= start_date)
        & (df["date"] <= end_date)
    ]

    print(df.columns)
    print("Returning rows:", len(subset))
    print("land_cover available:", "land_cover" in subset.columns)
    return jsonify({
        "records": serialize_records(subset),
        "overlay": build_burned_area_overlay(requested_id, start_date, end_date)
    })


@app.route("/land-cover", methods=["GET"])
def land_cover_lookup():
    df = load_dataset()
    if "land_cover" not in df.columns:
        return jsonify({})

    lookup = {}

    for catchment_id, values in df.groupby("catchment_id")["land_cover"]:
        valid_values = values.dropna()
        if valid_values.empty:
            lookup[catchment_id] = None
            continue

        lookup[catchment_id] = int(valid_values.mode().iloc[0])

    return jsonify(lookup)


if __name__ == "__main__":
    app.run(debug=True)
