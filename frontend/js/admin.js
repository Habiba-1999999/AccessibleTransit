// =====================================================
// RENDER REPORT TABLE
// =====================================================

function renderReports() {
    if (!tableBody) {
        return;
    }

    if (filteredReports.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">No reports found.</td>
            </tr>
        `;

        if (reportCountElement) {
            reportCountElement.textContent =
                `Showing 0 of ${allReports.length} reports`;
        }

        return;
    }

    tableBody.innerHTML = filteredReports.map(report => {
        const id = getReportId(report);
        const safeId = escapeHTML(id);
        const shortId = id ? escapeHTML(id.slice(-8)) : "Unavailable";

        const type = escapeHTML(getProblemType(report));
        const severity = getSeverity(report);
        const status = getStatus(report);

        const latitude = getLatitude(report);
        const longitude = getLongitude(report);

        const location =
            latitude !== null && longitude !== null
                ? `${escapeHTML(latitude)}, ${escapeHTML(longitude)}`
                : "Unavailable";

        const reportedDate = formatDate(
            report.createdAt || report.reportedAt || report.date
        );

        const severityClass = `severity-${severity.toLowerCase()}`;

        let statusClass = "status-pending";

        if (status === "In Progress") {
            statusClass = "status-in-progress";
        }

        return `
            <tr>
                <td title="${safeId}">${shortId}</td>
                <td><strong>${type}</strong></td>
                <td>
                    <span class="${severityClass}">
                        ${escapeHTML(severity)}
                    </span>
                </td>
                <td>${location}</td>
                <td>${escapeHTML(reportedDate)}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${escapeHTML(status)}
                    </span>
                </td>
                <td>
                    <select
                        class="status-select"
                        id="status-${safeId}"
                        aria-label="Change report status"
                    >
                        <option value="Pending"
                            ${status === "Pending" ? "selected" : ""}>
                            Pending
                        </option>

                        <option value="In Progress"
                            ${status === "In Progress" ? "selected" : ""}>
                            In Progress
                        </option>

                        <option value="Resolved"
                            ${status === "Resolved" ? "selected" : ""}>
                            Resolved
                        </option>
                    </select>

                    <button
                        type="button"
                        class="save-btn"
                        data-action="save-status"
                        data-id="${safeId}"
                    >
                        Save
                    </button>
                </td>
                <td>
                    <button
                        type="button"
                        class="view-btn"
                        data-action="view"
                        data-id="${safeId}"
                    >
                        View Details
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    if (reportCountElement) {
        reportCountElement.textContent =
            `Showing ${filteredReports.length} of ${allReports.length} reports`;
    }
}

// =====================================================
// UPDATE REPORT STATUS
// RESOLVED REPORTS ARE DELETED BY THE BACKEND
// =====================================================

async function updateReportStatus(reportId, newStatus) {
    const report = allReports.find(
        item => getReportId(item) === reportId
    );

    if (!report) {
        showNotice("Report not found.", "error");
        return;
    }

    if (getStatus(report) === newStatus) {
        showNotice("The report already has this status.");
        return;
    }

    if (!["Pending", "In Progress", "Resolved"].includes(newStatus)) {
        showNotice("Invalid status selected.", "error");
        return;
    }

    if (newStatus === "Resolved") {
        const confirmed = window.confirm(
            "Confirm that this accessibility problem has been resolved?\n\n" +
            "The report will be permanently deleted from the database."
        );

        if (!confirmed) {
            return;
        }
    }

    const currentUser = getCurrentAdmin();

    const adminName =
        currentUser.name ||
        currentUser.email ||
        "Administrator";

    let resolutionNotes = "";

    if (newStatus === "Resolved") {
        const notes = window.prompt(
            "Enter details explaining how the problem was resolved:"
        );

        if (notes === null || !notes.trim()) {
            showNotice("Resolution details are required.", "error");
            return;
        }

        resolutionNotes = notes.trim();
    }

    const statusButton = document.querySelector(
        `[data-action="save-status"][data-id="${CSS.escape(reportId)}"]`
    );

    if (statusButton) {
        statusButton.disabled = true;
        statusButton.textContent = "Saving...";
    }

    if (saveModalStatusBtn) {
        saveModalStatusBtn.disabled = true;
    }

    try {
        const result = await apiRequest(
            `/admin/reports/${encodeURIComponent(reportId)}/status`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    status: statusForBackend(newStatus),
                    resolutionNotes,
                    resolvedBy: adminName
                })
            }
        );

        if (newStatus === "Resolved") {
            if (!result.deleted) {
                throw new Error(
                    "The server did not confirm report deletion. " +
                    "Check the resolved-status route in backend/server.js."
                );
            }

            allReports = allReports.filter(
                item => getReportId(item) !== reportId
            );

            filteredReports = filteredReports.filter(
                item => getReportId(item) !== reportId
            );

            if (
                selectedReport &&
                getReportId(selectedReport) === reportId
            ) {
                closeReportModal();
            }

            updateDashboardStatistics();
            applyFilters();

            showNotice(
                "Problem resolved. The report has been permanently deleted."
            );
        } else {
            showNotice(
                result.message ||
                `Report status updated to ${newStatus}.`
            );

            await loadReports();
        }
    } catch (error) {
        console.error("Status update failed:", error);

        showNotice(
            "Unable to update report: " + error.message,
            "error"
        );
    } finally {
        if (statusButton) {
            statusButton.disabled = false;
            statusButton.textContent = "Save";
        }

        if (saveModalStatusBtn) {
            saveModalStatusBtn.disabled = false;
        }
    }
}

// =====================================================
// IMAGE URL
// =====================================================

function getImageURL(image) {
    if (typeof image !== "string" || !image.trim()) {
        return "";
    }

    const value = image.trim();

    if (/^https?:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);

            if (!["http:", "https:"].includes(parsed.protocol)) {
                return "";
            }

            return parsed.href;
        } catch (error) {
            return "";
        }
    }

    if (
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\") &&
        !value.split("/").includes("..")
    ) {
        return `${window.location.origin}${value}`;
    }

    if (
        !value.startsWith("/") &&
        !value.includes("\\") &&
        !value.split("/").includes("..") &&
        /^[a-zA-Z0-9._/-]+$/.test(value)
    ) {
        return `${window.location.origin}/${value}`;
    }

    return "";
}

// =====================================================
// VIEW REPORT DETAILS
// =====================================================

function displayReportDetails(report) {
    if (!reportDetails || !reportModal) {
        return;
    }

    const id = getReportId(report);
    const latitude = getLatitude(report);
    const longitude = getLongitude(report);
    const severity = getSeverity(report);
    const status = getStatus(report);
    const image = getImage(report);

    let imageHTML = "<p>No image was uploaded.</p>";

    if (image) {
        const imageURL = getImageURL(image);

        if (imageURL) {
            imageHTML = `
                <img
                    src="${escapeHTML(imageURL)}"
                    class="report-image"
                    alt="Reported accessibility problem"
                    onerror="this.style.display='none';"
                >
            `;
        }
    }

    let mapLink = "";

    if (latitude !== null && longitude !== null) {
        mapLink =
            `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}` +
            `&mlon=${encodeURIComponent(longitude)}` +
            `#map=18/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
    }

    reportDetails.innerHTML = `
        <div class="detail-row">
            <strong>Report ID</strong>
            <span>${escapeHTML(id || "Unavailable")}</span>
        </div>

        <div class="detail-row">
            <strong>Problem Type</strong>
            <span>${escapeHTML(getProblemType(report))}</span>
        </div>

        <div class="detail-row">
            <strong>Description</strong>
            <span>${escapeHTML(getDescription(report))}</span>
        </div>

        <div class="detail-row">
            <strong>Severity</strong>
            <span>${escapeHTML(severity)}</span>
        </div>

        <div class="detail-row">
            <strong>Current Status</strong>
            <span>${escapeHTML(status)}</span>
        </div>

        <div class="detail-row">
            <strong>Latitude</strong>
            <span>${escapeHTML(latitude ?? "Unavailable")}</span>
        </div>

        <div class="detail-row">
            <strong>Longitude</strong>
            <span>${escapeHTML(longitude ?? "Unavailable")}</span>
        </div>

        <div class="detail-row">
            <strong>Reported Date</strong>
            <span>${escapeHTML(
                formatDate(report.createdAt || report.reportedAt || report.date)
            )}</span>
        </div>

        <div class="detail-row">
            <strong>Reported Image</strong>
            ${imageHTML}
        </div>

        ${
            mapLink
                ? `
                    <div class="detail-row">
                        <strong>Map Location</strong>
                        <a
                            href="${escapeHTML(mapLink)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Open location in OpenStreetMap
                        </a>
                    </div>
                `
                : ""
        }

        <div class="detail-row">
            <strong>Update Status</strong>

            <select id="modalStatusSelect" class="status-select">
                <option value="Pending"
                    ${status === "Pending" ? "selected" : ""}>
                    Pending
                </option>

                <option value="In Progress"
                    ${status === "In Progress" ? "selected" : ""}>
                    In Progress
                </option>

                <option value="Resolved"
                    ${status === "Resolved" ? "selected" : ""}>
                    Resolved
                </option>
            </select>
        </div>
    `;

    reportModal.style.display = "block";
}

// =====================================================
// CLOSE DETAILS MODAL
// =====================================================

function closeReportModal() {
    if (reportModal) {
        reportModal.style.display = "none";
    }

    selectedReport = null;
}

// =====================================================
// CSV DOWNLOAD
// =====================================================

function escapeCSV(value) {
    let text = String(value ?? "");

    if (/^[\s]*[=+\-@]/.test(text)) {
        text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(reports, filename) {
    if (!reports.length) {
        showNotice("There are no reports to download.", "error");
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
        "Reported Date",
        "Status",
        "Image"
    ];

    const rows = reports.map(report => [
        getReportId(report),
        getProblemType(report),
        getDescription(report),
        getSeverity(report),
        getLatitude(report),
        getLongitude(report),
        report.userName || "",
        report.userEmail || "",
        formatDate(report.createdAt || report.reportedAt || report.date),
        getStatus(report),
        getImage(report)
    ]);

    const csvContent = [headers, ...rows]
        .map(row => row.map(escapeCSV).join(","))
        .join("\r\n");

    const blob = new Blob(
        ["\uFEFF", csvContent],
        { type: "text/csv;charset=utf-8;" }
    );

    const downloadURL = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadURL;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);

    showNotice(`${reports.length} report(s) downloaded successfully.`);
}

// =====================================================
// EVENT LISTENERS
// =====================================================

if (refreshBtn) {
    refreshBtn.addEventListener("click", loadReports);
}

if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
}

if (statusFilter) {
    statusFilter.addEventListener("change", applyFilters);
}

if (severityFilter) {
    severityFilter.addEventListener("change", applyFilters);
}

if (downloadAllBtn) {
    downloadAllBtn.addEventListener("click", () => {
        downloadCSV(
            allReports,
            "accessible-transit-all-reports.csv"
        );
    });
}

if (downloadFilteredBtn) {
    downloadFilteredBtn.addEventListener("click", () => {
        downloadCSV(
            filteredReports,
            "accessible-transit-filtered-reports.csv"
        );
    });
}

// =====================================================
// REPORT TABLE BUTTONS
// =====================================================

if (tableBody) {
    tableBody.addEventListener("click", event => {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const action = button.dataset.action;
        const reportId = button.dataset.id;

        if (!reportId) {
            showNotice("Report ID is missing.", "error");
            return;
        }

        if (action === "view") {
            const report = allReports.find(
                item => getReportId(item) === reportId
            );

            if (report) {
                selectedReport = report;
                displayReportDetails(report);
            }
        }

        if (action === "save-status") {
            const select = document.getElementById(`status-${reportId}`);

            if (select) {
                updateReportStatus(reportId, select.value);
            }
        }
    });
}

// =====================================================
// SAVE STATUS FROM DETAILS MODAL
// =====================================================

if (saveModalStatusBtn) {
    saveModalStatusBtn.addEventListener("click", () => {
        if (!selectedReport) {
            showNotice("Please select a report.", "error");
            return;
        }

        const select = document.getElementById("modalStatusSelect");

        if (!select) {
            showNotice("Status selector was not found.", "error");
            return;
        }

        updateReportStatus(
            getReportId(selectedReport),
            select.value
        );
    });
}

// =====================================================
// CLOSE MODAL
// =====================================================

if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeReportModal);
}

if (closeModalBottomBtn) {
    closeModalBottomBtn.addEventListener("click", closeReportModal);
}

if (reportModal) {
    reportModal.addEventListener("click", event => {
        if (event.target === reportModal) {
            closeReportModal();
        }
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeReportModal();
    }
});

// =====================================================
// ADMIN LOGOUT
// =====================================================

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        const confirmed = window.confirm(
            "Are you sure you want to log out?"
        );

        if (!confirmed) {
            return;
        }

        localStorage.removeItem("accessToken");
        localStorage.removeItem("token");
        localStorage.removeItem("user");

        window.location.replace("login.html");
    });
}

// =====================================================
// START ADMIN DASHBOARD
// =====================================================

if (ensureAdminSession()) {
    loadReports();
}