# 🌍 GeoScope Analytics

A modern WebGIS application for environmental analysis at catchment level.

---

## 🚀 Overview

GeoScope Analytics allows users to explore environmental data including wildfire activity and rainfall across catchments in North America.

The platform combines geospatial analysis with an interactive web interface.

---

## 🧩 Features

- 🗺️ Interactive map with catchment selection  
- 🔥 Burned area (wildfire) analysis  
- 🌧 Rainfall analysis (monthly aggregation)  
- 📅 Time filtering by date range  
- 📊 Dynamic charts and tables  
- 📥 Export results as CSV  
- ⚡ Fast and user-friendly WebGIS interface  

---

## 🛠️ Technologies Used

### Backend
- Python  
- Flask  
- Pandas  

### Frontend
- HTML / CSS / JavaScript  
- Leaflet.js (maps)  
- Chart.js (charts)  

---

## 📁 Data Setup

Due to size limitations, the data is not included in this repository.

👉 Download the dataset from:  
https://drive.google.com/drive/folders/1eMI1XEMK9CmEjISjxoaz9LHOBLjpR1Uf?usp=sharing

---

### 📂 After downloading, place the files as follows:

```

project/
├── backend/
├── frontend/
│   └── data/
│       └── catchments.geojson
├── outputs/
│   └── final_dataset.csv

````

⚠️ Make sure the folder structure matches exactly before running the app.

---

## ▶️ How to Run the Project

### 1. Start Backend

```bash
cd backend
python api.py
````

### 2. Start Frontend

```bash
cd frontend
python -m http.server 8000
```

### 3. Open in Browser

```
http://localhost:8000
```

---

## 📊 Data Processing

* Spatial aggregation per catchment
* Temporal aggregation (monthly)
* Merging wildfire and rainfall datasets

---

## 🎯 Use Case

This tool helps analyze:

* Wildfire patterns
* Rainfall variability
* Environmental trends across regions

---

## 👤 Author

Seif Brahmi
Geoinformatics Engineer
Yousif Osama Yousif Ali
Geoinformatics Engineer
````

---

# 🎯 Next step

Now just run:

```bash
git add README.md
git commit -m "Finalize README"
git push
````
