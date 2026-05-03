var map = L.map("map").setView([40, -100], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

var catchmentsLayer = null;
var catchmentsGeoJsonData = null;
var selectedCatchmentLayer = null;
var resultsChart = null;
var activeCatchmentId = null;
var selectedLakeId = null;
var selectedLakeCatchmentId = null;
var selectedLakeLabel = null;
var currentResults = [];
var currentRequestId = 0;
var catchmentIdByOutlet = {};
var landCoverByCatchment = {};
var landcoverOverlay = null;
var landcoverLegend = null;
var burnedAreaOverlay = null;
var burnedAreaOverlayData = null;
var burnedAreaLegend = null;
var lakesLayer = null;
var lakesGeoJsonData = null;
var lakesOverviewLayer = null;
var hasCompletedAnalysis = false;
var analysisIsLoading = false;

var appShell = document.querySelector(".app-shell");
var controlPanel = document.getElementById("control-panel");
var toggleControlsButton = document.getElementById("toggle-controls");
var catchmentSelect = document.getElementById("catchmentSelect");
var startDateInput = document.getElementById("start-date");
var endDateInput = document.getElementById("end-date");
var runButton = document.getElementById("run-analysis");
var resetAnalysisButton = document.getElementById("reset-analysis");
var burnedOverlayToggle = document.getElementById("toggle-burned-overlay");
var lakesLayerToggle = document.getElementById("toggle-lakes-layer");
var exportButton = document.getElementById("export-csv");
var closeResultsButton = document.getElementById("close-results");
var resultsBackdrop = document.getElementById("results-backdrop");
var showMapButton = document.getElementById("show-map");
var showResultsButton = document.getElementById("show-results");
var tableContainer = document.getElementById("table-container");
var resultsChartCanvas = document.getElementById("results-chart");
var resultsShell = document.getElementById("results-drawer");
var resultsTitle = document.getElementById("results-title");
var selectedLakeValue = document.getElementById("selected-lake-value");
var avgBurnedArea = document.getElementById("avg-burned-area");
var avgRainfall = document.getElementById("avg-rainfall");
var dominantLandCover = document.getElementById("dominant-land-cover");
var lakeCoverage = document.getElementById("lake-coverage");
var waterInsight = document.getElementById("water-insight");
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

function metersToMillimeters(value) {
    var numericValue = Number(value);
    return isNaN(numericValue) ? null : numericValue * 1000;
}

function formatBurnedAreaHectares(value) {
    var numericValue = Number(value);

    if (isNaN(numericValue)) {
        return "--";
    }

    if (numericValue === 0) {
        return "0.00";
    }

    return numericValue < 1 ? numericValue.toFixed(4) : numericValue.toFixed(2);
}

function updateRunButtonState() {
    runButton.disabled = analysisIsLoading || !selectedLakeId;
}

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
    analysisIsLoading = isLoading;
    updateRunButtonState();
    runButton.textContent = isLoading ? "Running..." : "Run Analysis";
}

function setSelectedLakeDisplay(label) {
    var displayLabel = label || "--";

    if (selectedLakeValue) {
        selectedLakeValue.textContent = displayLabel;
    }

    if (resultsTitle) {
        resultsTitle.textContent = label ? "Analysis for Selected Lake" : "Analysis for Selected Lake";
    }
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

function getLakeStyle() {
    return {
        color: "#1E90FF",
        weight: 1.1,
        fillColor: "#4aa8ff",
        fillOpacity: 0.5
    };
}

function getLakeHoverStyle() {
    return {
        color: "#0c6ed7",
        weight: 2,
        fillColor: "#4aa8ff",
        fillOpacity: 0.68
    };
}

function getSelectedLakeStyle() {
    return {
        color: "#0f4c81",
        weight: 2.4,
        fillColor: "#1E90FF",
        fillOpacity: 0.74
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

function removeSelectedCatchmentLayer() {
    if (selectedCatchmentLayer) {
        map.removeLayer(selectedCatchmentLayer);
        selectedCatchmentLayer = null;
    }

    removeLandcoverLegend();
}

function showSelectedCatchment(feature, shouldFitBounds) {
    removeSelectedCatchmentLayer();

    if (!feature) {
        activeCatchmentId = null;
        return;
    }

    activeCatchmentId = getFeatureCatchmentId(feature);
    selectedCatchmentLayer = L.geoJSON(feature, {
        style: function () {
            return {
                color: "#ff916b",
                weight: 3,
                fillColor: getCatchmentFillColor(feature),
                fillOpacity: 0.16
            };
        }
    }).addTo(map);

    syncLandcoverLegend();

    if (shouldFitBounds !== false) {
        map.fitBounds(selectedCatchmentLayer.getBounds(), getMapFitOptions());
    }
}

function findCatchmentFeatureById(id) {
    if (!catchmentsGeoJsonData || !catchmentsGeoJsonData.features) {
        return null;
    }

    for (var i = 0; i < catchmentsGeoJsonData.features.length; i += 1) {
        var feature = catchmentsGeoJsonData.features[i];
        if (String(getFeatureCatchmentId(feature)) === String(id)) {
            return feature;
        }
    }

    return null;
}

function highlightCatchment(id) {
    activeCatchmentId = id;
    var feature = findCatchmentFeatureById(id);
    if (!feature) {
        return;
    }

    showSelectedCatchment(feature, true);
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

    header = header.replace("<th>rainfall</th>", "<th>rainfall_mm</th>");
    header = header.replace("<th>burned_area</th>", "<th>burned_area_ha</th>");

    var rows = data.map(function (row) {
        return "<tr>" + columns.map(function (column) {
            var value = row[column];
            if (column === "land_cover") {
                value = getLandCoverLabel(value);
            } else if (column === "burned_area") {
                value = value === undefined || value === null || value === "" ? "--" : formatBurnedAreaHectares(value);
            } else if (column === "rainfall") {
                var rainfallMillimeters = metersToMillimeters(value);
                value = rainfallMillimeters === null ? "--" : rainfallMillimeters.toFixed(2);
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

    avgBurnedArea.textContent = formatBurnedAreaHectares(burnedAreaMean);
    avgRainfall.textContent = metersToMillimeters(rainfallMean).toFixed(2);

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

function updateLakeSummary(summary) {
    if (!lakeCoverage || !waterInsight) {
        return;
    }

    if (!summary) {
        lakeCoverage.textContent = "--";
        waterInsight.textContent = "Lake-based insight will appear here after analysis.";
        return;
    }

    lakeCoverage.textContent = typeof summary.lake_coverage_percent === "number"
        ? summary.lake_coverage_percent.toFixed(2) + "%"
        : "--";

    waterInsight.textContent = summary.water_insight || "Lake-based insight unavailable.";
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
        var rainfallMillimeters = metersToMillimeters(row.rainfall);
        return rainfallMillimeters === null ? 0 : rainfallMillimeters;
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
                    label: "Burned Area (ha)",
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
                    label: "Rainfall (mm)",
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
                    title: {
                        display: true,
                        text: "Burned Area (ha)",
                        color: chartTextColor,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 700
                        }
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
                    title: {
                        display: true,
                        text: "Rainfall (mm)",
                        color: chartTextColor,
                        font: {
                            family: chartFontFamily,
                            size: 11,
                            weight: 700
                        }
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

function removeLandcoverLegend() {
    if (landcoverLegend) {
        map.removeControl(landcoverLegend);
        landcoverLegend = null;
    }
}

function getAvailableLandCoverEntries() {
    var availableValues = {};

    currentResults.forEach(function (row) {
        var landCoverValue = getLandCoverValue(row.land_cover);
        if (landCoverValue === null || !landCoverMap[landCoverValue] || !landCoverColors[landCoverValue]) {
            return;
        }

        availableValues[landCoverValue] = true;
    });

    return Object.keys(availableValues)
        .map(function (value) {
            var numericValue = Number(value);
            return {
                value: numericValue,
                label: landCoverMap[numericValue],
                color: landCoverColors[numericValue]
            };
        })
        .sort(function (a, b) {
            return a.value - b.value;
        });
}

function addLandcoverLegend() {
    removeLandcoverLegend();

    if (!hasCompletedAnalysis || !selectedCatchmentLayer) {
        return;
    }

    var entries = getAvailableLandCoverEntries();
    if (!entries.length) {
        return;
    }

    landcoverLegend = L.control({ position: "bottomright" });

    landcoverLegend.onAdd = function () {
        var div = L.DomUtil.create("div", "legend landcover-legend");
        var itemsMarkup = entries.map(function (entry) {
            return (
                '<div class="landcover-legend-item">' +
                    '<span class="landcover-legend-swatch" style="background:' + entry.color + ';"></span>' +
                    '<span class="landcover-legend-label">' + entry.label + "</span>" +
                "</div>"
            );
        }).join("");

        div.innerHTML =
            '<div class="landcover-legend-title">Land Cover</div>' +
            '<div class="landcover-legend-items">' + itemsMarkup + "</div>";
        return div;
    };

    landcoverLegend.addTo(map);
    window.setTimeout(function () {
        var element = landcoverLegend && landcoverLegend.getContainer ? landcoverLegend.getContainer() : null;
        if (element) {
            element.classList.add("is-visible");
        }
    }, 20);
}

function syncLandcoverLegend() {
    addLandcoverLegend();
}

function removeLakesLayer() {
    if (lakesLayer) {
        map.removeLayer(lakesLayer);
        lakesLayer = null;
    }
}

function syncLakesLayer() {
    removeLakesLayer();

    if (!lakesGeoJsonData || !lakesLayerToggle || !lakesLayerToggle.checked || !hasCompletedAnalysis) {
        return;
    }

    if (!Array.isArray(lakesGeoJsonData.features) || !lakesGeoJsonData.features.length) {
        return;
    }

    lakesLayer = L.geoJSON(lakesGeoJsonData, {
        style: function () {
            return {
                color: "#1E90FF",
                fillColor: "#1E90FF",
                fillOpacity: 0.5,
                weight: 1
            };
        }
    }).addTo(map);
}

function resetLakeOverviewStyle(layer) {
    var featureLakeId = layer && layer.feature && layer.feature.properties
        ? String(layer.feature.properties.Lake_ID)
        : null;
    layer.setStyle(featureLakeId === String(selectedLakeId) ? getSelectedLakeStyle() : getLakeStyle());
}

function updateLakeOverviewSelection() {
    if (!lakesOverviewLayer) {
        return;
    }

    lakesOverviewLayer.eachLayer(function (layer) {
        resetLakeOverviewStyle(layer);
    });
}

function applyLakeSelection(selectionPayload) {
    selectedLakeId = selectionPayload && selectionPayload.lake_id ? String(selectionPayload.lake_id) : null;
    selectedLakeCatchmentId = selectionPayload && selectionPayload.catchment_id ? String(selectionPayload.catchment_id) : null;
    selectedLakeLabel = selectionPayload && selectionPayload.lake_label ? selectionPayload.lake_label : null;

    setSelectedLakeDisplay(selectedLakeLabel);
    updateRunButtonState();
    updateLakeOverviewSelection();

    if (!selectedLakeCatchmentId) {
        catchmentSelect.innerHTML = '<option value="">No matching catchment</option>';
        removeSelectedCatchmentLayer();
        setStatus("This lake does not map to a catchment in the current dataset.", true);
        return;
    }

    catchmentSelect.innerHTML = '<option value="' + selectedLakeCatchmentId + '">' + selectedLakeCatchmentId + "</option>";
    catchmentSelect.value = selectedLakeCatchmentId;

    var cachedCatchmentFeature = findCatchmentFeatureById(selectedLakeCatchmentId);
    if (cachedCatchmentFeature) {
        showSelectedCatchment(cachedCatchmentFeature, true);
    } else if (selectionPayload.catchment) {
        showSelectedCatchment(selectionPayload.catchment, true);
    }

    updateQuickStats(null);
    setStatus("Lake selected. Choose dates and run analysis.", false);
}

function handleLakeSelection(lakeId) {
    fetch("http://127.0.0.1:5000/lake-selection?lake_id=" + encodeURIComponent(lakeId))
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to map lake to catchment");
            }
            return response.json();
        })
        .then(function (payload) {
            resetResults();
            applyLakeSelection(payload);
        })
        .catch(function (error) {
            console.error(error);
            setStatus("Could not map the selected lake to a catchment.", true);
        });
}

function loadLakesOverview() {
    return fetch("http://127.0.0.1:5000/lakes-overview")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to fetch lakes overview");
            }
            return response.json();
        })
        .then(function (data) {
            if (!data.features || !data.features.length) {
                throw new Error("No lakes available for selection");
            }

            lakesOverviewLayer = L.geoJSON(data, {
                style: function () {
                    return getLakeStyle();
                },
                onEachFeature: function (feature, layer) {
                    var lakeId = feature.properties && feature.properties.Lake_ID !== undefined
                        ? String(feature.properties.Lake_ID)
                        : null;

                    if (lakeId) {
                        layer.bindTooltip("Lake " + lakeId, {
                            direction: "top",
                            sticky: true,
                            className: "catchment-tooltip",
                            opacity: 1
                        });
                    }

                    layer.on("mouseover", function () {
                        if (String(lakeId) !== String(selectedLakeId)) {
                            layer.setStyle(getLakeHoverStyle());
                        }
                        if (layer._path) {
                            layer._path.style.cursor = "pointer";
                        }
                    });

                    layer.on("mouseout", function () {
                        resetLakeOverviewStyle(layer);
                    });

                    layer.on("click", function () {
                        if (!lakeId) {
                            setStatus("This lake is missing an ID.", true);
                            return;
                        }

                        handleLakeSelection(lakeId);
                    });
                }
            }).addTo(map);

            map.fitBounds(lakesOverviewLayer.getBounds(), {
                paddingTopLeft: [24, 80],
                paddingBottomRight: [24, 24]
            });
            setStatus("Lakes loaded. Select a lake on the map to begin.", false);
        });
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

    if (!burnedAreaOverlayData.image_url || !burnedAreaOverlayData.bounds) {
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
        burnedAreaOverlay.setOpacity(burnedAreaOverlayData.opacity || 0.8);
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
    lakesGeoJsonData = null;
    removeBurnedAreaOverlay();
    removeLandcoverLegend();
    removeLakesLayer();
    tableContainer.innerHTML = '<p class="placeholder">Results will appear here.</p>';
    updateSummary([]);
    updateLakeSummary(null);

    if (resultsChart) {
        resultsChart.destroy();
        resultsChart = null;
    }

    exportButton.disabled = true;
    setResetButtonVisible(false);
    updateQuickStats(null);
    setResultsPanelOpen(false);
}

function renderResults(data, overlay, lakesData, summary) {
    currentResults = data.slice();
    hasCompletedAnalysis = true;
    burnedAreaOverlayData = overlay || null;
    lakesGeoJsonData = lakesData || null;
    setResetButtonVisible(true);
    syncBurnedAreaOverlay();
    syncLakesLayer();
    syncLandcoverLegend();
    animateResultsShell();
    logLandCoverValues(data);
    updateSummary(data);
    updateLakeSummary(summary || null);
    renderChart(data);
    renderTable(data);
    updateQuickStats(data.length);
    setResultsPanelOpen(true);
}

function resetAnalysisUiState() {
    resetResults();

    if (selectedLakeCatchmentId && startDateInput.value && endDateInput.value) {
        highlightCatchment(selectedLakeCatchmentId);
        setStatus("Analysis reset. Run analysis to load a new burned-area overlay.", false);
        return;
    }

    if (selectedLakeCatchmentId) {
        highlightCatchment(selectedLakeCatchmentId);
        setStatus("Analysis reset. Choose dates and run analysis again.", false);
        return;
    }

    activeCatchmentId = null;
    removeSelectedCatchmentLayer();
    setStatus("Select a lake on the map to begin.", false);
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

            catchmentsGeoJsonData = data;
            catchmentSelect.innerHTML = '<option value="">Select a lake on the map</option>';
            resetResults();
            updateQuickStats(null);
        })
        .catch(function (error) {
            console.error("GeoJSON ERROR:", error);
            catchmentSelect.innerHTML = '<option value="">GeoJSON error</option>';
            setStatus(error.message, true);
        });
}

function handleFilterChange() {
    if (!selectedLakeId) {
        setStatus("Select a lake on the map to begin.", false);
        return;
    }
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

if (lakesLayerToggle) {
    lakesLayerToggle.addEventListener("change", syncLakesLayer);
}

if (resetAnalysisButton) {
    resetAnalysisButton.addEventListener("click", resetAnalysisUiState);
}

runButton.addEventListener("click", function () {
    var id = selectedLakeCatchmentId || catchmentSelect.value;
    var start = startDateInput.value;
    var end = endDateInput.value;
    var requestId = currentRequestId + 1;

    if (!selectedLakeId) {
        setStatus("Please select a lake on the map first.", true);
        return;
    }

    if (!id || !start || !end) {
        setStatus("Please select a lake and both dates.", true);
        return;
    }

    currentRequestId = requestId;
    setLoadingState(true);
    hasCompletedAnalysis = false;
    setResetButtonVisible(false);
    burnedAreaOverlayData = null;
    lakesGeoJsonData = null;
    removeBurnedAreaOverlay();
    removeLakesLayer();
    updateQuickStats(null);
    setStatus("Loading analysis results...", false);
    console.log("Selected lake_id:", selectedLakeId, "Selected catchment_id:", id);

    var queryUrl = "http://127.0.0.1:5000/query?" + new URLSearchParams({
        catchment_id: id,
        start_date: start,
        end_date: end
    }).toString();

    Promise.all([
        fetch(queryUrl)
            .then(function (res) {
                if (!res.ok) {
                    return res.json()
                        .catch(function () {
                            return {};
                        })
                        .then(function (payload) {
                            throw new Error(payload.error || "API request failed");
                        });
                }
                return res.json();
            }),
        fetch("http://127.0.0.1:5000/lakes?catchment_id=" + encodeURIComponent(id))
            .then(function (res) {
                if (!res.ok) {
                    return res.json()
                        .catch(function () {
                            return {};
                        })
                        .then(function (payload) {
                            throw new Error(payload.error || "Lakes request failed");
                        });
                }
                return res.json();
            })
    ])
        .then(function (responses) {
            if (requestId !== currentRequestId) {
                return;
            }

            var payload = responses[0];
            var lakesData = responses[1];
            var records = Array.isArray(payload) ? payload : (payload.records || []);
            var overlay = Array.isArray(payload) ? null : payload.overlay;
            var summary = Array.isArray(payload) ? null : payload.summary;

            renderResults(records, overlay, lakesData, summary);
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
            setStatus(err && err.message ? err.message : "Could not load data from the API.", true);
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
setControlsCollapsed(false);
setResultsPanelOpen(false);
setSelectedLakeDisplay(null);
updateRunButtonState();
updateQuickStats(null);
loadCatchmentsGeoJSON();
loadLakesOverview().catch(function (error) {
    console.error("Lakes overview ERROR:", error);
    setStatus(error.message, true);
});
