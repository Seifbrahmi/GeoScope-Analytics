var map = L.map("map").setView([40, -100], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

var catchmentsLayer = null;
var resultsChart = null;
var activeCatchmentId = null;
var currentResults = [];
var landcoverOverlay = null;

var catchmentSelect = document.getElementById("catchmentSelect");
var startDateInput = document.getElementById("start-date");
var endDateInput = document.getElementById("end-date");
var runButton = document.getElementById("run-analysis");
var exportButton = document.getElementById("export-csv");
var avgBurnedArea = document.getElementById("avg-burned-area");
var avgRainfall = document.getElementById("avg-rainfall");
var dominantLandCover = document.getElementById("dominant-land-cover");

var landCoverMap = {
    1: "Forest",
    2: "Cropland",
    3: "Urban"
};

function setStatus(message, isError) {
    var status = document.getElementById("status-message");
    status.textContent = message;
    status.style.color = isError ? "#ff7a90" : "#98abc7";
}

function setLoadingState(isLoading) {
    runButton.disabled = isLoading;
    runButton.textContent = isLoading ? "Running..." : "Run Analysis";
}

function getFeatureCatchmentId(feature) {
    return feature.properties.Outlet_id || feature.properties.Hylak_id || feature.properties.fid;
}

function getDefaultStyle() {
    return {
        color: "rgba(188, 201, 219, 0.45)",
        weight: 1,
        fillColor: "#9aa5b1",
        fillOpacity: 0.12
    };
}

function getHoverStyle() {
    return {
        color: "#7ce8ce",
        weight: 2,
        fillColor: "#7ce8ce",
        fillOpacity: 0.2
    };
}

function getSelectedStyle() {
    return {
        color: "#ff916b",
        weight: 3,
        fillColor: "#ff916b",
        fillOpacity: 0.34
    };
}

function resetLayerStyle(layer) {
    var id = getFeatureCatchmentId(layer.feature);
    if (String(id) === String(activeCatchmentId)) {
        layer.setStyle(getSelectedStyle());
    } else {
        layer.setStyle(getDefaultStyle());
    }
}

function highlightCatchment(id) {
    activeCatchmentId = id;
    if (!catchmentsLayer) {
        return;
    }

    catchmentsLayer.eachLayer(function (layer) {
        if (String(getFeatureCatchmentId(layer.feature)) === String(id)) {
            layer.setStyle(getSelectedStyle());
            map.fitBounds(layer.getBounds(), { padding: [24, 24] });
        } else {
            layer.setStyle(getDefaultStyle());
        }
    });
}

function renderTable(data) {
    var container = document.getElementById("table-container");

    if (!data.length) {
        container.innerHTML = '<p class="placeholder">No results returned for the selected filters.</p>';
        return;
    }

    var formattedData = data.map(function (row) {
        var formattedRow = Object.assign({}, row);
        if (formattedRow.land_cover !== undefined && formattedRow.land_cover !== null && formattedRow.land_cover !== "") {
            formattedRow.land_cover = landCoverMap[Number(formattedRow.land_cover)] || formattedRow.land_cover;
        }
        return formattedRow;
    });

    var columns = Object.keys(formattedData[0]);
    var header = columns.map(function (column) {
        return "<th>" + column + "</th>";
    }).join("");

    var rows = formattedData.map(function (row) {
        return "<tr>" + columns.map(function (column) {
            return "<td>" + row[column] + "</td>";
        }).join("") + "</tr>";
    }).join("");

    container.innerHTML =
        "<table><thead><tr>" + header + "</tr></thead><tbody>" + rows + "</tbody></table>";
}

function updateSummary(data) {
    if (!data.length) {
        avgBurnedArea.textContent = "--";
        avgRainfall.textContent = "--";
        dominantLandCover.textContent = "--";
        return;
    }

    var burnedAreaMean = data.reduce(function (sum, row) {
        return sum + Number(row.burned_area || 0);
    }, 0) / data.length;

    var rainfallMean = data.reduce(function (sum, row) {
        return sum + Number(row.rainfall || 0);
    }, 0) / data.length;

    avgBurnedArea.textContent = burnedAreaMean.toFixed(2);
    avgRainfall.textContent = rainfallMean.toFixed(3);

    var landCoverValue = data.find(function (row) {
        return row.land_cover !== undefined && row.land_cover !== null && row.land_cover !== "";
    });
    if (landCoverValue) {
        dominantLandCover.textContent = landCoverMap[Number(landCoverValue.land_cover)] || landCoverValue.land_cover;
    } else {
        dominantLandCover.textContent = "N/A";
    }
}

function renderChart(data) {
    var ctx = document.getElementById("results-chart").getContext("2d");
    var labels = data.map(function (row) {
        return row.date;
    });

    var burnedArea = data.map(function (row) {
        return row.burned_area;
    });

    var rainfall = data.map(function (row) {
        return row.rainfall;
    });

    if (resultsChart) {
        resultsChart.destroy();
    }

    resultsChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Burned Area",
                    data: burnedArea,
                    borderColor: "#ff9f6e",
                    backgroundColor: "rgba(255, 159, 110, 0.14)",
                    borderWidth: 2.5,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    tension: 0.35,
                    yAxisID: "y"
                },
                {
                    label: "Rainfall",
                    data: rainfall,
                    borderColor: "#4fd1c5",
                    backgroundColor: "rgba(79, 209, 197, 0.14)",
                    borderWidth: 2.5,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    tension: 0.35,
                    yAxisID: "y1"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 500
            },
            interaction: {
                mode: "index",
                intersect: false
            },
            scales: {
                y: {
                    position: "left",
                    grid: {
                        color: "rgba(255,255,255,0.08)"
                    },
                    ticks: {
                        color: "#eef5ff"
                    }
                },
                y1: {
                    position: "right",
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: "#eef5ff"
                    }
                },
                x: {
                    grid: {
                        color: "rgba(255,255,255,0.08)"
                    },
                    ticks: {
                        color: "#eef5ff"
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: "#eef5ff"
                    }
                }
            }
        }
    });
}

function renderResults(data) {
    currentResults = data.slice();
    updateSummary(data);
    renderChart(data);
    renderTable(data);
}

function exportResultsAsCsv() {
    if (!currentResults.length) {
        setStatus("No results available to export yet.", true);
        return;
    }

    var exportRows = currentResults.map(function (row) {
        var formattedRow = Object.assign({}, row);
        if (formattedRow.land_cover !== undefined && formattedRow.land_cover !== null && formattedRow.land_cover !== "") {
            formattedRow.land_cover = landCoverMap[Number(formattedRow.land_cover)] || formattedRow.land_cover;
        }
        return formattedRow;
    });

    var columns = Object.keys(exportRows[0]);
    var csvLines = [
        columns.join(",")
    ];

    exportRows.forEach(function (row) {
        var values = columns.map(function (column) {
            var value = row[column] === undefined || row[column] === null ? "" : String(row[column]);
            return '"' + value.replace(/"/g, '""') + '"';
        });
        csvLines.push(values.join(","));
    });

    var blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "analysis_results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function addLegend() {
    var legend = L.control({ position: "bottomright" });

    legend.onAdd = function () {
        var div = L.DomUtil.create("div", "info legend");
        div.innerHTML =
            "<b>Land Cover</b><br>" +
            '<i style="background:#22c55e"></i> Forest<br>' +
            '<i style="background:#facc15"></i> Cropland<br>' +
            '<i style="background:#94a3b8"></i> Urban<br>';
        return div;
    };

    legend.addTo(map);
}

function addLandcoverOverlay() {
    var bounds = [[15, -170], [75, -50]];
    landcoverOverlay = L.imageOverlay("data/landcover.png", bounds, {
        opacity: 0.18
    });
    landcoverOverlay.addTo(map);
}

function loadCatchmentsGeoJSON() {
    fetch("data/catchments.geojson")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to fetch GeoJSON");
            }
            return response.text();
        })
        .then(function (text) {
            if (!text || text.length < 10) {
                throw new Error("GeoJSON file is empty or invalid");
            }

            var data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error("Invalid JSON format");
            }

            if (!data.features || data.features.length === 0) {
                throw new Error("No features found in GeoJSON");
            }

            catchmentsLayer = L.geoJSON(data, {
                style: getDefaultStyle,
                onEachFeature: function (feature, layer) {
                    layer.on("mouseover", function () {
                        if (String(getFeatureCatchmentId(feature)) !== String(activeCatchmentId)) {
                            layer.setStyle(getHoverStyle());
                        }
                        if (layer._path) {
                            layer._path.style.cursor = "pointer";
                        }
                    });

                    layer.on("mouseout", function () {
                        resetLayerStyle(layer);
                    });

                    layer.on("click", function () {
                        var id = getFeatureCatchmentId(feature);
                        catchmentSelect.value = id;
                        highlightCatchment(id);
                        setStatus("Catchment selected from the map. Run analysis when ready.", false);
                    });
                }
            }).addTo(map);

            var seen = {};
            var options = ['<option value="">Select a catchment</option>'];

            data.features.forEach(function (feature) {
                var id = getFeatureCatchmentId(feature);
                if (id !== undefined && !seen[id]) {
                    seen[id] = true;
                    options.push('<option value="' + id + '">' + id + "</option>");
                }
            });

            catchmentSelect.innerHTML = options.join("");
            setStatus("Catchments loaded. Select one and run analysis.", false);
        })
        .catch(function (error) {
            console.error("GeoJSON ERROR:", error);
            catchmentSelect.innerHTML = '<option value="">GeoJSON error</option>';
            setStatus(error.message, true);
        });
}

function setupTabs() {
    var buttons = document.querySelectorAll(".tab-button");
    var panels = document.querySelectorAll(".tab-panel");

    buttons.forEach(function (button) {
        button.addEventListener("click", function () {
            var tab = button.getAttribute("data-tab");

            buttons.forEach(function (item) {
                item.classList.remove("active");
            });

            panels.forEach(function (panel) {
                panel.classList.remove("active");
            });

            button.classList.add("active");
            document.getElementById("tab-" + tab).classList.add("active");
        });
    });
}

catchmentSelect.addEventListener("change", function () {
    var selectedId = catchmentSelect.value;
    if (selectedId) {
        highlightCatchment(selectedId);
        setStatus("Catchment selected. Adjust dates and run analysis.", false);
    }
});

runButton.addEventListener("click", function () {
    var id = catchmentSelect.value;
    var start = startDateInput.value;
    var end = endDateInput.value;

    if (!id || !start || !end) {
        setStatus("Please select a catchment and both dates.", true);
        return;
    }

    setLoadingState(true);
    setStatus("Loading analysis results...", false);

    fetch("http://127.0.0.1:5000/query?catchment_id=" + encodeURIComponent(id) + "&start_date=" + encodeURIComponent(start) + "&end_date=" + encodeURIComponent(end))
        .then(function (res) {
            if (!res.ok) {
                throw new Error("API request failed");
            }
            return res.json();
        })
        .then(function (data) {
            renderResults(data);
            highlightCatchment(id);
            setStatus("Analysis complete.", false);
        })
        .catch(function (err) {
            console.error(err);
            renderResults([]);
            setStatus("Could not load data from the API.", true);
        })
        .finally(function () {
            setLoadingState(false);
        });
});

exportButton.addEventListener("click", exportResultsAsCsv);

addLegend();
addLandcoverOverlay();
setupTabs();
loadCatchmentsGeoJSON();
