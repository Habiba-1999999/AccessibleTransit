
// =====================================================
// ACCESSIBLE TRANSIT
// Map, Reports, Image Upload, Live Location, Navigation
// =====================================================

// -------------------------------
// CONFIGURATION
// -------------------------------

const API_URL = "https://para-payment-joke-main.trycloudflare.com/api/reports";

const GEOCODING_URL =
    "https://nominatim.openstreetmap.org/search";

const ROUTING_URL =
    "https://router.project-osrm.org/route/v1/driving/";

const DEFAULT_LOCATION = [16.5062, 80.6480];

const BARRIER_WARNING_DISTANCE = 150;

// -------------------------------
// GLOBAL VARIABLES
// -------------------------------

let selectedLatitude = null;
let selectedLongitude = null;

let currentUser = null;
let allReports = [];

let currentLocation = null;
let destinationLocation = null;

let currentLocationMarker = null;
let destinationMarker = null;

let routeLine = null;
let reportMarkersLayer = null;
let navigationLayer = null;

let locationWatcher = null;
let navigationActive = false;

let warnedReportIds = new Set();

// =====================================================
// INITIALIZE MAP
// =====================================================

const map = L.map("map").setView(DEFAULT_LOCATION, 13);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
    }
).addTo(map);

reportMarkersLayer = L.layerGroup().addTo(map);
navigationLayer = L.layerGroup().addTo(map);

// =====================================================
// STATUS MESSAGE
// =====================================================

function updateNavigationStatus(message) {
    const status = document.getElementById("navigationStatus");

    if (status) {
        status.textContent = message;
    }

    console.log("[Accessible Transit]", message);
}

// =====================================================
// LOGIN CHECK
// =====================================================

function getLoggedInUser() {
    const token = localStorage.getItem("accessToken");
    const savedUser = localStorage.getItem("user");

    if (!token || !savedUser) {
        alert("Please log in before submitting a report.");
        window.location.href = "login.html";
        return false;
    }

    try {
        currentUser = JSON.parse(savedUser);
        return true;
    } catch (error) {
        console.error("Login session error:", error);

        localStorage.removeItem("accessToken");
        localStorage.removeItem("user");

        alert("Your login session is invalid. Please log in again.");
        window.location.href = "login.html";
        return false;
    }
}

// =====================================================
// LOAD REPORTS
// =====================================================

async function loadReports() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Unable to load reports."
            );
        }

        allReports = Array.isArray(data.reports)
            ? data.reports
            : [];

        displayReports();

        if (navigationActive) {
            checkReportedBarriers();
        }

        console.log("Reports loaded:", allReports.length);

    } catch (error) {
        console.error("Loading reports failed:", error);
    }
}

// Refresh reports every 30 seconds.

setInterval(loadReports, 30000);

// =====================================================
// DISPLAY REPORTS ON MAP
// =====================================================

function displayReports() {
    reportMarkersLayer.clearLayers();

    allReports.forEach(function (report) {
        const latitude = Number(report.latitude);
        const longitude = Number(report.longitude);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return;
        }

        if (
            String(report.status || "").toLowerCase() === "resolved"
        ) {
            return;
        }

        let markerColor = "green";

        if (report.severity === "High") {
            markerColor = "red";
        } else if (report.severity === "Medium") {
            markerColor = "orange";
        }

        const marker = L.circleMarker(
            [latitude, longitude],
            {
                radius: 9,
                color: markerColor,
                fillColor: markerColor,
                fillOpacity: 0.8,
                weight: 2
            }
        ).addTo(reportMarkersLayer);

        const popup = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = report.type || "Accessibility problem";

        const severity = document.createElement("p");
        severity.textContent =
            "Severity: " + (report.severity || "Unknown");

        const description = document.createElement("p");
        description.textContent =
            report.description || "No description provided.";

        const status = document.createElement("p");
        status.textContent =
            "Status: " + (report.status || "Reported");

        popup.append(title, severity, description, status);

        if (report.image) {
            const image = document.createElement("img");

            image.src = report.image.startsWith("http")
                ? report.image
                : report.image.startsWith("/")
                    ? report.image
                    : "/uploads/" + report.image;

            image.alt = "Accessibility barrier photograph";
            image.style.maxWidth = "180px";
            image.style.width = "100%";
            image.style.display = "block";

            image.onerror = function () {
                image.remove();
            };

            popup.appendChild(image);
        }

        marker.bindPopup(popup);
    });
}

// =====================================================
// SELECT REPORT LOCATION BY CLICKING MAP
// =====================================================

map.on("click", function (event) {
    selectedLatitude = event.latlng.lat;
    selectedLongitude = event.latlng.lng;

    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    const reportForm = document.getElementById("reportForm");

    if (latitudeInput) {
        latitudeInput.value = selectedLatitude.toFixed(6);
    }

    if (longitudeInput) {
        longitudeInput.value = selectedLongitude.toFixed(6);
    }

    if (reportForm) {
        reportForm.style.display = "block";
    }
});

// =====================================================
// SUBMIT REPORT
// =====================================================

async function submitReport() {
    if (!getLoggedInUser()) {
        return;
    }

    const token = localStorage.getItem("accessToken");

    const typeElement = document.getElementById("type");
    const descriptionElement = document.getElementById("description");
    const severityElement = document.getElementById("severity");
    const imageInput = document.getElementById("image");

    if (!typeElement || !descriptionElement || !severityElement) {
        alert("Report form fields are missing.");
        return;
    }

    const type = typeElement.value;
    const description = descriptionElement.value.trim();
    const severity = severityElement.value;

    if (!type || !description || !severity) {
        alert("Please fill in the issue type, description, and severity.");
        return;
    }

    if (
        selectedLatitude === null ||
        selectedLongitude === null
    ) {
        alert("Click on the map to select the problem location.");
        return;
    }

    if (
        imageInput &&
        imageInput.files.length > 0 &&
        imageInput.files[0].size > 5 * 1024 * 1024
    ) {
        alert("Please select an image smaller than 5 MB.");
        return;
    }

    const formData = new FormData();

    formData.append("type", type);
    formData.append("description", description);
    formData.append("severity", severity);
    formData.append("latitude", String(selectedLatitude));
    formData.append("longitude", String(selectedLongitude));

    formData.append(
        "userId",
        currentUser.id || currentUser._id || ""
    );

    formData.append("userName", currentUser.name || "");
    formData.append("userEmail", currentUser.email || "");

    if (imageInput && imageInput.files.length > 0) {
        formData.append("image", imageInput.files[0]);
    }

    try {
        updateNavigationStatus("Submitting report...");

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + token
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Report submission failed."
            );
        }

        alert("Report submitted successfully!");

        await loadReports();

        closeReportForm();

        typeElement.value = "";
        descriptionElement.value = "";
        severityElement.value = "";

        if (imageInput) {
            imageInput.value = "";
        }

        selectedLatitude = null;
        selectedLongitude = null;

        updateNavigationStatus("Report submitted successfully.");

    } catch (error) {
        console.error("Report submission error:", error);
        alert(error.message || "Unable to submit report.");
    }
}

// =====================================================
// CLOSE REPORT FORM
// =====================================================

function closeReportForm() {
    const reportForm = document.getElementById("reportForm");

    if (reportForm) {
        reportForm.style.display = "none";
    }
}

// =====================================================
// SHOW CURRENT LOCATION
// =====================================================

function getMyLocation() {
    if (!window.isSecureContext) {
        updateNavigationStatus(
            "Open the application through http://localhost:3000/map.html or use HTTPS."
        );
        return;
    }

    if (!navigator.geolocation) {
        updateNavigationStatus(
            "Geolocation is not supported by this browser."
        );
        return;
    }

    updateNavigationStatus("Requesting current location...");

    navigator.geolocation.getCurrentPosition(
        function (position) {
            updateLocationFromPosition(position);

            map.setView(
                [
                    position.coords.latitude,
                    position.coords.longitude
                ],
                17
            );

            if (currentLocationMarker) {
                currentLocationMarker.openPopup();
            }

            updateNavigationStatus(
                "Location accessed successfully."
            );
        },

        handleLocationError,

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 30000
        }
    );
}

// =====================================================
// LOCATION ERROR HANDLING
// =====================================================

function handleLocationError(error) {
    console.error(
        "Geolocation error:",
        error.code,
        error.message
    );

    let message;

    switch (error.code) {
        case 1:
            message =
                "Location permission denied. Allow location access in Chrome Site Settings.";
            break;

        case 2:
            message =
                "Position unavailable. Check Windows location services and your device's location signal.";
            break;

        case 3:
            message =
                "Location request timed out. Check your internet connection and location settings, then retry.";
            break;

        default:
            message =
                "Unable to access location: " + error.message;
    }

    updateNavigationStatus(message);
}

// =====================================================
// UPDATE LOCATION MARKER
// =====================================================

function updateLocationFromPosition(position) {
    currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };

    const coordinates = [
        currentLocation.lat,
        currentLocation.lng
    ];

    if (!currentLocationMarker) {
        currentLocationMarker = L.circleMarker(
            coordinates,
            {
                radius: 9,
                color: "#075985",
                fillColor: "#38bdf8",
                fillOpacity: 1,
                weight: 3
            }
        )
        .addTo(map)
        .bindPopup("Your current location");
    } else {
        currentLocationMarker.setLatLng(coordinates);
    }
}

// =====================================================
// SEARCH DESTINATION
// =====================================================

async function findDestination() {
    const input = document.getElementById("destination");

    if (!input) {
        alert("Destination input is missing from map.html.");
        return;
    }

    const query = input.value.trim();

    if (!query) {
        alert("Please enter a destination.");
        return;
    }

    updateNavigationStatus("Searching for destination...");

    try {
        const response = await fetch(
            GEOCODING_URL +
            "?format=json&limit=1&q=" +
            encodeURIComponent(query)
        );

        if (!response.ok) {
            throw new Error("Destination search service unavailable.");
        }

        const results = await response.json();

        if (!results.length) {
            updateNavigationStatus("Destination not found.");
            alert("Try entering a more specific destination.");
            return;
        }

        destinationLocation = {
            lat: Number(results[0].lat),
            lng: Number(results[0].lon)
        };

        if (destinationMarker) {
            map.removeLayer(destinationMarker);
        }

        destinationMarker = L.marker([
            destinationLocation.lat,
            destinationLocation.lng
        ])
        .addTo(map)
        .bindPopup("Destination: " + results[0].display_name);

        destinationMarker.openPopup();

        map.setView([
            destinationLocation.lat,
            destinationLocation.lng
        ], 15);

        updateNavigationStatus(
            "Destination selected. Click Start Navigation."
        );

    } catch (error) {
        console.error("Destination search error:", error);

        updateNavigationStatus(
            "Destination search failed. Check your internet connection."
        );
    }
}

// =====================================================
// START NAVIGATION
// =====================================================

function startNavigation() {
    if (!destinationLocation) {
        alert("Please search for a destination first.");
        return;
    }

    if (!navigator.geolocation) {
        alert("Your browser does not support location access.");
        return;
    }

    if (locationWatcher !== null) {
        navigator.geolocation.clearWatch(locationWatcher);
        locationWatcher = null;
    }

    navigationActive = true;
    warnedReportIds.clear();

    updateNavigationStatus("Getting current location...");

    navigator.geolocation.getCurrentPosition(
        function (position) {
            if (!navigationActive) {
                return;
            }

            updateLocationFromPosition(position);

            calculateRoute();

            locationWatcher = navigator.geolocation.watchPosition(
                function (updatedPosition) {
                    if (!navigationActive) {
                        return;
                    }

                    updateLocationFromPosition(updatedPosition);
                    checkReportedBarriers();
                },

                handleLocationError,

                {
                    enableHighAccuracy: true,
                    maximumAge: 5000,
                    timeout: 20000
                }
            );
        },

        function (error) {
            navigationActive = false;
            handleLocationError(error);
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 30000
        }
    );
}

// =====================================================
// CALCULATE ROUTE
// =====================================================

async function calculateRoute() {
    if (!currentLocation || !destinationLocation) {
        return;
    }

    updateNavigationStatus("Calculating route...");

    const start =
        currentLocation.lng + "," + currentLocation.lat;

    const end =
        destinationLocation.lng + "," + destinationLocation.lat;

    const url =
        ROUTING_URL +
        start + ";" + end +
        "?overview=full&geometries=geojson&steps=true";

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Routing service unavailable.");
        }

        const data = await response.json();

        if (
            data.code !== "Ok" ||
            !data.routes ||
            !data.routes.length
        ) {
            updateNavigationStatus("No route found.");
            return;
        }

        const coordinates =
            data.routes[0].geometry.coordinates.map(
                function (point) {
                    return [point[1], point[0]];
                }
            );

        navigationLayer.clearLayers();

        routeLine = L.polyline(
            coordinates,
            {
                color: "#087f5b",
                weight: 6,
                opacity: 0.85
            }
        ).addTo(navigationLayer);

        map.fitBounds(routeLine.getBounds(), {
            padding: [40, 40]
        });

        updateNavigationStatus(
            "Route displayed. Live location tracking is active."
        );

        checkReportedBarriers();

    } catch (error) {
        console.error("Route calculation error:", error);

        updateNavigationStatus(
            "Unable to calculate route. Please try again."
        );
    }
}

// =====================================================
// CHECK NEARBY BARRIERS
// =====================================================

function checkReportedBarriers() {
    if (!navigationActive || !currentLocation) {
        return;
    }

    const nearbyReports = allReports
        .filter(function (report) {
            if (
                String(report.status || "").toLowerCase() === "resolved"
            ) {
                return false;
            }

            const latitude = Number(report.latitude);
            const longitude = Number(report.longitude);

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ) {
                return false;
            }

            return getDistanceInMeters(
                currentLocation.lat,
                currentLocation.lng,
                latitude,
                longitude
            ) <= BARRIER_WARNING_DISTANCE;
        })
        .sort(function (a, b) {
            return getDistanceInMeters(
                currentLocation.lat,
                currentLocation.lng,
                Number(a.latitude),
                Number(a.longitude)
            ) - getDistanceInMeters(
                currentLocation.lat,
                currentLocation.lng,
                Number(b.latitude),
                Number(b.longitude)
            );
        });

    if (!nearbyReports.length) {
        updateNavigationStatus(
            "Navigation active. No unresolved reports detected within 150 metres."
        );
        return;
    }

    const report = nearbyReports[0];

    const reportId = String(
        report._id ||
        report.id ||
        report.latitude + "," + report.longitude
    );

    if (!warnedReportIds.has(reportId)) {
        warnedReportIds.add(reportId);

        alert(
            "ACCESSIBILITY BARRIER NEARBY\n\n" +
            "Type: " + (report.type || "Unknown") + "\n" +
            "Severity: " + (report.severity || "Unknown") + "\n" +
            "Description: " +
            (report.description || "No description") +
            "\n\nPlease proceed carefully. An accessible alternative route has not been verified."
        );
    }

    updateNavigationStatus(
        "Warning: an unresolved accessibility barrier is nearby."
    );
}

// =====================================================
// DISTANCE CALCULATION
// =====================================================

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;

    const radians = function (degrees) {
        return degrees * Math.PI / 180;
    };

    const differenceLat = radians(lat2 - lat1);
    const differenceLng = radians(lon2 - lon1);

    const a =
        Math.sin(differenceLat / 2) ** 2 +
        Math.cos(radians(lat1)) *
        Math.cos(radians(lat2)) *
        Math.sin(differenceLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

// =====================================================
// STOP NAVIGATION
// =====================================================

function stopNavigation() {
    navigationActive = false;

    if (locationWatcher !== null) {
        navigator.geolocation.clearWatch(locationWatcher);
        locationWatcher = null;
    }

    currentLocation = null;

    if (currentLocationMarker) {
        map.removeLayer(currentLocationMarker);
        currentLocationMarker = null;
    }

    navigationLayer.clearLayers();

    routeLine = null;

    updateNavigationStatus(
        "Navigation and live location tracking stopped."
    );
}

// =====================================================
// INITIALIZE APPLICATION
// =====================================================

loadReports();

console.log("Accessible Transit map.js loaded successfully.");

