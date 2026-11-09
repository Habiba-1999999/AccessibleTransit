require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// =====================================================
// ENVIRONMENT CONFIGURATION
// =====================================================

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (!MONGO_URI) {
    console.error("ERROR: MONGO_URI is missing in .env");
    process.exit(1);
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error("ERROR: JWT_SECRET must contain at least 32 characters.");
    process.exit(1);
}

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("ERROR: Configure ADMIN_EMAIL and ADMIN_PASSWORD in .env.");
    process.exit(1);
}

if (ADMIN_PASSWORD.length < 12) {
    console.error("ERROR: ADMIN_PASSWORD must contain at least 12 characters.");
    process.exit(1);
}

// =====================================================
// DIRECTORY CONFIGURATION
// =====================================================

const frontendPath = path.resolve(__dirname, "../frontend");

const uploadsPath = path.resolve(__dirname, "uploads");

fs.mkdirSync(uploadsPath, { recursive: true });

console.log("Frontend directory:", frontendPath);
console.log("Uploads directory:", uploadsPath);

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());

app.use(express.json({
    limit: "1mb"
}));

app.use(express.urlencoded({
    extended: true
}));

// =====================================================
// IMAGE UPLOAD CONFIGURATION
// IMPORTANT: REGISTER BEFORE FRONTEND STATIC ROUTE
// =====================================================

// Make uploaded images publicly accessible.
// Example:
// https://accessibletransit.onrender.com/uploads/image.jpg

app.use(
    "/uploads",
    express.static(uploadsPath, {
        index: false,
        maxAge: "1d",
        setHeaders: function (res) {
            res.setHeader(
                "Access-Control-Allow-Origin",
                "*"
            );

            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );
        }
    })
);

// =====================================================
// FRONTEND STATIC FILES
// =====================================================

app.use(express.static(frontendPath));

// =====================================================
// MULTER STORAGE
// =====================================================

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        cb(null, uploadsPath);

    },

    filename: function (req, file, cb) {

        const extension = path.extname(
            file.originalname
        )
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, "");

        const filename =
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 10) +
            extension;

        cb(null, filename);

    }

});

const upload = multer({

    storage: storage,

    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (allowedTypes.includes(file.mimetype)) {

            return cb(null, true);

        }

        return cb(
            new Error(
                "Only JPEG, PNG, WEBP, and GIF images are allowed."
            )
        );

    }

});

// =====================================================
// USER SCHEMA
// =====================================================

const userSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    password: {
        type: String,
        required: true,
        select: false
    },

    role: {
        type: String,
        enum: ["user", "admin"],
        default: "user"
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});

const User = mongoose.model("User", userSchema);

// =====================================================
// REPORT SCHEMA
// =====================================================

const reportSchema = new mongoose.Schema({

    type: {
        type: String,
        required: true,
        trim: true
    },

    description: {
        type: String,
        required: true,
        trim: true
    },

    severity: {
        type: String,
        required: true,
        enum: ["High", "Medium", "Low"]
    },

    latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90
    },

    longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180
    },

    image: {
        type: String,
        default: null
    },

    userId: {
        type: String,
        default: ""
    },

    userName: {
        type: String,
        default: ""
    },

    userEmail: {
        type: String,
        default: ""
    },

    status: {
        type: String,
        enum: [
            "Reported",
            "Pending",
            "In Progress",
            "Resolved"
        ],
        default: "Reported"
    },

    resolutionNotes: {
        type: String,
        default: ""
    },

    resolvedBy: {
        type: String,
        default: ""
    },

    updatedAt: {
        type: Date,
        default: Date.now
    },

    resolvedAt: {
        type: Date,
        default: null
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});

const Report = mongoose.model("Report", reportSchema);

// =====================================================
// ADMIN ACCOUNT INITIALIZATION
// =====================================================

async function ensureAdminAccount() {

    const email = ADMIN_EMAIL;

    const hashedPassword = await bcrypt.hash(
        ADMIN_PASSWORD,
        12
    );

    const existingUser = await User.findOne({
        email
    }).select("+password");

    if (existingUser) {

        existingUser.name = "Accessible Transit Admin";
        existingUser.email = email;
        existingUser.password = hashedPassword;
        existingUser.role = "admin";

        await existingUser.save();

        console.log("Administrator account synchronized.");

        return;

    }

    const admin = new User({

        name: "Accessible Transit Admin",
        email: email,
        password: hashedPassword,
        role: "admin"

    });

    await admin.save();

    console.log("Administrator account created successfully.");

}

// =====================================================
// AUTHENTICATION MIDDLEWARE
// =====================================================

async function authenticateToken(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {

            return res.status(401).json({

                success: false,
                message: "Please log in first."

            });

        }

        const parts = authHeader.split(" ");

        if (
            parts.length !== 2 ||
            parts[0].toLowerCase() !== "bearer"
        ) {

            return res.status(401).json({

                success: false,
                message: "Invalid authentication format."

            });

        }

        const decoded = jwt.verify(
            parts[1],
            JWT_SECRET
        );

        const user = await User.findById(
            decoded.userId
        );

        if (!user) {

            return res.status(401).json({

                success: false,
                message: "Account not found."

            });

        }

        req.user = user;

        return next();

    } catch (error) {

        return res.status(401).json({

            success: false,
            message: "Invalid or expired login session."

        });

    }

}

function requireAdmin(req, res, next) {

    if (!req.user || req.user.role !== "admin") {

        return res.status(403).json({

            success: false,
            message: "Administrator access is required."

        });

    }

    return next();

}

// =====================================================
// HOME PAGE
// =====================================================

app.get("/", function (req, res) {

    res.sendFile(
        path.join(frontendPath, "index.html")
    );

});

// =====================================================
// API TEST
// =====================================================

app.get("/api/test", function (req, res) {

    res.json({

        success: true,
        message: "Accessible Transit API is working."

    });

});

// =====================================================
// UPLOADS TEST
// =====================================================

app.get("/api/uploads-test", function (req, res) {

    try {

        const files = fs.readdirSync(uploadsPath);

        return res.json({

            success: true,

            message: "Uploads folder is connected.",

            uploadsDirectory: uploadsPath,

            totalImages: files.length,

            files: files

        });

    } catch (error) {

        console.error("UPLOADS TEST ERROR:", error.message);

        return res.status(500).json({

            success: false,
            message: "Unable to read uploads folder."

        });

    }

});

// =====================================================
// USER SIGNUP
// =====================================================

app.post("/api/signup", async function (req, res) {

    try {

        const {
            name,
            email,
            password
        } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {

            return res.status(400).json({

                success: false,
                message: "Please fill in all fields."

            });

        }

        if (password.length < 6) {

            return res.status(400).json({

                success: false,
                message: "Password must contain at least 6 characters."

            });

        }

        const cleanEmail = email
            .trim()
            .toLowerCase();

        if (cleanEmail === ADMIN_EMAIL) {

            return res.status(409).json({

                success: false,
                message: "This email is reserved for the administrator."

            });

        }

        const existingUser = await User.findOne({

            email: cleanEmail

        });

        if (existingUser) {

            return res.status(409).json({

                success: false,
                message: "An account with this email already exists."

            });

        }

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const newUser = new User({

            name: name.trim(),
            email: cleanEmail,
            password: hashedPassword,
            role: "user"

        });

        await newUser.save();

        return res.status(201).json({

            success: true,
            message: "Account created successfully."

        });

    } catch (error) {

        console.error(
            "SIGNUP ERROR:",
            error.message
        );

        if (error.code === 11000) {

            return res.status(409).json({

                success: false,
                message: "An account with this email already exists."

            });

        }

        return res.status(500).json({

            success: false,
            message: "Unable to create account."

        });

    }

});

// =====================================================
// SHARED LOGIN FUNCTION
// =====================================================

async function performLogin(req, res, adminOnly) {

    try {

        const {
            email,
            password
        } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {

            return res.status(400).json({

                success: false,
                message: "Enter your email and password."

            });

        }

        const user = await User.findOne({

            email: email.trim().toLowerCase()

        }).select("+password");

        if (!user) {

            return res.status(401).json({

                success: false,
                message: "Invalid email or password."

            });

        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {

            return res.status(401).json({

                success: false,
                message: "Invalid email or password."

            });

        }

        if (adminOnly && user.role !== "admin") {

            return res.status(403).json({

                success: false,
                message: "This account is not an administrator."

            });

        }

        if (!adminOnly && user.role === "admin") {

            return res.status(403).json({

                success: false,
                message: "Please use the administrator login page."

            });

        }

        const token = jwt.sign(

            {
                userId: user._id.toString(),
                email: user.email
            },

            JWT_SECRET,

            {
                expiresIn: "1d"
            }

        );

        return res.json({

            success: true,

            message: "Login successful.",

            token: token,

            user: {

                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role

            }

        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error.message
        );

        return res.status(500).json({

            success: false,
            message: "Unable to log in."

        });

    }

}

// =====================================================
// USER LOGIN
// =====================================================

app.post("/api/login", function (req, res) {

    return performLogin(req, res, false);

});

// =====================================================
// ADMIN LOGIN
// =====================================================

app.post("/api/admin/login", function (req, res) {

    return performLogin(req, res, true);

});

// =====================================================
// CURRENT LOGGED-IN USER
// =====================================================

app.get(
    "/api/me",
    authenticateToken,
    function (req, res) {

        return res.json({

            success: true,

            user: {

                id: req.user._id.toString(),
                name: req.user.name,
                email: req.user.email,
                role: req.user.role

            }

        });

    }
);

// =====================================================
// CREATE ACCESSIBILITY REPORT
// =====================================================

app.post(
    "/api/reports",

    authenticateToken,

    upload.single("image"),

    async function (req, res) {

        try {

            const {
                type,
                description,
                severity,
                latitude,
                longitude
            } = req.body;

            if (
                typeof type !== "string" ||
                typeof description !== "string" ||
                typeof severity !== "string" ||
                !type.trim() ||
                !description.trim() ||
                !severity.trim() ||
                latitude === undefined ||
                longitude === undefined ||
                latitude === "" ||
                longitude === ""
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Please fill in all required fields."

                });

            }

            if (
                !["High", "Medium", "Low"].includes(
                    severity.trim()
                )
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Invalid severity."

                });

            }

            const lat = Number(latitude);
            const lng = Number(longitude);

            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                lat < -90 ||
                lat > 90 ||
                lng < -180 ||
                lng > 180
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Invalid map coordinates."

                });

            }

            const newReport = new Report({

                type: type.trim(),

                description: description.trim(),

                severity: severity.trim(),

                latitude: lat,

                longitude: lng,

                // Store the public image path in MongoDB.
                image: req.file
                    ? "/uploads/" + req.file.filename
                    : null,

                userId: req.user._id.toString(),

                userName: req.user.name,

                userEmail: req.user.email,

                status: "Reported",

                updatedAt: new Date()

            });

            const savedReport = await newReport.save();

            return res.status(201).json({

                success: true,

                message: "Accessibility report submitted.",

                report: savedReport

            });

        } catch (error) {

            console.error(
                "CREATE REPORT ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to create report."

            });

        }

    }

);

// =====================================================
// PUBLIC REPORTS
// =====================================================

app.get("/api/reports", async function (req, res) {

    try {

        const includeResolved =
            req.query.includeResolved === "true";

        const filter = includeResolved
            ? {}
            : {
                status: {
                    $nin: ["Resolved"]
                }
            };

        const reports = await Report.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        return res.json({

            success: true,

            reports: reports

        });

    } catch (error) {

        console.error(
            "FETCH REPORTS ERROR:",
            error.message
        );

        return res.status(500).json({

            success: false,
            message: "Unable to fetch reports."

        });

    }

});

// =====================================================
// LOGGED-IN USER REPORTS
// =====================================================

app.get(
    "/api/my-reports",

    authenticateToken,

    async function (req, res) {

        try {

            const reports = await Report.find({

                userId: req.user._id.toString()

            })
            .sort({ createdAt: -1 })
            .lean();

            return res.json({

                success: true,

                reports: reports

            });

        } catch (error) {

            console.error(
                "MY REPORTS ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to fetch your reports."

            });

        }

    }
);

// =====================================================
// ADMIN: GET ALL REPORTS
// =====================================================

app.get(
    "/api/admin/reports",

    authenticateToken,

    requireAdmin,

    async function (req, res) {

        try {

            const reports = await Report.find()
                .sort({ createdAt: -1 })
                .lean();

            const normalizedReports = reports.map(
                function (report) {

                    const imagePath = report.image || null;

                    return {

                        ...report,

                        // Preserve the original image field.
                        image: imagePath,

                        // Also provide a consistent image URL field.
                        imageUrl: imagePath
                            ? (
                                /^https?:\/\//i.test(imagePath)
                                    ? imagePath
                                    : "/uploads/" +
                                        String(imagePath)
                                            .replace(/^\/+/, "")
                                            .replace(/^uploads\/+/i, "")
                              )
                            : null,

                        status: report.status === "Reported"
                            ? "Pending"
                            : report.status

                    };

                }
            );

            return res.json({

                success: true,

                reports: normalizedReports

            });

        } catch (error) {

            console.error(
                "ADMIN REPORT FETCH ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to fetch reports."

            });

        }

    }
);

// =====================================================
// ADMIN: UPDATE REPORT STATUS
// =====================================================

app.patch(
    "/api/admin/reports/:id/status",

    authenticateToken,

    requireAdmin,

    async function (req, res) {

        try {

            const { id } = req.params;

            const {
                status,
                resolutionNotes,
                resolvedBy
            } = req.body;

            const normalizedStatus =
                status === "Pending"
                    ? "Reported"
                    : status;

            const allowedStatuses = [

                "Reported",
                "In Progress",
                "Resolved"

            ];

            if (!mongoose.isValidObjectId(id)) {

                return res.status(400).json({

                    success: false,
                    message: "Invalid report ID."

                });

            }

            if (
                !allowedStatuses.includes(normalizedStatus)
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Invalid report status."

                });

            }

            if (
                typeof resolvedBy !== "string" ||
                !resolvedBy.trim()
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Administrator name is required."

                });

            }

            if (
                typeof resolutionNotes !== "string" ||
                (
                    normalizedStatus === "Resolved" &&
                    !resolutionNotes.trim()
                )
            ) {

                return res.status(400).json({

                    success: false,
                    message: "Resolution details are required."

                });

            }

            const report = await Report.findById(id);

            if (!report) {

                return res.status(404).json({

                    success: false,
                    message: "Report not found."

                });

            }

            report.status = normalizedStatus;

            report.resolutionNotes =
                resolutionNotes.trim();

            report.resolvedBy =
                resolvedBy.trim();

            report.updatedAt = new Date();

            if (normalizedStatus === "Resolved") {

                if (!report.resolvedAt) {

                    report.resolvedAt = new Date();

                }

            } else {

                report.resolvedAt = null;

            }

            await report.save();

            const result = report.toObject();

            result.status =
                result.status === "Reported"
                    ? "Pending"
                    : result.status;

            return res.json({

                success: true,

                message: "Report updated successfully.",

                report: result

            });

        } catch (error) {

            console.error(
                "STATUS UPDATE ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to update report status."

            });

        }

    }
);

// =====================================================
// CSV HELPERS
// =====================================================

function csvEscape(value) {

    let text =
        value === null || value === undefined
            ? ""
            : String(value);

    if (/^[\s]*[=+\-@]/.test(text)) {

        text = "'" + text;

    }

    return '"' + text.replace(/"/g, '""') + '"';

}

function formatDate(date) {

    if (!date) {

        return "";

    }

    const parsedDate = new Date(date);

    return Number.isNaN(parsedDate.getTime())
        ? ""
        : parsedDate.toISOString();

}

// =====================================================
// ADMIN: DOWNLOAD REPORTS AS CSV
// =====================================================

app.get(
    "/api/admin/reports/download.csv",

    authenticateToken,

    requireAdmin,

    async function (req, res) {

        try {

            const reports = await Report.find()
                .sort({ createdAt: -1 })
                .lean();

            const columns = [

                "Report ID",
                "Problem Type",
                "Description",
                "Severity",
                "Latitude",
                "Longitude",
                "Image",
                "Reporter Name",
                "Reporter Email",
                "Reported Date and Time (UTC)",
                "Status",
                "Resolution Notes",
                "Resolved By",
                "Last Updated (UTC)",
                "Resolved Date and Time (UTC)"

            ];

            const rows = [columns];

            for (const report of reports) {

                rows.push([

                    report._id,
                    report.type,
                    report.description,
                    report.severity,
                    report.latitude,
                    report.longitude,
                    report.image,
                    report.userName,
                    report.userEmail,
                    formatDate(report.createdAt),

                    report.status === "Reported"
                        ? "Pending"
                        : report.status,

                    report.resolutionNotes,
                    report.resolvedBy,
                    formatDate(report.updatedAt),
                    formatDate(report.resolvedAt)

                ]);

            }

            const csv = rows

                .map(function (row) {

                    return row.map(csvEscape).join(",");

                })

                .join("\r\n");

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="accessible-transit-reports.csv"'
            );

            return res.send("\uFEFF" + csv);

        } catch (error) {

            console.error(
                "CSV DOWNLOAD ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to download reports."

            });

        }

    }
);

// =====================================================
// ADMIN: DASHBOARD STATISTICS
// =====================================================

app.get(
    "/api/admin/dashboard",

    authenticateToken,

    requireAdmin,

    async function (req, res) {

        try {

            const total =
                await Report.countDocuments({});

            const pending =
                await Report.countDocuments({

                    status: {
                        $in: ["Reported", "Pending"]
                    }

                });

            const inProgress =
                await Report.countDocuments({

                    status: "In Progress"

                });

            const resolved =
                await Report.countDocuments({

                    status: "Resolved"

                });

            return res.json({

                success: true,

                statistics: {

                    total,
                    pending,
                    inProgress,
                    resolved

                }

            });

        } catch (error) {

            console.error(
                "ADMIN DASHBOARD ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,
                message: "Unable to fetch dashboard statistics."

            });

        }

    }
);

// =====================================================
// NOT FOUND
// =====================================================

app.use(function (req, res) {

    if (req.path.startsWith("/api/")) {

        return res.status(404).json({

            success: false,
            message: "API endpoint not found."

        });

    }

    return res.status(404).send("Page not found.");

});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use(function (error, req, res, next) {

    if (res.headersSent) {

        return next(error);

    }

    if (error instanceof multer.MulterError) {

        const message =
            error.code === "LIMIT_FILE_SIZE"
                ? "Image size must not exceed 5 MB."
                : error.message;

        return res.status(400).json({

            success: false,
            message: message

        });

    }

    console.error(
        "REQUEST ERROR:",
        error.message
    );

    return res.status(400).json({

        success: false,

        message: error.message || "Request failed."

    });

});

// =====================================================
// MONGODB CONNECTION EVENTS
// =====================================================

mongoose.connection.on("connected", function () {

    console.log("MongoDB connection is active.");

});

mongoose.connection.on("disconnected", function () {

    console.log("WARNING: MongoDB disconnected.");

});

mongoose.connection.on("error", function (error) {

    console.error(
        "MongoDB connection error:",
        error.message
    );

});

// =====================================================
// START SERVER
// =====================================================

async function startServer() {

    try {

        console.log("Connecting to MongoDB...");

        await mongoose.connect(MONGO_URI, {

            serverSelectionTimeoutMS: 10000,

            connectTimeoutMS: 10000

        });

        console.log("MongoDB connected successfully.");

        await ensureAdminAccount();

        app.listen(PORT, function () {

            console.log("");

            console.log("======================================");

            console.log(" Accessible Transit Server Started");

            console.log("======================================");

            console.log(
                "Server: http://localhost:" + PORT
            );

            console.log(
                "Admin:  http://localhost:" + PORT + "/admin.html"
            );

            console.log(
                "API:    http://localhost:" + PORT + "/api/test"
            );

            console.log(
                "Images: http://localhost:" + PORT + "/uploads/"
            );

            console.log(
                "Uploads folder: " + uploadsPath
            );

            console.log("======================================");

            console.log("");

        });

    } catch (error) {

        console.error("");

        console.error("========== SERVER START FAILED ==========");

        console.error(error.message);

        console.error("=========================================");

        process.exit(1);

    }

}

startServer();