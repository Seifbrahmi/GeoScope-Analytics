# 🌍 GeoScope Analytics

A WebGIS application for environmental analysis at catchment level, combining wildfire, rainfall, and hydrological context into an interactive mapping platform.

---

## 🚀 Features

### 🗺️ Interactive Map
- Select lakes directly from the map
- Automatic detection of the corresponding catchment
- Dynamic visualization and interaction

### 🔥 Wildfire Analysis
- Burned area computed per catchment
- Raster-based visualization (FireCCI data)
- Real-time burned area overlay on the map
- Monthly burned area time series

### 🌧️ Climate Analysis
- Rainfall aggregation (ERA5 data)
- Monthly rainfall trends per catchment

### 📊 Data Visualization
- Interactive charts (Chart.js)
- Time filtering (custom date range)
- Combined analysis (burned area + rainfall)

### 💧 Hydrological Insights
- Lake-to-catchment spatial linkage
- Lake coverage indicator (% of catchment area)
- Water presence classification:
  - Water-rich
  - Limited lake presence
  - No lake detected

### 📁 Data Export
- Export results as CSV

---

## 🗺️ Technologies

### Backend
- Python
- Flask (REST API)
- GeoPandas
- Rasterio
- NumPy / Pandas

### Frontend
- JavaScript
- Leaflet (interactive maps)
- Chart.js (visualization)
- HTML / CSS

---

## 📊 Data Sources

- FireCCI (Burned Area)
- ERA5 (Rainfall)
- Global Catchments (CCI)
- CCI Lakes dataset

---

## ⚙️ System Architecture

### 1. Spatial Aggregation
- Processes FireCCI rasters
- Computes burned area per catchment
- Extracts dominant land cover

### 2. Climate Aggregation
- Processes ERA5 rasters
- Computes rainfall per catchment

### 3. Data Integration
- Merges datasets into:
  final_dataset.csv

### 4. API Layer
- Serves:
  - Time series data
  - Burned area overlays (raster → PNG)
  - Lake and catchment geometries
  - Analysis summaries

---

## ▶️ How to Run

### 🔹 Backend

```bash
cd backend
pip install -r requirements.txt
# or manually:
pip install flask flask-cors geopandas rasterio shapely pillow numpy pandas

python api.py
```


Backend runs on:
http://127.0.0.1:5000

### 🔹 Frontend
```bash
cd frontend
python -m http.server 8000
```
Open:
http://localhost:8000
---
### 🔗 API Endpoints
/query

Retrieve analysis data

Parameters:

catchment_id
start_date
end_date

Returns:

Time series (burned area, rainfall, land cover)
Burned area overlay (PNG)
Hydrological summary
/lakes-overview
All lakes for map display
/lake-selection
Get catchment from selected lake
/lakes
Lakes within selected catchment
/land-cover
Dominant land cover per catchment
---
### 🧠 Key Logic
Catchment is determined dynamically from lake selection
Burned area:
Computed from rasters
Visualized via raster overlays
Rainfall:
Averaged per catchment
Data is aligned monthly
---
### 📌 Notes
Coordinate systems handled automatically (WGS84 ↔ projected CRS)
Raster clipping is performed per catchment
Overlays are generated dynamically
---
### 🎯 Use Case

Analyze environmental dynamics across North America:

Wildfire impact
Rainfall patterns
Water resource distribution
---
## 👨‍💻 Authors

- Seif Brahmi — Geoinformatics Engineer  
- Yousif Osama Yousif Ali — Geoinformatics Engineer