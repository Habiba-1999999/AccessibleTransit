// =====================================================
// ACCESSIBLE TRANSIT - ADMIN DASHBOARD
// Matches admin.html and backend/server.js
// =====================================================

"use strict";

// =====================================================
// CONFIGURATION
// =====================================================

const ADMIN_BACKEND_URL = "https://accessibletransit.onrender.com";

const ADMIN_LOGIN_URL = ADMIN_BACKEND_URL + "/api/admin/login";

const ADMIN_REPORTS_URL = ADMIN_BACKEND_URL + "/api/admin/reports";

const ADMIN_ME_URL = ADMIN_BACKEND_URL + "/api/me";

const ADMIN_STATUS_URL = ADMIN_BACKEND_URL + "/api/admin/reports";

// =====================================================
// DOM ELEMENTS
// =====================================================

const $ = id => document.getElementById(id);

const loginPage = $("loginPage");
const dashboardPage = $("dashboardPage");

const adminLoginForm = $("adminLoginForm");
const adminEmail = $("adminEmail");
const adminPassword = $("adminPassword");
const loginError = $("loginError");
const loginBtn = $("loginBtn");

const adminIdentity = $("adminIdentity");
const logoutBtn = $("logoutBtn");
const refreshBtn = $("refreshBtn");

const totalCount = $("totalCount");
const pendingCount = $("pendingCount");
const progressCount = $("progressCount");
const resolvedCount = $("resolvedCount");

const reportsTableBody = $("reportsTableBody");

const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const severityFilter = $("severityFilter");

const downloadBtn = $("downloadBtn");

const reportModal = $("reportModal");
const updateForm = $("updateForm");
const reportIdInput = $("reportId");
const newStatus = $("newStatus");
const resolutionNotes = $("resolutionNotes");
const resolvedBy = $("resolvedBy");
const modalTitle = $("modalTitle");
const cancelBtn = $("cancelBtn");
const saveBtn = $("saveBtn");
const toast = $("toast");

// =====================================================
// GLOBAL VARIABLES
// =====================================================

let allReports = [];
let filteredReports = [];
let selectedReport = null;

// =====================================================
// AUTHENTICATION HELPERS
// =====================================================

function getToken() {

    return (
        localStorage.getItem("accessToken") ||
        localStorage.getItem("token") ||
        ""
    );

}

function getCurrentUser() {

    try {

        return JSON.parse(
            localStorage.getItem("user") || "{}"
        );

    } catch {

        return {};

    }

}

function saveSession(token, user) {

    localStorage.setItem("accessToken", token);

    localStorage.setItem("token", token);

    localStorage.setItem(
        "user",
        JSON.stringify(user)
    );

}

function clearSession() {

    localStorage.removeItem("accessToken");

    localStorage.removeItem("token");

    localStorage.removeItem("user");

}

function showLogin() {

    loginPage.classList.remove("hidden");

    dashboardPage.classList.add("hidden");

}

function showDashboard(user) {

    loginPage.classList.add("hidden");

    dashboardPage.classList.remove("hidden");

    adminIdentity.textContent =
        user.name || user.email || "Administrator";

    resolvedBy.value =
        user.name || "Administrator";

}

// =====================================================
// NOTIFICATION
// =====================================================

function showToast(message, type = "success") {

    toast.textContent = message;

    toast.classList.remove("error-toast");

    if (type === "error") {

        toast.classList.add("error-toast");

    }

    toast.classList.add("show");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {

        toast.classList.remove("show");

    }, 3500);

}

// =====================================================
// API REQUEST
// =====================================================

async function apiRequest(url, options = {}) {

    const headers = {

        Accept: "application/json",

        ...(options.headers || {})

    };

    const token = getToken();

    if (token) {

        headers.Authorization = "Bearer " + token;

    }

    if (
        options.body &&
        !headers["Content-Type"]
    ) {

        headers["Content-Type"] = "application/json";

    }

    let response;

    try {

        response = await fetch(url, {

            ...options,

            headers

        });

    } catch (error) {

        console.error("Network error:", error);

        throw new Error(
            "Unable to connect to the server. Please check your internet connection."
        );

    }

    const text = await response.text();

    let result = {};

    try {

        result = text ? JSON.parse(text) : {};

    } catch {

        throw new Error("Invalid response received from the server.");

    }

    if (response.status === 401 || response.status === 403) {

        throw new Error(
            result.message || "Your administrator session is invalid."
        );

    }

    if (!response.ok || result.success === false) {

        throw new Error(
            result.message || "Request failed."
        );

    }

    return result;

}

// =====================================================
// ADMIN LOGIN
// =====================================================

adminLoginForm.addEventListener("submit", async function (event) {

    event.preventDefault();

    loginError.textContent = "";

    const email = adminEmail.value.trim().toLowerCase();

    const password = adminPassword.value;

    if (!email || !password) {

        loginError.textContent =
            "Please enter your email and password.";

        return;

    }

    loginBtn.disabled = true;

    loginBtn.textContent = "Logging in...";

    try {

        // Your backend uses POST /api/admin/login.

        const result = await apiRequest(

            ADMIN_LOGIN_URL,

            {

                method: "POST",

                headers: {

                    "Content-Type": "application/json"

                },

                body: JSON.stringify({

                    email: email,

                    password: password

                })

            }

        );

        // Your backend returns token and user.

        if (!result.token || !result.user) {

            throw new Error(
                "Login response does not contain an authentication token."
            );

        }

        if (
            !result.user.role ||
            result.user.role.toLowerCase() !== "admin"
        ) {

            throw new Error(
                "This account does not have administrator access."
            );

        }

        // Save authentication details.

        saveSession(result.token, result.user);

        // Open dashboard.

        showDashboard(result.user);

        // Clear password field.

        adminPassword.value = "";

        showToast("Administrator login successful!");

        // Load reports.

        await loadReports();

    } catch (error) {

        console.error("Admin login failed:", error);

        clearSession();

        showLogin();

        loginError.textContent = error.message;

    } finally {

        loginBtn.disabled = false;

        loginBtn.textContent = "Login as Administrator";

    }

});

// =====================================================
// CHECK EXISTING SESSION
// =====================================================

async function checkExistingSession() {

    const token = getToken();

    if (!token) {

        clearSession();

        showLogin();

        return;

    }

    try {

        const result = await apiRequest(ADMIN_ME_URL);

        if (
            !result.user ||
            result.user.role !== "admin"
        ) {

            throw new Error("Administrator access required.");

        }

        saveSession(token, result.user);

        showDashboard(result.user);

        await loadReports();

    } catch (error) {

        console.log("Session validation:", error.message);

        clearSession();

        showLogin();

    }

}

// =====================================================
// REPORT HELPERS
// =====================================================

function getReportId(report) {

    return String(report._id || report.id || "");

}

function getReportStatus(report) {

    const status = String(
        report.status || "Pending"
    ).toLowerCase();

    if (
        status === "resolved" ||
        status === "completed"
    ) {

        return "Completed";

    }

    if (
        status === "in progress" ||
        status === "in-progress"
    ) {

        return "In Progress";

    }

    return "Pending";

}

function getReportSeverity(report) {

    const value = String(
        report.severity || "Medium"
    ).toLowerCase();

    if (value === "high") return "High";

    if (value === "low") return "Low";

    return "Medium";

}

function getReportImage(report) {

    return (
        report.imageUrl ||
        report.image ||
        report.imagePath ||
        report.photo ||
        ""
    );

}

function getImageURL(image) {

    if (!image) return "";

    if (typeof image === "object") {

        image =
            image.url ||
            image.path ||
            image.filename ||
            "";

    }

    if (typeof image !== "string") return "";

    image = image.trim().replace(/\\/g, "/");

    if (/^https?:\/\//i.test(image)) {

        return image;

    }

    const index = image.toLowerCase().lastIndexOf("/uploads/");

    if (index !== -1) {

        image = image.substring(index + 1);

    } else {

        image = image.replace(/^\/+/, "");

    }

    if (!image.startsWith("uploads/")) {

        image = "uploads/" + image.split("/").pop();

    }

    return ADMIN_BACKEND_URL + "/" +
        image.split("/").map(encodeURIComponent).join("/");

}

function getReportDate(report) {

    const date = new Date(
        report.createdAt || report.updatedAt || ""
    );

    if (Number.isNaN(date.getTime())) {

        return "Unavailable";

    }

    return date.toLocaleString("en-IN");

}

function escapeHTML(value) {

    return String(value ?? "").replace(/[&<>"']/g, character => ({

        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"

    })[character]);

}

// =====================================================
// LOAD REPORTS
// =====================================================

async function loadReports() {

    reportsTableBody.innerHTML = `

        <tr>
            <td colspan="10" class="message">
                Loading reports...
            </td>
        </tr>

    `;

    refreshBtn.disabled = true;

    try {

        const result = await apiRequest(
            ADMIN_REPORTS_URL
        );

        if (!Array.isArray(result.reports)) {

            throw new Error("Reports list was not received.");

        }

        allReports = result.reports;

        updateStatistics();

        applyFilters();

    } catch (error) {

        console.error("Reports loading error:", error);

        reportsTableBody.innerHTML = `

            <tr>
                <td colspan="10" class="message error">
                    ${escapeHTML(error.message)}
                </td>
            </tr>

        `;

        showToast(error.message, "error");

        if (
            error.message.toLowerCase().includes("session") ||
            error.message.toLowerCase().includes("administrator access")
        ) {

            clearSession();

            showLogin();

        }

    } finally {

        refreshBtn.disabled = false;

    }

}

// =====================================================
// STATISTICS
// =====================================================

function updateStatistics() {

    totalCount.textContent = allReports.length;

    pendingCount.textContent = allReports.filter(
        report => getReportStatus(report) === "Pending"
    ).length;

    progressCount.textContent = allReports.filter(
        report => getReportStatus(report) === "In Progress"
    ).length;

    resolvedCount.textContent = allReports.filter(
        report => getReportStatus(report) === "Completed"
    ).length;

}

// =====================================================
// FILTERS
// =====================================================

function applyFilters() {

    const search = searchInput.value.trim().toLowerCase();

    const status = statusFilter.value;

    const severity = severityFilter.value;

    filteredReports = allReports.filter(report => {

        const searchText = [

            report._id,
            report.type,
            report.description,
            report.userName,
            report.userEmail,
            report.latitude,
            report.longitude

        ].join(" ").toLowerCase();

        const matchesSearch =
            !search || searchText.includes(search);

        const matchesStatus =
            status === "all" ||
            getReportStatus(report) === status;

        const matchesSeverity =
            severity === "all" ||
            getReportSeverity(report) === severity;

        return (
            matchesSearch &&
            matchesStatus &&
            matchesSeverity
        );

    });

    renderReports();

}

// =====================================================
// RENDER REPORT TABLE
// =====================================================

function renderReports() {

    if (!filteredReports.length) {

        reportsTableBody.innerHTML = `

            <tr>
                <td colspan="10" class="message">
                    No reports found.
                </td>
            </tr>

        `;

        return;

    }

    reportsTableBody.innerHTML = filteredReports.map(report => {

        const id = getReportId(report);

        const status = getReportStatus(report);

        const severity = getReportSeverity(report);

        const latitude = Number(report.latitude);

        const longitude = Number(report.longitude);

        const hasCoordinates =
            Number.isFinite(latitude) &&
            Number.isFinite(longitude);

        const location = hasCoordinates
            ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
            : "Unavailable";

        const mapLink = hasCoordinates
            ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`
            : "";

        const imageURL = getImageURL(getReportImage(report));

        const imageHTML = imageURL

            ? `
                <a href="${escapeHTML(imageURL)}"
                   target="_blank"
                   rel="noopener noreferrer">

                    <img
                        src="${escapeHTML(imageURL)}"
                        class="report-image"
                        alt="Reported accessibility problem"
                        onerror="this.style.display='none';this.nextElementSibling.style.display='inline';"
                    >

                    <span class="image-error" style="display:none;">
                        Image unavailable
                    </span>

                </a>
            `

            : "No image uploaded";

        let severityClass = "severity-medium";

        if (severity === "High") {
            severityClass = "severity-high";
        }

        if (severity === "Low") {
            severityClass = "severity-low";
        }

        let statusClass = "status-pending";

        if (status === "In Progress") {
            statusClass = "status-in-progress";
        }

        if (status === "Completed") {
            statusClass = "status-completed";
        }

        const resolutionDetails =
            report.resolutionNotes || "Not available";

        return `

            <tr>

                <td title="${escapeHTML(id)}">
                    ${escapeHTML(id.slice(-8))}
                </td>

                <td>
                    ${escapeHTML(report.type || "Unavailable")}
                </td>

                <td class="report-description">
                    ${escapeHTML(report.description || "Unavailable")}
                </td>

                <td class="location">

                    ${escapeHTML(location)}

                    ${
                        mapLink
                            ? `
                                <br>
                                <a href="${mapLink}"
                                   target="_blank"
                                   rel="noopener noreferrer">
                                    View Map
                                </a>
                            `
                            : ""
                    }

                </td>

                <td>
                    <span class="badge ${severityClass}">
                        ${severity}
                    </span>
                </td>

                <td>
                    ${imageHTML}
                </td>

                <td>
                    ${escapeHTML(getReportDate(report))}
                </td>

                <td>
                    <span class="badge ${statusClass}">
                        ${status}
                    </span>
                </td>

                <td class="report-description">
                    ${escapeHTML(resolutionDetails)}
                </td>

                <td>

                    <div class="action-buttons">

                        <button
                            type="button"
                            class="small-button details-button"
                            data-action="edit"
                            data-id="${escapeHTML(id)}">

                            Update Status

                        </button>

                    </div>

                </td>

            </tr>

        `;

    }).join("");

}

// =====================================================
// OPEN UPDATE MODAL
// =====================================================

function openUpdateModal(report) {

    selectedReport = report;

    reportIdInput.value = getReportId(report);

    newStatus.value = getReportStatus(report);

    resolutionNotes.value =
        report.resolutionNotes || "";

    resolvedBy.value =
        report.resolvedBy ||
        getCurrentUser().name ||
        "Administrator";

    modalTitle.textContent =
        "Update Accessibility Report";

    reportModal.classList.add("active");

}

// =====================================================
// CLOSE MODAL
// =====================================================

function closeModal() {

    reportModal.classList.remove("active");

    selectedReport = null;

}

// =====================================================
// TABLE ACTIONS
// =====================================================

reportsTableBody.addEventListener("click", function (event) {

    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const id = button.dataset.id;

    const report = allReports.find(
        item => getReportId(item) === id
    );

    if (!report) {

        showToast("Report not found.", "error");

        return;

    }

    if (button.dataset.action === "edit") {

        openUpdateModal(report);

    }

});

// =====================================================
// SAVE REPORT STATUS
// =====================================================

updateForm.addEventListener("submit", async function (event) {

    event.preventDefault();

    const id = reportIdInput.value;

    const selectedStatus = newStatus.value;

    const notes = resolutionNotes.value.trim();

    const adminName = resolvedBy.value.trim();

    if (!id || !adminName) {

        showToast(
            "Please fill in all required fields.",
            "error"
        );

        return;

    }

    if (
        selectedStatus === "Completed" &&
        !notes
    ) {

        showToast(
            "Please enter resolution details.",
            "error"
        );

        return;

    }

    saveBtn.disabled = true;

    saveBtn.textContent = "Saving...";

    // Backend expects Resolved, not Completed.

    const backendStatus =
        selectedStatus === "Completed"
            ? "Resolved"
            : selectedStatus;

    try {

        const result = await apiRequest(

            ADMIN_STATUS_URL + "/" +
            encodeURIComponent(id) + "/status",

            {

                method: "PATCH",

                body: JSON.stringify({

                    status: backendStatus,

                    resolutionNotes: notes,

                    resolvedBy: adminName

                })

            }

        );

        showToast(
            result.message || "Report updated successfully."
        );

        closeModal();

        await loadReports();

    } catch (error) {

        console.error("Status update error:", error);

        showToast(error.message, "error");

    } finally {

        saveBtn.disabled = false;

        saveBtn.textContent = "Save Update";

    }

});

// =====================================================
// CSV DOWNLOAD
// =====================================================

function escapeCSV(value) {

    let text = String(value ?? "");

    if (/^[\s]*[=+\-@]/.test(text)) {

        text = "'" + text;

    }

    return '"' + text.replace(/"/g, '""') + '"';

}

function downloadCSV() {

    if (!filteredReports.length) {

        showToast(
            "No reports available to download.",
            "error"
        );

        return;

    }

    const headers = [

        "Report ID",
        "Problem Type",
        "Description",
        "Severity",
        "Latitude",
        "Longitude",
        "Reporter Name",
        "Reporter Email",
        "Date",
        "Status",
        "Resolution Details",
        "Resolved By"

    ];

    const rows = filteredReports.map(report => [

        getReportId(report),
        report.type,
        report.description,
        getReportSeverity(report),
        report.latitude,
        report.longitude,
        report.userName,
        report.userEmail,
        getReportDate(report),
        getReportStatus(report),
        report.resolutionNotes,
        report.resolvedBy

    ]);

    const csv = [headers, ...rows]

        .map(row => row.map(escapeCSV).join(","))

        .join("\r\n");

    const blob = new Blob(

        ["\uFEFF", csv],

        { type: "text/csv;charset=utf-8;" }

    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = "accessible-transit-reports.csv";

    document.body.appendChild(link);

    link.click();

    link.remove();

    URL.revokeObjectURL(url);

    showToast("CSV downloaded successfully.");

}

// =====================================================
// EVENT LISTENERS
// =====================================================

refreshBtn.addEventListener("click", loadReports);

searchInput.addEventListener("input", applyFilters);

statusFilter.addEventListener("change", applyFilters);

severityFilter.addEventListener("change", applyFilters);

downloadBtn.addEventListener("click", downloadCSV);

cancelBtn.addEventListener("click", closeModal);

reportModal.addEventListener("click", function (event) {

    if (event.target === reportModal) {

        closeModal();

    }

});

logoutBtn.addEventListener("click", function () {

    if (!confirm("Are you sure you want to log out?")) {

        return;

    }

    clearSession();

    allReports = [];

    filteredReports = [];

    showLogin();

    showToast("Logged out successfully.");

});

// =====================================================
// START DASHBOARD
// =====================================================

document.addEventListener("DOMContentLoaded", function () {

    console.log("Accessible Transit Admin Dashboard started.");

    checkExistingSession();

});