from flask import Flask, request, jsonify, send_from_directory, url_for
from flask_cors import CORS
from functools import lru_cache
from pathlib import Path
import geopandas as gpd
import json
import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.mask import mask
from rasterio.transform import array_bounds
from rasterio.warp import transform, transform_bounds, transform_geom
from shapely.geometry import box, shape


app = Flask(__name__)
CORS(app, resources={
    r"/*": {
        "origins": [
            "http://localhost:8000",
            "http://127.0.0.1:8000"
        ]
    }
})

BASE_DIR = Path(__file__).resolve().parent.parent
DATASET_PATH = Path(__file__).resolve().parent / "outputs" / "final_dataset.csv"
FIRECCI_DIR = BASE_DIR / "data" / "firecci"
OVERLAY_DIR = Path(__file__).resolve().parent / "outputs" / "burned_overlays"
OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
MAX_OVERLAY_DIMENSION = 1600
CATCHMENTS_PATH = BASE_DIR / "frontend" / "data" / "catchments.geojson"
CATCHMENT_ID_MAP_PATH = BASE_DIR / "frontend" / "data" / "catchment-id-map.json"
LAKES_PATH = BASE_DIR / "data" / "Ancillary" / "CCILakesV202.shp"
NORTH_AMERICA_BOUNDS = {
    "min_lon": -170,
    "max_lon": -50,
    "min_lat": 5,
    "max_lat": 85,
}
LAKE_SIMPLIFY_TOLERANCE = 0.001
BURNED_PIXEL_THRESHOLD = 0.0


def load_dataset():
    dataset = pd.read_csv(DATASET_PATH)
    dataset["date"] = pd.to_datetime(dataset["date"])
    dataset["catchment_id"] = dataset["catchment_id"].astype(str)

    if "burned_area" in dataset.columns:
        dataset["burned_area"] = pd.to_numeric(dataset["burned_area"], errors="coerce")
    else:
        dataset["burned_area"] = 0.0

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


@lru_cache(maxsize=1)
def load_catchments_gdf():
    geometries = load_catchment_geometries()
    if not geometries:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    catchments = gpd.GeoDataFrame(
        [
            {"catchment_id": catchment_id, "geometry": shape(geometry)}
            for catchment_id, geometry in geometries.items()
        ],
        geometry="geometry",
        crs="EPSG:4326"
    )
    return catchments


@lru_cache(maxsize=1)
def load_lakes_dataset():
    if not LAKES_PATH.exists():
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    lakes_gdf = gpd.read_file(LAKES_PATH)
    if lakes_gdf.crs is None:
        lakes_gdf = lakes_gdf.set_crs(epsg=4326)
    elif lakes_gdf.crs.to_epsg() != 4326:
        lakes_gdf = lakes_gdf.to_crs(epsg=4326)

    lakes_gdf = lakes_gdf.cx[
        NORTH_AMERICA_BOUNDS["min_lon"]:NORTH_AMERICA_BOUNDS["max_lon"],
        NORTH_AMERICA_BOUNDS["min_lat"]:NORTH_AMERICA_BOUNDS["max_lat"]
    ].copy()

    if not lakes_gdf.empty:
        lakes_gdf["geometry"] = lakes_gdf.geometry.simplify(
            LAKE_SIMPLIFY_TOLERANCE,
            preserve_topology=True
        )
        lakes_gdf = lakes_gdf[~lakes_gdf.geometry.is_empty].copy()

    return lakes_gdf


@lru_cache(maxsize=1)
def load_lakes_with_catchments():
    lakes_gdf = load_lakes_dataset().copy()
    catchments_gdf = load_catchments_gdf()

    if lakes_gdf.empty or catchments_gdf.empty:
        lakes_gdf["catchment_id"] = None
        return lakes_gdf

    lake_points = lakes_gdf[["Lake_ID", "geometry"]].copy()
    lake_points["geometry"] = lake_points.geometry.representative_point()
    joined = gpd.sjoin(
        lake_points,
        catchments_gdf[["catchment_id", "geometry"]],
        how="left",
        predicate="within"
    )

    lakes_gdf["catchment_id"] = joined["catchment_id"].astype("string").where(joined["catchment_id"].notna(), None)
    return lakes_gdf


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


def get_catchment_shape(catchment_id: str):
    catchment_geometry = load_catchment_geometries().get(str(catchment_id))
    return shape(catchment_geometry) if catchment_geometry else None


def normalize_lake_id(value):
    if value is None or pd.isna(value):
        return None

    try:
        numeric_value = float(value)
        if numeric_value.is_integer():
            return str(int(numeric_value))
    except (TypeError, ValueError):
        pass

    return str(value)


def get_lake_record(lake_id: str):
    lakes_gdf = load_lakes_with_catchments()
    if lakes_gdf.empty:
        return None

    normalized_id = normalize_lake_id(lake_id)
    matches = lakes_gdf[lakes_gdf["Lake_ID"].apply(normalize_lake_id) == normalized_id]
    if matches.empty:
        return None

    return matches.iloc[0]


def resolve_catchment_id_for_lake_geometry(lake_geometry):
    catchments_gdf = load_catchments_gdf()
    if lake_geometry is None or catchments_gdf.empty:
        return None

    representative_point = lake_geometry.representative_point()
    containing_matches = catchments_gdf[catchments_gdf.geometry.contains(representative_point)]
    if not containing_matches.empty:
        return str(containing_matches.iloc[0]["catchment_id"])

    intersecting_matches = catchments_gdf[catchments_gdf.geometry.intersects(lake_geometry)]
    if not intersecting_matches.empty:
        intersecting_matches = intersecting_matches.assign(
            intersection_area=intersecting_matches.geometry.intersection(lake_geometry).area
        )
        best_match = intersecting_matches.sort_values("intersection_area", ascending=False).iloc[0]
        return str(best_match["catchment_id"])

    return None


def get_catchment_id_for_lake(lake_id: str):
    lake_record = get_lake_record(lake_id)
    if lake_record is None:
        return None

    catchment_id = lake_record.get("catchment_id")
    if catchment_id is not None and not pd.isna(catchment_id):
        return str(catchment_id)

    return resolve_catchment_id_for_lake_geometry(lake_record.geometry)


def get_metric_crs():
    return "EPSG:3857"


def get_burned_area_legend():
    return {
        "title": "Burned Area Intensity",
        "min_label": "Low",
        "max_label": "High",
        "colors": ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
        "position": "bottomright"
    }


def get_burned_overlay_paths(catchment_id: str, start_date: str, end_date: str):
    overlay_name = (
        f"burned_area_{catchment_id}_{pd.to_datetime(start_date):%Y%m%d}_{pd.to_datetime(end_date):%Y%m%d}.png"
    )
    overlay_path = OVERLAY_DIR / overlay_name
    metadata_path = overlay_path.with_suffix(".json")
    return overlay_name, overlay_path, metadata_path


def build_burned_raster_bundle(catchment_id: str, start_date: str, end_date: str):
    monthly_rasters = [
        (month_start, raster_path)
        for month_start in month_start_range(start_date, end_date)
        for raster_path in [get_firecci_confidence_path(month_start)]
        if raster_path is not None
    ]

    if not monthly_rasters:
        app.logger.warning(
            "No burned raster files found for catchment=%s range=%s..%s",
            catchment_id,
            start_date,
            end_date
        )
        return None

    catchment_shape = get_catchment_shape(catchment_id)
    if catchment_shape is None:
        return None

    aggregate = None
    bounds = None
    monthly_burned_area = {}
    monthly_pixel_stats = {}
    raster_count = 0
    raster_tiles_used = []

    for month_start, raster_path in monthly_rasters:
        month_key = month_start.strftime("%Y-%m")

        try:
            with rasterio.open(raster_path) as src:
                raster_count += 1
                raster_tiles_used.append(raster_path.name)
                print(f"[burned_overlay] raster loaded successfully: {raster_path}")
                clipped_data, valid_mask, clipped_transform = clip_burned_raster(src, catchment_shape)
                debug_stats = summarize_clipped_burned_data(clipped_data, valid_mask)
                pixel_count = int(clipped_data.size)
                burned_area_ha, burned_pixel_count, valid_pixel_count = compute_burned_area_hectares(
                    clipped_data,
                    valid_mask,
                    clipped_transform,
                    src.crs
                )
                forced_burned_pixel_count = int(np.count_nonzero(valid_mask & (clipped_data > 0)))
        except Exception as error:
            app.logger.warning(
                "Burned raster processing failed for catchment=%s month=%s file=%s: %s",
                catchment_id,
                month_key,
                raster_path,
                error
            )
            monthly_burned_area[month_key] = 0.0
            monthly_pixel_stats[month_key] = {
                "pixel_count": 0,
                "valid_pixel_count": 0,
                "burned_pixel_count": 0
            }
            continue

        monthly_burned_area[month_key] = round(burned_area_ha, 2)
        monthly_pixel_stats[month_key] = {
            "pixel_count": pixel_count,
            "valid_pixel_count": valid_pixel_count,
            "burned_pixel_count": burned_pixel_count
        }
        print(
            f"[burned_overlay] catchment={catchment_id} month={month_key} "
            f"raster_used={raster_path.name} "
            f"clipped_shape={clipped_data.shape} "
            f"total_pixels={debug_stats['total_pixels']} "
            f"valid_pixels={debug_stats['valid_pixels']} "
            f"min={debug_stats['min'] if debug_stats['min'] is not None else 'nan'} "
            f"max={debug_stats['max'] if debug_stats['max'] is not None else 'nan'} "
            f"mean={debug_stats['mean'] if debug_stats['mean'] is not None else 'nan'} "
            f"unique_sample={debug_stats['unique_sample']} "
            f"pixels_gt_0={debug_stats['count_gt_0']} "
            f"pixels_gt_10={debug_stats['count_gt_10']} "
            f"pixels_gt_20={debug_stats['count_gt_20']} "
            f"threshold={BURNED_PIXEL_THRESHOLD} "
            f"burned_pixels={burned_pixel_count} "
            f"forced_gt_0_burned_pixels={forced_burned_pixel_count} "
            f"burned_area_ha={monthly_burned_area[month_key]}"
        )

        if valid_pixel_count == 0:
            continue

        if aggregate is None:
            aggregate = clipped_data if aggregate is None else np.fmax(aggregate, clipped_data)
            if bounds is None:
                bounds = build_overlay_bounds(
                    clipped_transform,
                    clipped_data.shape[0],
                    clipped_data.shape[1]
                )
            continue

        aggregate = np.fmax(aggregate, clipped_data)

    if aggregate is None or bounds is None:
        app.logger.warning(
            "Burned raster clipping returned no valid pixels for catchment=%s range=%s..%s",
            catchment_id,
            start_date,
            end_date
        )
        return {
            "bounds": None,
            "aggregate": None,
            "monthly_burned_area": monthly_burned_area,
            "monthly_pixel_stats": monthly_pixel_stats,
            "has_burned_data": False,
            "raster_count": raster_count,
            "raster_tiles_used": raster_tiles_used
        }

    has_burned_data = bool(np.any(np.isfinite(aggregate) & (aggregate > BURNED_PIXEL_THRESHOLD)))

    return {
        "bounds": bounds,
        "aggregate": aggregate,
        "monthly_burned_area": monthly_burned_area,
        "monthly_pixel_stats": monthly_pixel_stats,
        "has_burned_data": has_burned_data,
        "raster_count": raster_count,
        "raster_tiles_used": raster_tiles_used
    }


def build_burned_area_overlay(catchment_id: str, start_date: str, end_date: str, raster_bundle=None):
    raster_paths = [
        get_firecci_confidence_path(month)
        for month in month_start_range(start_date, end_date)
    ]
    raster_paths = [p for p in raster_paths if p is not None]

    if not raster_paths:
        print(f"[burned_overlay] No rasters found for {start_date} → {end_date}")
        return None

    catchment_geometry = load_catchment_geometries().get(str(catchment_id))
    if not catchment_geometry:
        print(f"[burned_overlay] No geometry for catchment {catchment_id}")
        return None

    aggregate = None
    bounds = None

    for raster_path in raster_paths:
        try:
            with rasterio.open(raster_path) as src:
                clipped, transform = mask(
                    src,
                    [catchment_geometry],
                    crop=True,
                    filled=False
                )

                data = np.asarray(clipped[0], dtype=np.float32)
                data[np.ma.getmaskarray(clipped[0])] = np.nan

                if np.all(np.isnan(data)):
                    continue

                aggregate = data if aggregate is None else np.fmax(aggregate, data)

                if bounds is None:
                    bounds = build_overlay_bounds(
                        transform,
                        data.shape[0],
                        data.shape[1]
                    )

        except Exception as e:
            print(f"[burned_overlay] ERROR reading {raster_path}: {e}")
            continue

    if aggregate is None or bounds is None:
        print(f"[burned_overlay] No valid burned data after clipping")
        return None

    rgba = colorize_burned_area(aggregate)

    if not np.any(rgba[..., 3] > 0):
        print(f"[burned_overlay] Image fully transparent → no burned pixels visible")
        return None

    overlay_name = f"burned_{catchment_id}.png"
    overlay_path = OVERLAY_DIR / overlay_name

    image = Image.fromarray(rgba, mode="RGBA")

    if max(image.size) > MAX_OVERLAY_DIMENSION:
        scale = MAX_OVERLAY_DIMENSION / float(max(image.size))
        image = image.resize(
            (
                int(image.size[0] * scale),
                int(image.size[1] * scale)
            ),
            Image.Resampling.LANCZOS
        )

    image.save(overlay_path, optimize=True)

    print(f"[burned_overlay] ✅ CREATED → {overlay_path}")

    return {
        "image_url": request.host_url.rstrip("/") + url_for("serve_overlay", filename=overlay_name),
        "bounds": bounds,
        "opacity": 0.8,
        "legend": get_burned_area_legend(),
        "has_burned_data": True
    }


def build_safe_analysis_record(catchment_id: str, start_date: str):
    fallback_month = None

    if start_date:
        try:
            fallback_month = pd.to_datetime(start_date).to_period("M").to_timestamp()
        except (TypeError, ValueError):
            fallback_month = None

    return {
        "catchment_id": str(catchment_id) if catchment_id else "",
        "date": fallback_month,
        "burned_area": 0.0,
        "rainfall": 0.0,
        "land_cover": None
    }


def build_safe_analysis_response(catchment_id: str, start_date: str, warning: str, summary=None):
    return {
        "records": [build_safe_analysis_record(catchment_id, start_date)],
        "overlay": None,
        "summary": summary if summary is not None else {
            "lake_coverage_percent": 0.0,
            "water_insight": "Analysis unavailable"
        },
        "warning": warning
    }


def get_catchment_geometry_for_raster(src, catchment_shape):
    geometry = catchment_shape.__geo_interface__

    if src.crs is None:
        return geometry

    if str(src.crs).upper() == "EPSG:4326":
        return geometry

    return transform_geom("EPSG:4326", src.crs, geometry)


def raster_intersects_catchment(src, catchment_shape):
    if src.crs is None:
        catchment_geometry = catchment_shape
    else:
        catchment_geometry = shape(get_catchment_geometry_for_raster(src, catchment_shape))

    return box(*src.bounds).intersects(catchment_geometry)


def clip_burned_raster(src, catchment_shape):
    clipped, clipped_transform = mask(
        src,
        [get_catchment_geometry_for_raster(src, catchment_shape)],
        crop=True,
        filled=False
    )

    clipped_band = clipped[0]
    clipped_data = np.asarray(clipped_band, dtype=np.float32)
    valid_mask = ~np.ma.getmaskarray(clipped_band)

    if src.nodata is not None:
        valid_mask &= clipped_data != src.nodata

    valid_mask &= np.isfinite(clipped_data)
    clipped_data[~valid_mask] = np.nan
    return clipped_data, valid_mask, clipped_transform


def summarize_clipped_burned_data(clipped_data: np.ndarray, valid_mask: np.ndarray):
    total_pixels = int(clipped_data.size)
    valid_pixel_count = int(np.count_nonzero(valid_mask))

    if valid_pixel_count == 0:
        return {
            "total_pixels": total_pixels,
            "valid_pixels": 0,
            "min": None,
            "max": None,
            "mean": None,
            "unique_sample": [],
            "count_gt_0": 0,
            "count_gt_10": 0,
            "count_gt_20": 0,
        }

    valid_values = clipped_data[valid_mask]
    unique_sample = np.unique(valid_values)[:20]

    return {
        "total_pixels": total_pixels,
        "valid_pixels": valid_pixel_count,
        "min": float(np.nanmin(valid_values)),
        "max": float(np.nanmax(valid_values)),
        "mean": float(np.nanmean(valid_values)),
        "unique_sample": unique_sample.tolist(),
        "count_gt_0": int(np.count_nonzero(valid_values > 0)),
        "count_gt_10": int(np.count_nonzero(valid_values > 10)),
        "count_gt_20": int(np.count_nonzero(valid_values > 20)),
    }


def get_pixel_area_by_row_hectares(transform_matrix, row_index: int, source_crs):
    pixel_width = abs(float(transform_matrix.a))
    pixel_height = abs(float(transform_matrix.e))

    if source_crs is not None and not getattr(source_crs, "is_geographic", False):
        return (pixel_width * pixel_height) / 10000.0

    left = float(transform_matrix.c)
    top = float(transform_matrix.f + (row_index * transform_matrix.e))
    bottom = float(top + transform_matrix.e)
    right = float(left + transform_matrix.a)

    xs, ys = transform(
        source_crs or "EPSG:4326",
        get_metric_crs(),
        [left, right, left],
        [top, top, bottom]
    )
    width_m = abs(xs[1] - xs[0])
    height_m = abs(ys[0] - ys[2])
    return (width_m * height_m) / 10000.0


def compute_burned_area_hectares(clipped_data: np.ndarray, valid_mask: np.ndarray, clipped_transform, source_crs):
    burned_mask = valid_mask & (clipped_data >= BURNED_PIXEL_THRESHOLD)
    burned_pixel_count = int(np.count_nonzero(burned_mask))
    valid_pixel_count = int(np.count_nonzero(valid_mask))

    if burned_pixel_count == 0:
        return 0.0, burned_pixel_count, valid_pixel_count

    burned_rows, burned_counts = np.unique(np.where(burned_mask)[0], return_counts=True)
    area_hectares = 0.0

    for row_index, row_count in zip(burned_rows.tolist(), burned_counts.tolist()):
        area_hectares += row_count * get_pixel_area_by_row_hectares(
            clipped_transform,
            row_index,
            source_crs
        )

    return float(area_hectares), burned_pixel_count, valid_pixel_count


def build_monthly_burned_area_lookup(catchment_id: str, start_date: str, end_date: str):
    raster_bundle = build_burned_raster_bundle(catchment_id, start_date, end_date)
    if not raster_bundle:
        return {}

    return raster_bundle.get("monthly_burned_area", {})


def build_analysis_records(dataset: pd.DataFrame, catchment_id: str, start_timestamp, end_timestamp):
    monthly_index = pd.DataFrame({
        "date": month_start_range(start_timestamp, end_timestamp)
    })

    subset = dataset[
        (dataset["catchment_id"] == catchment_id)
        & (dataset["date"] >= start_timestamp)
        & (dataset["date"] <= end_timestamp)
    ].copy()
    print(f"[analysis] catchment_id={catchment_id} dataset_rows_found={len(subset)}")
    print(f"[analysis] catchment_id={catchment_id} dataset_burned_area_values={subset['burned_area'].tolist() if 'burned_area' in subset.columns else []}")

    dataset_columns = [column for column in ["catchment_id", "date", "burned_area", "rainfall", "land_cover"] if column in subset.columns]
    subset = subset[dataset_columns]

    if subset.empty:
        records = monthly_index.copy()
    else:
        records = monthly_index.merge(subset, on="date", how="left")

    if "catchment_id" not in records.columns:
        records["catchment_id"] = str(catchment_id)
    else:
        records["catchment_id"] = records["catchment_id"].fillna(str(catchment_id))
    if "rainfall" not in records.columns:
        records["rainfall"] = 0.0
    else:
        records["rainfall"] = pd.to_numeric(records["rainfall"], errors="coerce").fillna(0.0)

    if "burned_area" not in records.columns:
        records["burned_area"] = 0.0
    else:
        records["burned_area"] = pd.to_numeric(records["burned_area"], errors="coerce").fillna(0.0)

    if "land_cover" not in records.columns:
        records["land_cover"] = pd.NA

    preferred_columns = ["catchment_id", "date", "burned_area", "rainfall", "land_cover"]
    return records[preferred_columns]


def build_lakes_overview_geojson():
    lakes_gdf = load_lakes_with_catchments()
    if lakes_gdf.empty:
        return {"type": "FeatureCollection", "features": []}

    overview = lakes_gdf[["Lake_ID", "catchment_id", "geometry"]].copy()
    overview["geometry"] = overview.geometry.simplify(0.002, preserve_topology=True)
    overview = overview[overview.geometry.notna() & ~overview.geometry.is_empty]
    return json.loads(overview.to_json())


def build_lake_selection_payload(lake_id: str):
    catchment_id = get_catchment_id_for_lake(lake_id)
    lake_record = get_lake_record(lake_id)

    if lake_record is None:
        return None

    payload = {
        "lake_id": normalize_lake_id(lake_record["Lake_ID"]),
        "catchment_id": catchment_id,
        "lake_label": "Lake " + normalize_lake_id(lake_record["Lake_ID"]) if not pd.isna(lake_record["Lake_ID"]) else "Unknown lake"
    }

    if catchment_id is None:
        payload["catchment"] = None
        return payload

    catchment_shape = get_catchment_shape(catchment_id)
    payload["catchment"] = {
        "type": "Feature",
        "properties": {"catchment_id": catchment_id},
        "geometry": catchment_shape.__geo_interface__
    } if catchment_shape is not None else None
    return payload


def get_clipped_lakes_gdf(catchment_id: str):
    catchment_shape = get_catchment_shape(catchment_id)
    if catchment_shape is None:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    lakes_gdf = load_lakes_dataset()
    if lakes_gdf.empty:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    minx, miny, maxx, maxy = catchment_shape.bounds
    candidate_lakes = lakes_gdf.cx[minx:maxx, miny:maxy]
    if candidate_lakes.empty:
        return candidate_lakes.copy()

    catchment_gdf = gpd.GeoDataFrame(
        [{"catchment_id": str(catchment_id), "geometry": catchment_shape}],
        geometry="geometry",
        crs="EPSG:4326"
    )

    clipped_lakes = gpd.overlay(candidate_lakes, catchment_gdf, how="intersection", keep_geom_type=False)
    return clipped_lakes


def build_lakes_geojson(catchment_id: str):
    clipped_lakes = get_clipped_lakes_gdf(catchment_id)
    if clipped_lakes.empty:
        return {"type": "FeatureCollection", "features": []}

    clipped_lakes = clipped_lakes[["Lake_ID", "geometry"]].copy()
    return json.loads(clipped_lakes.to_json())


def build_lake_indicators(catchment_id: str):
    catchment_shape = get_catchment_shape(catchment_id)
    if catchment_shape is None:
        return {
            "lake_coverage_percent": 0.0,
            "water_insight": "Catchment geometry unavailable"
        }

    catchment_gdf = gpd.GeoDataFrame(
        [{"catchment_id": str(catchment_id), "geometry": catchment_shape}],
        geometry="geometry",
        crs="EPSG:4326"
    )
    clipped_lakes = get_clipped_lakes_gdf(catchment_id)

    metric_crs = get_metric_crs()
    catchment_metric = catchment_gdf.to_crs(metric_crs)
    catchment_area = float(catchment_metric.geometry.area.iloc[0])

    lake_coverage_percent = 0.0

    if not clipped_lakes.empty:
        lakes_metric = clipped_lakes.to_crs(metric_crs)
        total_lake_area = float(lakes_metric.geometry.area.sum())
        if catchment_area > 0:
            lake_coverage_percent = (total_lake_area / catchment_area) * 100.0

    if lake_coverage_percent >= 5:
        water_insight = "Water-rich area"
    elif clipped_lakes.empty:
        water_insight = "No lake detected in this catchment"
    else:
        water_insight = "Limited lake presence"

    return {
        "lake_coverage_percent": round(lake_coverage_percent, 2),
        "water_insight": water_insight
    }


@app.route("/overlays/<path:filename>", methods=["GET"])
def serve_overlay(filename: str):
    return send_from_directory(OVERLAY_DIR, filename)


@app.route("/query", methods=["GET"])
def query_data():
    try:
        df = load_dataset()
        requested_id = request.args.get("catchment_id")
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if not requested_id or not start_date or not end_date:
            return jsonify({
                "error": "Missing required query parameters: catchment_id, start_date, end_date"
            }), 400

        requested_id = str(requested_id)

        try:
            start_timestamp = pd.to_datetime(start_date)
            end_timestamp = pd.to_datetime(end_date)
        except (TypeError, ValueError):
            return jsonify({
                "error": "Invalid date format. Expected YYYY-MM-DD."
            }), 400

        if start_timestamp > end_timestamp:
            return jsonify({
                "error": "start_date must be earlier than or equal to end_date."
            }), 400

        print("Requested ID:", requested_id)

        if requested_id not in df["catchment_id"].values:
            print("Filtered rows:", 0)
            return jsonify(build_safe_analysis_response(
                requested_id,
                start_date,
                f"Unknown catchment_id: {requested_id}",
                summary={
                    "lake_coverage_percent": 0.0,
                    "water_insight": "Catchment not found"
                }
            ))

        print("Available IDs:", df["catchment_id"].unique()[:10])

        subset = df[
            (df["catchment_id"] == requested_id)
            & (df["date"] >= start_timestamp)
            & (df["date"] <= end_timestamp)
        ].copy()
        print("Filtered rows:", len(subset))

        try:
            analysis_records = build_analysis_records(
                df,
                requested_id,
                start_timestamp,
                end_timestamp
            )
        except Exception as error:
            app.logger.warning("Analysis record assembly failed for catchment=%s: %s", requested_id, error)
            analysis_records = pd.DataFrame([build_safe_analysis_record(requested_id, start_date)])

        try:
            overlay = build_burned_area_overlay(
                requested_id,
                start_date,
                end_date
            )
        except Exception as error:
            app.logger.warning("Burned overlay build failed for catchment=%s: %s", requested_id, error)
            overlay = None
        print(f"[analysis] catchment_id={requested_id} overlay_response={overlay}")

        try:
            summary = build_lake_indicators(requested_id)
        except Exception as error:
            app.logger.warning("Lake summary build failed for catchment=%s: %s", requested_id, error)
            summary = {
                "lake_coverage_percent": 0.0,
                "water_insight": "Analysis summary unavailable"
            }

        print(df.columns)
        print("Returning rows:", len(analysis_records))
        print("land_cover available:", "land_cover" in analysis_records.columns)
        return jsonify({
            "records": serialize_records(analysis_records),
            "overlay": overlay,
            "summary": summary
        })
    except Exception as error:
        app.logger.exception("Query request failed")
        return jsonify(build_safe_analysis_response(
            request.args.get("catchment_id") or "",
            request.args.get("start_date"),
            "Backend failed to process the analysis request.",
            summary={
                "lake_coverage_percent": 0.0,
                "water_insight": "Analysis unavailable"
            }
        )), 200


@app.route("/lakes", methods=["GET"])
def lakes_data():
    catchment_id = request.args.get("catchment_id")
    if catchment_id is None:
        return jsonify({"type": "FeatureCollection", "features": []})

    return jsonify(build_lakes_geojson(str(catchment_id)))


@app.route("/lakes-overview", methods=["GET"])
def lakes_overview():
    return jsonify(build_lakes_overview_geojson())


@app.route("/lake-selection", methods=["GET"])
def lake_selection():
    lake_id = request.args.get("lake_id")
    if not lake_id:
        return jsonify({}), 400

    payload = build_lake_selection_payload(str(lake_id))
    if payload is None:
        return jsonify({}), 404

    return jsonify(payload)


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
