from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import pandas as pd


app = Flask(__name__)
CORS(app)

DATASET_PATH = Path(__file__).resolve().parent / "outputs" / "final_dataset.csv"

df = pd.read_csv(DATASET_PATH)
df["date"] = pd.to_datetime(df["date"])
df["catchment_id"] = df["catchment_id"].astype(str)


@app.route("/query", methods=["GET"])
def query_data():
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

    return jsonify(subset.to_dict(orient="records"))


if __name__ == "__main__":
    app.run(debug=True)
