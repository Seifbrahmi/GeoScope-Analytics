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
project/
├── backend/
├── frontend/
│ └── data/
│ └── catchments.geojson
├── outputs/
│ └── final_dataset.csv

⚠️ Make sure the folder structure matches exactly before running the app.

---

## ▶️ How to Run the Project

### 1. Start Backend

```bash
cd backend
python api.py
cd frontend
python -m http.server 8000
