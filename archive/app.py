import geopandas as gpd
import matplotlib.pyplot as plt
import pandas as pd
import streamlit as st


st.set_page_config(layout="wide")

st.markdown("# 🌍 Geoinformatics Environmental Analysis Tool")
st.markdown("Analyze wildfire, rainfall, and land cover at catchment level")

df = pd.read_csv("outputs/final_dataset.csv")
catchments = gpd.read_file("data/Ancillary/global_catchments_cci/global_catchments_cci.shp")
catchments["catchment_id"] = catchments.index

df["date"] = pd.to_datetime(df["date"])
if "rainfall" in df.columns and df["rainfall"].dropna().lt(1).all():
    df["rainfall"] = df["rainfall"] * 1000

catchment_ids = sorted(df["catchment_id"].unique())
min_date = df["date"].min().date()
max_date = df["date"].max().date()

st.sidebar.header("Controls")
selected_id = st.sidebar.selectbox("Select Catchment", catchment_ids)
start_date = st.sidebar.date_input("Start date", min_date)
end_date = st.sidebar.date_input("End date", max_date)
run = st.sidebar.button("Run Analysis")

if run:
    subset = df[
        (df["catchment_id"] == selected_id)
        & (df["date"] >= pd.to_datetime(start_date))
        & (df["date"] <= pd.to_datetime(end_date))
    ].copy()

    if subset.empty:
        st.warning("No data available for selected filters.")
        st.stop()

    has_landcover = "land_cover" in subset.columns

    tab1, tab2, tab3 = st.tabs(["📊 Data", "📈 Analysis", "🗺 Map"])

    with tab1:
        st.subheader("Dataset")
        st.dataframe(subset, use_container_width=True)
        st.markdown("---")
        csv = subset.to_csv(index=False).encode("utf-8")
        st.download_button(
            label="Download CSV",
            data=csv,
            file_name=f"catchment_{selected_id}.csv",
            mime="text/csv",
        )

    with tab2:
        st.subheader("Key Metrics")
        col1, col2, col3 = st.columns(3)
        col1.metric("🔥 Avg Burned Area (m²)", round(subset["burned_area"].mean(), 2))
        col2.metric("🌧 Avg Rainfall (mm)", round(subset["rainfall"].mean(), 3))
        if has_landcover:
            col3.metric("🌱 Land Cover", int(subset["land_cover"].iloc[0]))
        else:
            col3.metric("🌱 Land Cover", "N/A")

        st.markdown("---")
        st.subheader("Burned Area Trend")
        fig1, ax1 = plt.subplots(figsize=(12, 5))
        ax1.plot(subset["date"], subset["burned_area"])
        ax1.set_title("Burned Area Over Time")
        ax1.set_xlabel("Date")
        ax1.set_ylabel("Burned Area (m²)")
        ax1.grid(True)
        st.pyplot(fig1)

        st.markdown("---")
        st.subheader("Rainfall Trend")
        fig2, ax2 = plt.subplots(figsize=(12, 5))
        ax2.plot(subset["date"], subset["rainfall"])
        ax2.set_title("Rainfall Over Time")
        ax2.set_xlabel("Date")
        ax2.set_ylabel("Rainfall (mm)")
        ax2.grid(True)
        st.pyplot(fig2)

    with tab3:
        st.subheader("Catchment Map")
        selected_geom = catchments[catchments["catchment_id"] == selected_id]

        if selected_geom.empty:
            st.error("Selected catchment not found in shapefile.")
        else:
            fig_map, ax_map = plt.subplots(figsize=(12, 8))
            catchments.plot(ax=ax_map, color="lightgray", edgecolor="black")
            selected_geom.plot(ax=ax_map, color="red")
            ax_map.set_title(f"Catchment {selected_id}")
            st.pyplot(fig_map)
