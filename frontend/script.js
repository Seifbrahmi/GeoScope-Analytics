var map = L.map("map").setView([40, -100], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

var catchmentsLayer = null;
var resultsChart = null;
var activeCatchmentId = null;
var currentResults = [];
var currentRequestId = 0;
var catchmentIdByOutlet = {};
var landCoverByCatchment = {};
var landcoverOverlay = null;
var burnedAreaOverlay = null;
var burnedAreaOverlayData = null;
var burnedAreaLegend = null;
var hasCompletedAnalysis = false;

var appShell = document.querySelector(".app-shell");
var controlPanel = document.getElementById("control-panel");
var toggleControlsButton = document.getElementById("toggle-controls");
var catchmentSelect = document.getElementById("catchmentSelect");
var startDateInput = document.getElementById("start-date");
var endDateInput = document.getElementById("end-date");
var runButton = document.getElementById("run-analysis");
var resetAnalysisButton = document.getElementById("reset-analysis");
var burnedOverlayToggle = document.getElementById("toggle-burned-overlay");
var exportButton = document.getElementById("export-csv");
var closeResultsButton = document.getElementById("close-results");
var resultsBackdrop = document.getElementById("results-backdrop");
var showMapButton = document.getElementById("show-map");
var showResultsButton = document.getElementById("show-results");
var tableContainer = document.getElementById("table-container");
var resultsChartCanvas = document.getElementById("results-chart");
var resultsShell = document.getElementById("results-drawer");
var avgBurnedArea = document.getElementById("avg-burned-area");
var avgRainfall = document.getElementById("avg-rainfall");
var dominantLandCover = document.getElementById("dominant-land-cover");
var quickCatchment = document.getElementById("quick-catchment");
var quickWindow = document.getElementById("quick-window");
var quickRecords = document.getElementById("quick-records");
var statusDot = document.querySelector(".status-dot");
var chartTextColor = "#6b7280";
var chartGridColor = "rgba(203, 213, 225, 0.65)";
var chartFontFamily = "\"Manrope\", \"Segoe UI\", sans-serif";

var landCoverMap = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen"
};

var landCoverColors = {
    10: "#2e7d32",
    20: "#4d7c0f",
    30: "#84cc16",
    40: "#f9a825",
    50: "#616161",
    60: "#c2a878",
    70: "#dbeafe",
    80: "#42a5f5",
    90: "#14b8a6",
    95: "#0f766e",
    100: "#8d99ae"
};

function setStatus(message, isError) {
    var status = document.getElementById("status-message");
    status.textContent = message;
    status.style.color = isError ? "#dc2626" : "#52606d";
    if (statusDot) {
        statusDot.style.background = isError ? "#dc2626" : "#10b981";
        statusDot.style.boxShadow = isError
            ? "0 0 0 6px rgba(220, 38, 38, 0.12)"
            : "0 0 0 6px rgba(16, 185, 129, 0.12)";
    }
}

function setLoadingState(isLoading) {
    runButton.disabled = isLoading;
    runButton.textContent = isLoading ? "Running..." : "Run Analysis";
}

function setResetButtonVisible(isVisible) {
    if (!resetAnalysisButton) {
        return;
    }

    resetAnalysisButton.classList.toggle("is-hidden", !isVisible);
}

function animateResultsShell() {
    if (!resultsShell) {
        return;
    }

    resultsShell.classList.remove("is-refreshed");
    void resultsShell.offsetWidth;
    resultsShell.classList.add("is-refreshed");
}

function formatDateWindow() {
    if (startDateInput.value && endDateInput.value) {
        return startDateInput.value + " to " + endDateInput.value;
    }

    if (startDateInput.value) {
        return "From " + startDateInput.value;
    }

    if (endDateInput.value) {
        return "Until " + endDateInput.value;
    }

    return "--";
}

function updateQuickStats(recordCount) {
    if (quickCatchment) {
        quickCatchment.textContent = catchmentSelect.value || "--";
    }

    if (quickWindow) {
        quickWindow.textContent = formatDateWindow();
    }

    if (!quickRecords) {
        return;
    }

    if (recordCount === null) {
        quickRecords.textContent = "--";
        return;
    }

    if (typeof recordCount === "number") {
        quickRecords.textContent = String(recordCount);
        return;
    }

    quickRecords.textContent = currentResults.length ? String(currentResults.length) : "--";
}

function setControlsCollapsed(isCollapsed) {
    if (!controlPanel || !toggleControlsButton) {
        return;
    }

    controlPanel.classList.toggle("is-collapsed", isCollapsed);
    controlPanel.setAttribute("aria-expanded", String(!isCollapsed));
    toggleControlsButton.setAttribute("aria-expanded", String(!isCollapsed));
    toggleControlsButton.textContent = isCollapsed ? "Show" : "Hide";

    window.setTimeout(function () {
        map.invalidateSize();
    }, 220);
}

function setResultsPanelOpen(isOpen) {
    if (!appShell || !resultsShell) {
        return;
    }

    appShell.classList.toggle("is-results-open", isOpen);
    resultsShell.setAttribute("aria-hidden", String(!isOpen));

    if (showMapButton) {
        showMapButton.classList.toggle("is-active", !isOpen);
    }

    if (showResultsButton) {
        showResultsButton.classList.toggle("is-active", isOpen);
    }

    window.setTimeout(function () {
        if (isOpen && resultsChart) {
            resultsChart.resize();
            return;
        }

        map.invalidateSize();
    }, 260);
}

function getMapFitOptions() {
    var rightPadding = 24;

    if (appShell && appShell.classList.contains("is-results-open") && window.innerWidth > 760) {
        rightPadding = Math.min(window.innerWidth * 0.38, 540) + 40;
    }

    return {
        paddingTopLeft: [32, 100],
        paddingBottomRight: [rightPadding, 48]
    };
}

function getFeatureCatchmentId(feature) {
    if (!feature || !feature.properties) {
        return null;
    }

    if (feature.properties.catchment_id !== undefined && feature.properties.catchment_id !== null && feature.properties.catchment_id !== "") {
        return String(feature.properties.catchment_id);
    }

    if (feature.properties.Outlet_id !== undefined && feature.properties.Outlet_id !== null) {
        return catchmentIdByOutlet[String(feature.properties.Outlet_id)] || null;
    }

    return null;
}

function getLandCoverValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === "string" && value.trim() === "") {
        return null;
    }

    var landCoverValue = Number(value);
    return isNaN(landCoverValue) ? null : landCoverValue;
}

function getLandCoverLabel(value) {
    var landCoverValue = getLandCoverValue(value);
    return landCoverValue === null ? "Unknown" : (landCoverMap[landCoverValue] || "Unknown");
}

function logLandCoverValues(data) {
    var uniqueLandCoverValues = data
        .map(function (row) {
            return getLandCoverValue(row.land_cover);
        })
        .filter(function (value, index, values) {
            return value !== null && values.indexOf(value) === index;
        })
        .sort(function (a, b) {
            return a - b;
        });

    console.log("Unique land_cover values from API response:", uniqueLandCoverValues);

    var unmappedLandCoverValues = uniqueLandCoverValues.filter(function (value) {
        return !Object.prototype.hasOwnProperty.call(landCoverMap, value);
    });

    if (unmappedLandCoverValues.length) {
        console.warn("Unmapped land_cover values:", unmappedLandCoverValues);
    }
}

function getCatchmentFillColor(feature) {
    var landCoverValue = getLandCoverValue(feature.properties.land_cover);
    return landCoverColors[landCoverValue] || "#999";
}

function getFeatureStyle(feature) {
    return {
        color: "#334155",
        weight: 1.1,
        fillColor: getCatchmentFillColor(feature),
        fillOpacity: 0.48
    };
}

function getHoverStyle(feature) {
    return {
        color: "#7ce8ce",
        weight: 2,
        fillColor: getCatchmentFillColor(feature),
        fillOpacity: 0.68
    };
}

function getSelectedStyle(feature) {
    return {
        color: "#ff916b",
        weight: 3,
        fillColor: getCatchmentFillColor(feature),
        fillOpacity: 0.84
    };
}

function resetLayerStyle(layer) {
    var id = getFeatureCatchmentId(layer.feature);
    if (String(id) === String(activeCatchmentId)) {
        layer.setStyle(getSelectedStyle(layer.feature));
    } else {
        layer.setStyle(getFeatureStyle(layer.feature));
    }
}

function highlightCatchment(id) {
    activeCatchmentId = id;
    if (!catchmentsLayer) {
        return;
    }

    catchmentsLayer.eachLayer(function (layer) {
        if (String(getFeatureCatchmentId(layer.feature)) === String(id)) {
            layer.setStyle(getSelectedStyle(layer.feature));
            map.fitBounds(layer.getBounds(), getMapFitOptions());

            if (layer.getTooltip()) {
                layer.openTooltip();
                window.setTimeout(function () {
                    if (layer.getTooltip()) {
                        layer.closeTooltip();
                    }
                }, 1200);
            }
        } else {
            layer.setStyle(getFeatureStyle(layer.feature));
        }
    });
}

function renderTable(data) {
    if (!data.length) {
        tableContainer.innerHTML = '<p class="placeholder">No results returned for the selected filters.</p>';
        return;
    }

    var columns = Object.keys(data[0]);
    var header = columns.map(function (column) {
        return "<th>" + column + "</th>";
    }).join("");

    var rows = data.map(function (row) {
        return "<tr>" + columns.map(function (column) {
            var value = row[column];
            if (column === "land_cover") {
                value = getLandCoverLabel(value);
            } else if (value === undefined || value === null || value === "") {
                value = "--";
            }
            return "<td>" + value + "</td>";
        }).join("") + "</tr>";
    }).join("");

    tableContainer.innerHTML =
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

    var landCoverCounts = {};

    data.forEach(function (row) {
        var landCoverValue = getLandCoverValue(row.land_cover);
        if (landCoverValue === null) {
            return;
        }
        landCoverCounts[landCoverValue] = (landCoverCounts[landCoverValue] || 0) + 1;
    });

    var dominantLandCoverId = Object.keys(landCoverCounts).reduce(function (bestId, currentId) {
        if (!bestId || landCoverCounts[currentId] > landCoverCounts[bestId]) {
            return currentId;
        }
        return bestId;
    }, null);

    dominantLandCover.textContent = dominantLandCoverId
        ? getLandCoverLabel(dominantLandCoverId)
        : "N/A";
}

function renderChart(data) {
    var ctx = resultsChartCanvas.getContext("2d");
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
                    borderColor: "#f97316",
                    backgroundColor: "rgba(249, 115, 22, 0.12)",
                    borderWidth: 3,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    tension: 0.35,
                    yAxisID: "y"
                },
                {
                    label: "Rainfall",
                    data: rainfall,
                    borderColor: "#10b981",
                    backgroundColor: "rgba(16, 185, 129, 0.12)",
                    borderWidth: 3,
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
                duration: 450
            },
            interaction: {
                mode: "index",
                intersect: false
            },
            scales: {
                y: {
                    position: "left",
                    grid: {
                        color: chartGridColor
                    },
                    ticks: {
                        color: chartTextColor,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 600
                        }
                    }
                },
                y1: {
                    position: "right",
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: chartTextColor,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 600
                        }
                    }
                },
                x: {
                    grid: {
                        color: chartGridColor
                    },
                    ticks: {
                        color: chartTextColor,
                        maxRotation: 0,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 600
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: chartTextColor,
                        usePointStyle: true,
                        boxWidth: 10,
                        padding: 14,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 700
                        }
                    }
                }
            }
        }
    });
}

function removeBurnedAreaOverlay() {
    if (burnedAreaOverlay) {
        map.removeLayer(burnedAreaOverlay);
        burnedAreaOverlay = null;
    }

    if (burnedAreaLegend) {
        map.removeControl(burnedAreaLegend);
        burnedAreaLegend = null;
    }
}

function addBurnedAreaLegend(legendConfig) {
    if (!legendConfig || legendConfig.has_data === false) {
        return;
    }

    burnedAreaLegend = L.control({ position: legendConfig.position || "bottomright" });

    burnedAreaLegend.onAdd = function () {
        var div = L.DomUtil.create("div", "legend burned-legend");
        var colors = Array.isArray(legendConfig.colors) && legendConfig.colors.length
            ? legendConfig.colors
            : ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"];
        div.innerHTML =
            '<div class="burned-legend-title">' + (legendConfig.title || "Burned Area Intensity") + "</div>" +
            '<div class="burned-legend-scale" style="background:linear-gradient(90deg, ' + colors.join(", ") + ');"></div>' +
            '<div class="burned-legend-labels"><span>' +
            (legendConfig.min_label || "Low") +
            "</span><span>" +
            (legendConfig.max_label || "High") +
            "</span></div>";
        return div;
    };

    burnedAreaLegend.addTo(map);
    window.setTimeout(function () {
        var element = burnedAreaLegend && burnedAreaLegend.getContainer ? burnedAreaLegend.getContainer() : null;
        if (element) {
            element.classList.add("is-visible");
        }
    }, 20);
}

function syncBurnedAreaOverlay() {
    removeBurnedAreaOverlay();

    if (!burnedAreaOverlayData || !burnedOverlayToggle || !burnedOverlayToggle.checked || !hasCompletedAnalysis) {
        return;
    }

    burnedAreaOverlay = L.imageOverlay(
        burnedAreaOverlayData.image_url,
        burnedAreaOverlayData.bounds,
        {
            opacity: 0,
            interactive: false,
            crossOrigin: true,
            className: "burned-area-overlay"
        }
    );

    burnedAreaOverlay.once("load", function () {
        burnedAreaOverlay.setOpacity(burnedAreaOverlayData.opacity || 0.82);
    });

    burnedAreaOverlay.addTo(map);
    if (burnedAreaOverlayData.has_burned_data && burnedAreaOverlayData.legend) {
        var legendConfig = Object.assign({}, burnedAreaOverlayData.legend, {
            has_data: burnedAreaOverlayData.has_burned_data
        });
        addBurnedAreaLegend(legendConfig);
    }
}

function resetResults(shouldInvalidateRequest) {
    if (shouldInvalidateRequest !== false) {
        currentRequestId += 1;
    }

    currentResults = [];
    hasCompletedAnalysis = false;
    burnedAreaOverlayData = null;
    removeBurnedAreaOverlay();
    tableContainer.innerHTML = '<p class="placeholder">Results will appear here.</p>';
    updateSummary([]);

    if (resultsChart) {
        resultsChart.destroy();
        resultsChart = null;
    }

    exportButton.disabled = true;
    setResetButtonVisible(false);
    updateQuickStats(null);
    setResultsPanelOpen(false);
}

function renderResults(data, overlay) {
    currentResults = data.slice();
    hasCompletedAnalysis = true;
    burnedAreaOverlayData = overlay || null;
    setResetButtonVisible(true);
    syncBurnedAreaOverlay();
    animateResultsShell();
    logLandCoverValues(data);
    updateSummary(data);
    renderChart(data);
    renderTable(data);
    updateQuickStats(data.length);
    setResultsPanelOpen(true);
}

function resetAnalysisUiState() {
    resetResults();

    if (catchmentSelect.value && startDateInput.value && endDateInput.value) {
        highlightCatchment(catchmentSelect.value);
        setStatus("Analysis reset. Run analysis to load a new burned-area overlay.", false);
        return;
    }

    if (catchmentSelect.value) {
        highlightCatchment(catchmentSelect.value);
        setStatus("Analysis reset. Choose dates and run analysis again.", false);
        return;
    }

    activeCatchmentId = null;
    if (catchmentsLayer) {
        catchmentsLayer.eachLayer(function (layer) {
            layer.setStyle(getFeatureStyle(layer.feature));
        });
    }
    setStatus("Choose filters and run the analysis.", false);
}

function exportResultsAsCsv() {
    if (!currentResults.length) {
        setStatus("No results available to export yet.", true);
        return;
    }

    var exportRows = currentResults.map(function (row) {
        var formattedRow = Object.assign({}, row);
        if (formattedRow.land_cover !== undefined && formattedRow.land_cover !== null && formattedRow.land_cover !== "") {
            formattedRow.land_cover = getLandCoverLabel(formattedRow.land_cover);
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
            '<i style="background:#2e7d32"></i> Tree cover<br>' +
            '<i style="background:#4d7c0f"></i> Shrubland<br>' +
            '<i style="background:#84cc16"></i> Grassland<br>' +
            '<i style="background:#f9a825"></i> Cropland<br>' +
            '<i style="background:#616161"></i> Built-up<br>' +
            '<i style="background:#c2a878"></i> Bare / sparse vegetation<br>' +
            '<i style="background:#dbeafe"></i> Snow and ice<br>' +
            '<i style="background:#42a5f5"></i> Permanent water bodies<br>' +
            '<i style="background:#14b8a6"></i> Herbaceous wetland<br>' +
            '<i style="background:#0f766e"></i> Mangroves<br>' +
            '<i style="background:#8d99ae"></i> Moss and lichen<br>';
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

function loadLandCoverLookup() {
    return fetch("http://127.0.0.1:5000/land-cover")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to fetch land cover lookup");
            }
            return response.json();
        })
        .then(function (lookup) {
            landCoverByCatchment = lookup || {};
        })
        .catch(function (error) {
            console.warn("Land cover lookup unavailable:", error);
            landCoverByCatchment = {};
        });
}

function loadCatchmentIdMap() {
    return fetch("data/catchment-id-map.json")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to fetch catchment ID map");
            }
            return response.json();
        })
        .then(function (lookup) {
            catchmentIdByOutlet = lookup || {};
        })
        .catch(function (error) {
            console.error("Catchment ID map unavailable:", error);
            catchmentIdByOutlet = {};
            throw error;
        });
}

function loadCatchmentsGeoJSON() {
    Promise.all([
        fetch("data/catchments.geojson")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("Failed to fetch GeoJSON");
                }
                return response.text();
            }),
        loadLandCoverLookup(),
        loadCatchmentIdMap()
    ])
        .then(function (results) {
            var text = results[0];

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

            data.features.forEach(function (feature) {
                var outletId = feature.properties.Outlet_id;
                var catchmentId = outletId !== undefined && outletId !== null
                    ? catchmentIdByOutlet[String(outletId)]
                    : null;

                feature.properties.catchment_id = catchmentId || null;
                feature.properties.land_cover = catchmentId ? landCoverByCatchment[String(catchmentId)] : undefined;
            });

            catchmentsLayer = L.geoJSON(data, {
                style: function (feature) {
                    return getFeatureStyle(feature);
                },
                onEachFeature: function (feature, layer) {
                    var id = getFeatureCatchmentId(feature);

                    if (id) {
                        layer.bindTooltip("Catchment " + id, {
                            direction: "top",
                            sticky: true,
                            className: "catchment-tooltip",
                            opacity: 1
                        });
                    }

                    layer.on("mouseover", function () {
                        if (String(getFeatureCatchmentId(feature)) !== String(activeCatchmentId)) {
                            layer.setStyle(getHoverStyle(feature));
                        }
                        if (layer._path) {
                            layer._path.style.cursor = "pointer";
                        }
                    });

                    layer.on("mouseout", function () {
                        resetLayerStyle(layer);
                    });

                    layer.on("click", function () {
                        var selectedId = getFeatureCatchmentId(feature);
                        if (!selectedId) {
                            setStatus("This map catchment does not have a matching dataset ID.", true);
                            return;
                        }

                        catchmentSelect.value = selectedId;
                        resetResults();
                        highlightCatchment(selectedId);
                        updateQuickStats(null);
                        setStatus("Catchment selected from the map. Run analysis when ready.", false);
                    });
                }
            }).addTo(map);

            var seen = {};
            var options = ['<option value="">Select a catchment</option>'];

            data.features.forEach(function (feature) {
                var id = getFeatureCatchmentId(feature);
                if (id && !seen[id]) {
                    seen[id] = true;
                    options.push('<option value="' + id + '">' + id + "</option>");
                }
            });

            catchmentSelect.innerHTML = options.join("");
            resetResults();
            updateQuickStats(null);
            setStatus("Catchments loaded. Select one and run analysis.", false);
        })
        .catch(function (error) {
            console.error("GeoJSON ERROR:", error);
            catchmentSelect.innerHTML = '<option value="">GeoJSON error</option>';
            setStatus(error.message, true);
        });
}

function handleFilterChange() {
    resetResults();

    var selectedId = catchmentSelect.value;
    if (selectedId) {
        highlightCatchment(selectedId);
        updateQuickStats(null);
        setStatus("Catchment selected. Adjust dates and run analysis.", false);
        return;
    }

    activeCatchmentId = null;
    if (catchmentsLayer) {
        catchmentsLayer.eachLayer(function (layer) {
            layer.setStyle(getFeatureStyle(layer.feature));
        });
    }

    updateQuickStats(null);
    setStatus("Choose filters and run the analysis.", false);
}

function handleDateChange() {
    resetResults();
    updateQuickStats(null);
    setStatus("Dates changed. Run analysis to load updated results.", false);
}

catchmentSelect.addEventListener("change", handleFilterChange);
startDateInput.addEventListener("change", handleDateChange);
endDateInput.addEventListener("change", handleDateChange);

if (burnedOverlayToggle) {
    burnedOverlayToggle.addEventListener("change", syncBurnedAreaOverlay);
}

if (resetAnalysisButton) {
    resetAnalysisButton.addEventListener("click", resetAnalysisUiState);
}

runButton.addEventListener("click", function () {
    var id = catchmentSelect.value;
    var start = startDateInput.value;
    var end = endDateInput.value;
    var requestId = currentRequestId + 1;

    if (!id || !start || !end) {
        setStatus("Please select a catchment and both dates.", true);
        return;
    }

    currentRequestId = requestId;
    setLoadingState(true);
    hasCompletedAnalysis = false;
    setResetButtonVisible(false);
    burnedAreaOverlayData = null;
    removeBurnedAreaOverlay();
    updateQuickStats(null);
    setStatus("Loading analysis results...", false);
    console.log("Selected catchment_id:", id);

    fetch("http://127.0.0.1:5000/query?catchment_id=" + encodeURIComponent(id) + "&start_date=" + encodeURIComponent(start) + "&end_date=" + encodeURIComponent(end))
        .then(function (res) {
            if (!res.ok) {
                throw new Error("API request failed");
            }
            return res.json();
        })
        .then(function (payload) {
            if (requestId !== currentRequestId) {
                return;
            }

            var records = Array.isArray(payload) ? payload : (payload.records || []);
            var overlay = Array.isArray(payload) ? null : payload.overlay;

            renderResults(records, overlay);
            exportButton.disabled = !records.length;
            highlightCatchment(id);
            setStatus("Analysis complete.", false);
        })
        .catch(function (err) {
            if (requestId !== currentRequestId) {
                return;
            }

            console.error(err);
            resetResults(false);
            setStatus("Could not load data from the API.", true);
        })
        .finally(function () {
            if (requestId === currentRequestId) {
                setLoadingState(false);
            }
        });
});

if (toggleControlsButton) {
    toggleControlsButton.addEventListener("click", function () {
        setControlsCollapsed(!controlPanel.classList.contains("is-collapsed"));
    });
}

if (showMapButton) {
    showMapButton.addEventListener("click", function () {
        setResultsPanelOpen(false);
    });
}

if (showResultsButton) {
    showResultsButton.addEventListener("click", function () {
        setResultsPanelOpen(true);
    });
}

if (closeResultsButton) {
    closeResultsButton.addEventListener("click", function () {
        setResultsPanelOpen(false);
    });
}

if (resultsBackdrop) {
    resultsBackdrop.addEventListener("click", function () {
        setResultsPanelOpen(false);
    });
}

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
        setResultsPanelOpen(false);
    }
});

window.addEventListener("resize", function () {
    if (resultsChart && appShell.classList.contains("is-results-open")) {
        resultsChart.resize();
    }

    map.invalidateSize();
});

exportButton.addEventListener("click", exportResultsAsCsv);

addLegend();
addLandcoverOverlay();
setControlsCollapsed(false);
setResultsPanelOpen(false);
updateQuickStats(null);
loadCatchmentsGeoJSON();
