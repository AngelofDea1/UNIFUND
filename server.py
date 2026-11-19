"""SQLite/PostgreSQL-backed hackathon prototype API. Payment flows are sandbox-only."""

import http.server
import socketserver
import json
import sqlite3
import hashlib
import hmac
import math
import time
import urllib.parse
import os
import secrets
import uuid
import re

try:
    import psycopg
except ImportError:
    psycopg = None

DB_ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg is not None else ())

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_VERCEL = os.environ.get("VERCEL", "").strip().lower() in ("1", "true", "yes")
SEED_DEMO_DATA = os.environ.get(
    "SEED_DEMO_DATA", "false" if DATABASE_URL else "true"
).strip().lower() in ("1", "true", "yes")

DB_FILE = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "unifund.db"))
PORT = int(os.environ.get("PORT", 3001))
PAYMENTS_MODE = os.environ.get("PAYMENTS_MODE", "disabled" if IS_VERCEL else "sandbox").strip().lower()
STATIC_ROOT = os.path.realpath(os.path.dirname(__file__))
NOT_FOUND_FILE = os.path.join(STATIC_ROOT, "__not_found__")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


class HybridRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self.lastrowid = None

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def execute(self, sql, params=()):
        statement = sql.strip()
        statement = statement.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")
        statement = statement.replace("campaign_id INTEGER NOT NULL", "campaign_id BIGINT NOT NULL")
        is_campaign_insert = statement.upper().startswith("INSERT INTO CAMPAIGNS ")
        if is_campaign_insert and "RETURNING" not in statement.upper():
            statement += " RETURNING id"
        statement = statement.replace("?", "%s")
        if psycopg is None:
            self._cursor.execute(statement, params)
        else:
            try:
                self._cursor.execute(statement, params)
            except psycopg.errors.UniqueViolation as exc:
                raise sqlite3.IntegrityError(str(exc)) from exc
        if is_campaign_insert:
            row = self._cursor.fetchone()
            self.lastrowid = row["id"]
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        return HybridRow(row) if row is not None else None

    def fetchall(self):
        return [HybridRow(row) for row in self._cursor.fetchall()]


class PostgresConnection:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self):
        return PostgresCursor(self._connection.cursor())

    def execute(self, sql, params=()):
        cursor = self.cursor()
        cursor.execute(sql, params)
        return cursor

    def commit(self):
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()

    def close(self):
        self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is None:
            self.commit()
        else:
            self._connection.rollback()
        self.close()
        return False

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"

def verify_password(password, stored):
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, salt, expected = stored.split("$", 2)
            actual = password_hash(password, salt).rsplit("$", 1)[1]
            return hmac.compare_digest(actual, expected), False
        except ValueError:
            return False, False
    legacy = hashlib.sha256(password.encode()).hexdigest()
    return hmac.compare_digest(legacy, stored), True

def finite_number(value, default=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default

def positive_id(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None

def text_value(value):
    return value.strip() if isinstance(value, str) else ""

def bootstrap_admin_credentials():
    email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not email or not password:
        raise RuntimeError(
            "Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before initializing the database"
        )
    return email, password

def get_db():
    if DATABASE_URL:
        if psycopg is None:
            raise RuntimeError("Install psycopg to use the configured PostgreSQL database")
        try:
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("Install psycopg to use the configured PostgreSQL database") from exc
        connection = psycopg.connect(
            DATABASE_URL, row_factory=dict_row, connect_timeout=5
        )
        connection.execute("CREATE SCHEMA IF NOT EXISTS unifund")
        connection.execute("SET LOCAL search_path TO unifund, public")
        return PostgresConnection(connection)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    if DATABASE_URL:
        c.execute("SELECT pg_advisory_xact_lock(739201120)")
    
    # Users table (Roles: student_org, admin, donor)
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL, -- 'student_org', 'admin', 'donor'
        org_name TEXT,
        campus TEXT,
        matric_number TEXT,
        is_verified INTEGER DEFAULT 0,
        created_at INTEGER
    )
    """)

    # Campaigns table
    c.execute("""
    CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        org TEXT NOT NULL,
        campus TEXT NOT NULL,
        category TEXT NOT NULL,
        goal_usd REAL NOT NULL,
        goal_ngn REAL NOT NULL,
        raised_usd REAL DEFAULT 0,
        raised_ngn REAL DEFAULT 0,
        backers_count INTEGER DEFAULT 0,
        days INTEGER NOT NULL,
        about TEXT NOT NULL,
        budget_breakdown TEXT,
        wallet_address TEXT,
        status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        approval_notes TEXT,
        created_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """)

    # Ledger / Contributions table
    c.execute("""
    CREATE TABLE IF NOT EXISTS contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref TEXT UNIQUE NOT NULL,
        campaign_id INTEGER NOT NULL,
        donor_id TEXT,
        donor_name TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        amount_ngn REAL NOT NULL,
        currency TEXT NOT NULL, -- 'USD', 'NGN'
        channel TEXT NOT NULL, -- 'USDT_TRC20', 'NAIRA_TRANSFER', 'USSD_GATEWAY'
        status TEXT NOT NULL, -- 'sample' illustrative data or 'simulated' sandbox record
        tx_hash TEXT, -- Provider reference or sample hash; not proof in sandbox
        network TEXT, -- e.g. 'TRON', 'NIBSS'
        block_height INTEGER,
        receipt_hash TEXT NOT NULL, -- SHA-256 database audit reference
        prev_hash TEXT,
        created_at INTEGER,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    )
    """)

    # Spending / Withdrawal reports (Transparency)
    c.execute("""
    CREATE TABLE IF NOT EXISTS spending_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        vendor TEXT NOT NULL,
        receipt_url TEXT,
        date_spent TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    )
    """)

    # Sessions table
    c.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """)
    c.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS contributions_tx_hash_unique
    ON contributions (tx_hash) WHERE tx_hash IS NOT NULL
    """)

    # Demo accounts are local-only unless explicitly enabled for a remote database.
    c.execute("SELECT COUNT(*) FROM users")
    user_count = c.fetchone()[0]
    bootstrap_admin = None
    if DATABASE_URL and user_count == 0:
        try:
            bootstrap_admin = bootstrap_admin_credentials()
        except RuntimeError:
            conn.close()
            raise
    if bootstrap_admin and not SEED_DEMO_DATA:
        admin_email, admin_password = bootstrap_admin
        c.execute("""
        INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
        VALUES (?, ?, ?, ?, 'admin', 1, ?)
        """, (
            str(uuid.uuid4()),
            admin_email,
            password_hash(admin_password),
            "UniFund Administrator",
            int(time.time()),
        ))
    c.execute("SELECT COUNT(*) FROM campaigns")
    campaign_count = c.fetchone()[0]
    if SEED_DEMO_DATA and campaign_count == 0:
        if user_count == 0:
            admin_id = str(uuid.uuid4())
            admin_pwd = (
                password_hash(bootstrap_admin[1])
                if DATABASE_URL
                else hashlib.sha256("admin123".encode()).hexdigest()
            )
            admin_email = (
                bootstrap_admin[0]
                if DATABASE_URL
                else "admin@unifund.org"
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            """, (admin_id, admin_email, admin_pwd, "Association Dean / Audit Committee", "admin", int(time.time())))

            org1_id = str(uuid.uuid4())
            org1_pwd = (
                password_hash(secrets.token_urlsafe(32))
                if DATABASE_URL
                else hashlib.sha256("student123".encode()).hexdigest()
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, org_name, campus, matric_number, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (org1_id, "robotics@uniuyo.edu.ng", org1_pwd, "Aniekeme Bassey", "student_org", "UNIUYO Robotics & AI Lab", "UNIUYO", "ENG/20/0819", int(time.time())))

            donor_id = str(uuid.uuid4())
            donor_pwd = (
                password_hash(secrets.token_urlsafe(32))
                if DATABASE_URL
                else hashlib.sha256("donor123".encode()).hexdigest()
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            """, (donor_id, "donor@alumni.org", donor_pwd, "Dr. O. Adebayo (UK)", "donor", int(time.time())))
        else:
            c.execute("SELECT id FROM users WHERE role = 'student_org' ORDER BY created_at LIMIT 1")
            org_row = c.fetchone()
            if org_row:
                org1_id = org_row[0]
            else:
                c.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")
                owner_row = c.fetchone()
                if not owner_row:
                    c.execute("SELECT id FROM users ORDER BY created_at LIMIT 1")
                    owner_row = c.fetchone()
                if not owner_row:
                    conn.close()
                    raise RuntimeError("Cannot seed campaigns without an existing user")
                org1_id = owner_row[0]

            c.execute("SELECT id FROM users WHERE role = 'donor' ORDER BY created_at LIMIT 1")
            donor_row = c.fetchone()
            donor_id = donor_row[0] if donor_row else None

        # Seed sample campaigns
        now = int(time.time())
        campaigns_seed = [
            (org1_id, "Autonomous Solar Crop Monitoring Drone", "UNIUYO Robotics & AI Lab", "UNIUYO", "tech", 
             4200, 6300000, 3650, 5475000, 112, 6, 
             "Building a solar-assisted NDVI multispectral imaging drone for precision palm oil and cassava crop health monitoring across Akwa Ibom farmlands.",
             "Solar Cell Modules & ESCs: $1,200\nCarbon Fiber Airframe: $800\nMultispectral Sensing Rig: $1,400\nLiFePO4 Power Station: $800",
             "TExDemo77UNIUYORoboticsTether991TRC", "approved", "Faculty of Engineering Dean Verified"),

            (org1_id, "Open Diagnostic Prototyping Laboratory", "Biomedical Engineering Society", "UNILAG", "labs",
             3800, 5700000, 2600, 3900000, 71, 16,
             "Digital oscilloscopes, measurement units, and biosensors for undergraduate biomedical capstone projects.",
             "4x Digital Oscilloscopes: $1,800\nComponent Assortment & PCBs: $800\nProtective Enclosures: $400\nSoldering Workstations: $800",
             "TExDemo22UNILAGBioMedWallet553TRC", "approved", "Faculty Adviser Signed Off"),

            (org1_id, "All-African Collegiate Parliamentary Championship", "Parliamentary Debate Union", "UI", "competitions",
             2900, 4350000, 2450, 3675000, 82, 5,
             "Travel accreditation and logistics for the university team representing at the continental championship.",
             "Continental Flight & Visa: $1,600\nTournament Registration & Accommodation: $1,100\nTraining Materials: $200",
             "TExDemo77UIDebateWallet331TRC", "approved", "Student Affairs Approved"),

            (org1_id, "Campus Electric Shuttle Battery Retrofit", "Clean Energy & Mobility Initiative", "OAU", "energy",
             5200, 7800000, 1850, 2775000, 58, 22,
             "Retrofitting departmental shuttles with LiFePO4 cells and regenerative charging for intra-campus mobility.",
             "LiFePO4 48V 100Ah Battery Bank: $3,200\nMotor Inverter: $1,200\nRegen Controller & Cabling: $800",
             "TExDemo11OAUShuttleWallet440TRC", "approved", "HOD Mechanical Engineering Approved"),

            (org1_id, "Smart Campus Water Filtration & Sensor Grid", "Civil & Environmental Engineering Guild", "UNN", "labs",
             3500, 5250000, 2100, 3150000, 63, 14,
             "Deploying automated ceramic filtration stations and real-time turbidity IoT sensors for clean student drinking water.",
             "Ceramic Filter Units: $1,500\nIoT Sensor Nodes & Solar: $1,200\nPiping & Installation: $800",
             "TExDemo55UNNWaterWallet772TRC", "approved", "Dean of Environmental Studies Verified"),

            (org1_id, "Formula Student Electric Racecar Chassis", "Society of Automotive Engineers", "ABU", "tech",
             6000, 9000000, 4200, 6300000, 110, 19,
             "Fabricating lightweight tubular spaceframe and telemetry unit for collegiate engineering competition.",
             "Chromo-Moly Steel Tubing: $2,500\nTIG Welding Gas & Consumables: $1,100\nTelemetry & Harness: $2,400",
             "TExDemo88ABURacecarWallet114TRC", "approved", "HOD Mechanical Engineering Signed Off")
        ]

        for camp in campaigns_seed:
            c.execute("""
            INSERT INTO campaigns (user_id, title, org, campus, category, goal_usd, goal_ngn, raised_usd, raised_ngn, backers_count, days, about, budget_breakdown, wallet_address, status, approval_notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, camp + (now,))

        # Seed Contributions with cryptographic hashes
        prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
        seed_ledger = [
            ("UF-9B38D1", 1, donor_id, "Example backer", 150, 225000, "USD", "USDT_TRC20", "sample", None, "Example data only", None),
            ("UF-81CA4E", 2, None, "Example backer", 50, 75000, "NGN", "NAIRA_TRANSFER", "sample", None, "Example data only", None),
            ("UF-77D92A", 3, donor_id, "Example backer", 200, 300000, "USD", "USDT_TRC20", "sample", None, "Example data only", None),
            ("UF-43A88C", 4, None, "Example backer", 75, 112500, "USD", "USDT_TRC20", "sample", None, "Example data only", None)
        ]

        for item in seed_ledger:
            data_to_seal = f"{item[0]}:{item[1]}:{item[4]}:{item[5]}:{item[7]}:{item[9]}:{prev_hash}"
            cur_hash = hashlib.sha256(data_to_seal.encode()).hexdigest()
            c.execute("""
            INSERT INTO contributions (ref, campaign_id, donor_id, donor_name, amount_usd, amount_ngn, currency, channel, status, tx_hash, network, block_height, receipt_hash, prev_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, item + (cur_hash, prev_hash, now))
            prev_hash = cur_hash

    c.execute("""
    UPDATE contributions
    SET status = 'sample', donor_name = 'Example backer', tx_hash = NULL,
        network = 'Example data only', block_height = NULL
    WHERE ref IN ('UF-9B38D1', 'UF-81CA4E', 'UF-77D92A', 'UF-43A88C')
    """)
    c.execute("""
    UPDATE campaigns SET title = CASE title
        WHEN 'Autonomous Solar Crop Monitoring Drone' THEN 'Solar farm drone'
        WHEN 'Open Diagnostic Prototyping Laboratory' THEN 'Student engineering lab'
        WHEN 'All-African Collegiate Parliamentary Championship' THEN 'African debate championship'
        WHEN 'Campus Electric Shuttle Battery Retrofit' THEN 'Electric campus shuttle'
        WHEN 'Smart Campus Water Filtration & Sensor Grid' THEN 'Clean water on campus'
        WHEN 'Formula Student Electric Racecar Chassis' THEN 'Student electric race car'
        ELSE title
    END
    WHERE title IN (
        'Autonomous Solar Crop Monitoring Drone',
        'Open Diagnostic Prototyping Laboratory',
        'All-African Collegiate Parliamentary Championship',
        'Campus Electric Shuttle Battery Retrofit',
        'Smart Campus Water Filtration & Sensor Grid',
        'Formula Student Electric Racecar Chassis'
    )
    """)

    conn.commit()
    conn.close()

# Fixed sample exchange rate for prototype displays and sandbox math.
CURRENT_EXCHANGE_RATE = {
    "rate": 1540.50,
    "source": "Fixed prototype sample rate (not a live quote)",
    "last_updated": int(time.time())
}

def get_current_rate():
    return CURRENT_EXCHANGE_RATE["rate"]

class UniFundAPIHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urllib.parse.urlsplit(path).path
        parts = [part for part in urllib.parse.unquote(path).split("/") if part not in ("", ".", "..")]
        if not parts:
            return os.path.join(STATIC_ROOT, "index.html")
        if parts[0] != "index.html" and parts[0] not in {"css", "fonts", "js"}:
            return NOT_FOUND_FILE if any("." in part for part in parts) else os.path.join(STATIC_ROOT, "index.html")
        candidate = os.path.realpath(os.path.join(STATIC_ROOT, *parts))
        try:
            if os.path.commonpath((STATIC_ROOT, candidate)) != STATIC_ROOT or not os.path.isfile(candidate):
                return NOT_FOUND_FILE
        except ValueError:
            return NOT_FOUND_FILE
        return candidate

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def get_auth_user(self):
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return None
        token = auth[7:].strip()
        conn = get_db()
        c = conn.cursor()
        c.execute("""
        SELECT u.* FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
        """, (token, int(time.time())))
        row = c.fetchone()
        conn.close()
        if row:
            return dict(row)
        return None

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API: Exchange Rate
        if path == "/api/health":
            try:
                with get_db() as conn:
                    conn.execute("SELECT 1").fetchone()
            except DB_ERRORS:
                return self.send_json(503, {"status": "unavailable", "database": "unavailable"})
            return self.send_json(200, {
                "status": "ok",
                "database": "connected",
                "payments": "sandbox" if PAYMENTS_MODE == "sandbox" and not IS_VERCEL else "disabled",
                "demo_accounts_allowed": not bool(DATABASE_URL),
            })

        # 1. API: Fixed sample exchange rate
        elif path == "/api/exchange-rate":
            return self.send_json(200, {
                "rate": CURRENT_EXCHANGE_RATE["rate"],
                "source": CURRENT_EXCHANGE_RATE["source"],
                "last_updated": CURRENT_EXCHANGE_RATE["last_updated"],
                "status": "active"
            })

        # 2. API: Current Auth Session
        elif path == "/api/auth/me":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Not authenticated"})
            user.pop("password_hash", None)
            return self.send_json(200, {"user": user})

        # 3. API: List Campaigns
        elif path == "/api/campaigns":
            status_filter = query.get("status", ["approved"])[0]
            user = self.get_auth_user()
            
            conn = get_db()
            c = conn.cursor()
            public_listing = True
            
            # If user is admin, allow viewing 'pending', 'all'
            if status_filter == "all" and user and user["role"] == "admin":
                public_listing = False
                c.execute("SELECT * FROM campaigns ORDER BY id DESC")
            elif status_filter == "pending" and user and user["role"] == "admin":
                public_listing = False
                c.execute("SELECT * FROM campaigns WHERE status = 'pending' ORDER BY id DESC")
            elif status_filter == "mine" and user:
                public_listing = False
                c.execute("SELECT * FROM campaigns WHERE user_id = ? ORDER BY id DESC", (user["id"],))
            else:
                c.execute("SELECT * FROM campaigns WHERE status = 'approved' ORDER BY id DESC")
                
            rows = [dict(r) for r in c.fetchall()]
            conn.close()
            if public_listing:
                for row in rows:
                    row.pop("user_id", None)
                    row.pop("wallet_address", None)
                    row.pop("approval_notes", None)
            return self.send_json(200, {"campaigns": rows})

        # 4. API: Campaign Detail
        elif path.startswith("/api/campaigns/"):
            camp_id = positive_id(path.split("/")[-1])
            if not camp_id:
                return self.send_json(404, {"error": "Campaign not found"})
            user = self.get_auth_user()
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM campaigns WHERE id = ?", (camp_id,))
            row = c.fetchone()
            if not row:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})

            camp_data = dict(row)
            is_owner = user and (user["id"] == camp_data["user_id"] or user["role"] == "admin")
            if camp_data["status"] != "approved" and not is_owner:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})
            
            c.execute("""
            SELECT id, ref, campaign_id, donor_name, amount_usd, amount_ngn, currency,
                   channel, status, created_at
            FROM contributions
            WHERE campaign_id = ? AND status IN ('verified', 'sample', 'simulated')
            ORDER BY id DESC LIMIT 10
            """, (camp_id,))
            conts = [dict(r) for r in c.fetchall()]

            # Fetch spending transparency reports
            c.execute("SELECT * FROM spending_reports WHERE campaign_id = ? ORDER BY id DESC", (camp_id,))
            spendings = [dict(r) for r in c.fetchall()]

            conn.close()
            camp_data.pop("user_id", None)
            camp_data.pop("wallet_address", None)
            camp_data["is_owner"] = bool(is_owner)
            camp_data["contributions"] = conts
            camp_data["spending_reports"] = spendings
            return self.send_json(200, {"campaign": camp_data})

        # 5. API: Public Immutable Ledger
        elif path == "/api/ledger":
            conn = get_db()
            c = conn.cursor()
            c.execute("""
            SELECT l.id, l.ref, l.campaign_id, l.donor_name, l.amount_usd, l.amount_ngn,
                   l.currency, l.channel, l.status, l.receipt_hash, l.created_at,
                   c.title as campaign_title, c.org as campaign_org, c.campus as campus
            FROM contributions l
            JOIN campaigns c ON l.campaign_id = c.id
            WHERE l.status IN ('verified', 'sample', 'simulated')
            ORDER BY l.id DESC
            """)
            ledger_rows = [dict(r) for r in c.fetchall()]
            conn.close()
            return self.send_json(200, {"ledger": ledger_rows})

        # 6. API: Donor History
        elif path == "/api/donor/history":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Authentication required"})
            conn = get_db()
            c = conn.cursor()
            c.execute("""
            SELECT l.*, c.title as campaign_title, c.org as campaign_org
            FROM contributions l
            JOIN campaigns c ON l.campaign_id = c.id
            WHERE l.donor_id = ?
            ORDER BY l.id DESC
            """, (user["id"],))
            items = [dict(r) for r in c.fetchall()]
            conn.close()
            return self.send_json(200, {"donations": items})

        # Static files fallback
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "API endpoint not found"})
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            content_len = int(self.headers.get('Content-Length', 0))
        except ValueError:
            return self.send_json(400, {"error": "Invalid Content-Length"})
        if content_len < 0 or content_len > 65536:
            return self.send_json(413, {"error": "Request body is too large"})
        post_body = self.rfile.read(content_len) if content_len > 0 else b'{}'
        try:
            data = json.loads(post_body.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self.send_json(400, {"error": "Request body must be valid JSON"})
        if not isinstance(data, dict):
            return self.send_json(400, {"error": "Request body must be a JSON object"})

        # 1. API: Auth Register
        if path == "/api/auth/register":
            email = text_value(data.get("email")).lower()
            raw_password = data.get("password")
            password = raw_password if isinstance(raw_password, str) else ""
            name = text_value(data.get("name"))
            role = data.get("role", "student_org")
            org_name = text_value(data.get("org_name"))
            campus = text_value(data.get("campus")).upper()
            matric_number = text_value(data.get("matric_number"))

            if not email or not password or not name:
                return self.send_json(400, {"error": "Email, password, and name are required"})

            if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
                return self.send_json(400, {"error": "Enter a valid email address"})
            if len(name) > 80:
                return self.send_json(400, {"error": "Name must be 80 characters or fewer"})
            if len(password) < 8 or len(password) > 128:
                return self.send_json(400, {"error": "Password must be between 8 and 128 characters"})

            if role not in ("student_org", "donor"):
                return self.send_json(400, {"error": "Choose a valid account type"})

            if role == "student_org" and (not org_name or not campus or not matric_number):
                return self.send_json(400, {"error": "Student organizations must provide group name, campus code, and matric/student ID"})
            if role == "student_org" and (len(org_name) > 80 or len(campus) > 12 or len(matric_number) > 30):
                return self.send_json(400, {"error": "Organization name, campus code, or student ID is too long"})

            user_id = str(uuid.uuid4())
            pwd_hash = password_hash(password)
            # Student orgs require association audit verification
            is_verified = 1 if role == "donor" else 0

            conn = get_db()
            c = conn.cursor()
            try:
                c.execute("""
                INSERT INTO users (id, email, password_hash, name, role, org_name, campus, matric_number, is_verified, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, email, pwd_hash, name, role, org_name, campus, matric_number, is_verified, int(time.time())))
                
                token = secrets.token_urlsafe(32)
                expires = int(time.time()) + (86400 * 7) # 7 days
                c.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", (token, user_id, expires))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                return self.send_json(400, {"error": "Email is already registered"})
            
            conn.close()
            return self.send_json(201, {
                "token": token,
                "user": {
                    "id": user_id,
                    "email": email,
                    "name": name,
                    "role": role,
                    "org_name": org_name,
                    "campus": campus,
                    "is_verified": is_verified
                }
            })

        # 2. API: Auth Login
        elif path == "/api/auth/login":
            email = text_value(data.get("email")).lower()
            raw_password = data.get("password")
            password = raw_password if isinstance(raw_password, str) else ""
            if not email or len(email) > 254 or not password or len(password) > 128:
                return self.send_json(401, {"error": "Invalid email or credentials"})
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM users WHERE email = ?", (email,))
            user = c.fetchone()
            if not user or not verify_password(password, user["password_hash"])[0]:
                conn.close()
                return self.send_json(401, {"error": "Invalid email or credentials"})

            user_data = dict(user)
            _, is_legacy = verify_password(password, user_data["password_hash"])
            if is_legacy:
                c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash(password), user_data["id"]))
            token = secrets.token_urlsafe(32)
            expires = int(time.time()) + (86400 * 7)
            c.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", (token, user_data["id"], expires))
            conn.commit()
            conn.close()

            user_data.pop("password_hash", None)
            return self.send_json(200, {"token": token, "user": user_data})

        # 3. API: Auth Logout
        elif path == "/api/auth/logout":
            auth = self.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                token = auth[7:].strip()
                conn = get_db()
                c = conn.cursor()
                c.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                conn.close()
            return self.send_json(200, {"message": "Logged out successfully"})

        elif path == "/api/account/delete":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Sign in again before deleting your account"})
            if user["role"] == "admin":
                return self.send_json(403, {"error": "Audit administrator accounts must be removed by the project operator"})

            raw_password = data.get("password")
            password = raw_password if isinstance(raw_password, str) else ""
            if not password or len(password) > 128 or not verify_password(password, user["password_hash"])[0]:
                return self.send_json(403, {"error": "Password did not match. Your account was not deleted."})

            conn = get_db()
            try:
                c = conn.cursor()
                c.execute(
                "DELETE FROM contributions WHERE donor_id = ? OR campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)",
                (user["id"], user["id"]),
                )
                c.execute(
                "DELETE FROM spending_reports WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)",
                (user["id"],),
                )
                c.execute("DELETE FROM campaigns WHERE user_id = ?", (user["id"],))
                c.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
                c.execute("DELETE FROM users WHERE id = ?", (user["id"],))
                conn.commit()
            except DB_ERRORS:
                conn.rollback()
                raise
            finally:
                conn.close()

            return self.send_json(200, {
                "message": "Your account and its campaigns, spending reports, and simulated contribution records were deleted."
            })

        # 4. API: Create Campaign (Strict Validation & Approval Enforcement)
        elif path == "/api/campaigns":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Authentication required. Please login with your student organization credentials."})
            
            if user["role"] not in ["student_org", "admin"]:
                return self.send_json(403, {"error": "Only student organization accounts and audit administrators can submit campaigns."})

            title = text_value(data.get("title"))
            category = data.get("category", "tech")
            goal_usd = finite_number(data.get("goal_usd"))
            try:
                days = int(data.get("days", 30))
            except (TypeError, ValueError):
                days = 0
            about = text_value(data.get("about"))
            budget = text_value(data.get("budget_breakdown"))
            wallet = text_value(data.get("wallet_address")) or f"TEx{uuid.uuid4().hex[:16].upper()}TRC20"

            # Strict validations as demanded
            if not title or len(title) < 5 or len(title) > 90:
                return self.send_json(400, {"error": "Title must be between 5 and 90 characters"})

            if goal_usd is None or goal_usd < 50:
                return self.send_json(400, {"error": "Minimum funding goal is $50 USD (or equivalent ₦77,000)"})

            if days < 1 or days > 90:
                return self.send_json(400, {"error": "Campaign duration must be between 1 and 90 days"})

            if not about or len(about) < 20:
                return self.send_json(400, {"error": "Please describe the purpose of the initiative (minimum 20 characters)"})
            if category not in ("tech", "labs", "competitions", "energy", "education", "health", "community", "arts", "business"):
                return self.send_json(400, {"error": "Choose a valid campaign category"})

            rate = get_current_rate()
            goal_ngn_unrounded = goal_usd * rate
            if not math.isfinite(goal_ngn_unrounded):
                return self.send_json(400, {"error": "Funding goal is too large"})
            goal_ngn = round(goal_ngn_unrounded, 2)
            now = int(time.time())

            # Student org must be approved by audit admin
            initial_status = "approved" if user["role"] == "admin" else "pending"

            conn = get_db()
            c = conn.cursor()
            c.execute("""
            INSERT INTO campaigns (user_id, title, org, campus, category, goal_usd, goal_ngn, days, about, budget_breakdown, wallet_address, status, approval_notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user["id"], title, user.get("org_name") or user["name"], user.get("campus") or "NATIONAL", category, goal_usd, goal_ngn, days, about, budget, wallet, initial_status, "Under review by Association Audit Committee" if initial_status == "pending" else "Pre-approved", now))
            
            new_id = c.lastrowid
            conn.commit()
            conn.close()

            return self.send_json(201, {
                "id": new_id,
                "status": initial_status,
                "message": "Initiative submitted. Awaiting Association Admin verification." if initial_status == "pending" else "Campaign live."
            })

        # 5. API: Admin Approve/Reject Campaign
        elif path.startswith("/api/admin/campaigns/") and path.endswith("/review"):
            user = self.get_auth_user()
            if not user or user["role"] != "admin":
                return self.send_json(403, {"error": "Administrator privilege required."})

            camp_id = positive_id(path.split("/")[-2])
            if not camp_id:
                return self.send_json(404, {"error": "Campaign not found"})
            action = data.get("action") # 'approve' or 'reject'
            if action not in ("approve", "reject"):
                return self.send_json(400, {"error": "Action must be approve or reject"})
            notes = text_value(data.get("notes")) or ("Approved in demo workflow" if action == "approve" else "Declined")

            new_status = "approved" if action == "approve" else "rejected"

            conn = get_db()
            c = conn.cursor()
            c.execute("UPDATE campaigns SET status = ?, approval_notes = ? WHERE id = ?", (new_status, notes, camp_id))
            if c.rowcount == 0:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})
            conn.commit()
            conn.close()

            return self.send_json(200, {"message": f"Campaign {new_status} successfully."})

        # 6. API: USDT sandbox record (live chain verification is not configured)
        elif path == "/api/payments/verify-usdt":
            camp_id = positive_id(data.get("campaign_id"))
            donor_name = text_value(data.get("donor_name")) or "Anonymous Backer"
            expected_amount = finite_number(data.get("amount_usd"), 0)

            if PAYMENTS_MODE != "sandbox" or IS_VERCEL:
                return self.send_json(503, {"error": "USDT payment verification is not configured. No contribution was recorded."})
            if not camp_id or expected_amount <= 0:
                return self.send_json(400, {"error": "Campaign ID and a valid amount are required"})
            if len(donor_name) > 60:
                return self.send_json(400, {"error": "Display name must be 60 characters or fewer"})
            rate = get_current_rate()
            amount_ngn_unrounded = expected_amount * rate
            if not math.isfinite(amount_ngn_unrounded):
                return self.send_json(400, {"error": "Contribution amount is too large"})

            conn = get_db()
            c = conn.cursor()

            c.execute("SELECT * FROM campaigns WHERE id = ? AND status = 'approved'", (camp_id,))
            camp = c.fetchone()
            if not camp:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})

            amount_ngn = round(amount_ngn_unrounded, 2)
            now = int(time.time())
            ref_code = f"UF-{uuid.uuid4().hex[:12].upper()}"

            # Chain this database audit reference to the previous record.
            c.execute("SELECT receipt_hash FROM contributions ORDER BY id DESC LIMIT 1")
            prev_row = c.fetchone()
            prev_hash = prev_row[0] if prev_row else "0000000000000000000000000000000000000000000000000000000000000000"

            seal_data = f"{ref_code}:{camp_id}:{expected_amount}:{amount_ngn}:USDT_TRC20:SIMULATED:{prev_hash}"
            receipt_hash = hashlib.sha256(seal_data.encode()).hexdigest()

            # Identify if donor logged in
            auth_user = self.get_auth_user()
            donor_id = auth_user["id"] if auth_user else None

            c.execute("""
            INSERT INTO contributions (ref, campaign_id, donor_id, donor_name, amount_usd, amount_ngn, currency, channel, status, network, receipt_hash, prev_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'USD', 'USDT_TRC20', 'simulated', 'TRON test flow (simulated)', ?, ?, ?)
            """, (ref_code, camp_id, donor_id, donor_name, expected_amount, amount_ngn, receipt_hash, prev_hash, now))

            conn.commit()
            conn.close()

            return self.send_json(200, {
                "status": "simulated",
                "reference": ref_code,
                "amount_usd": expected_amount,
                "amount_ngn": amount_ngn,
                "receipt_hash": receipt_hash,
                "message": "Demo only: no blockchain transaction was verified and no funds moved."
            })

        # 7. API: Naira transfer sandbox record (Cleva integration is not configured)
        elif path == "/api/payments/verify-naira":
            camp_id = positive_id(data.get("campaign_id"))
            donor_name = text_value(data.get("donor_name")) or "Anonymous Backer"
            amount_ngn = finite_number(data.get("amount_ngn"), 0)

            if PAYMENTS_MODE != "sandbox" or IS_VERCEL:
                return self.send_json(503, {"error": "Cleva payment verification is not configured. No contribution was recorded."})
            if not camp_id or amount_ngn <= 0:
                return self.send_json(400, {"error": "Campaign ID and a valid amount are required"})
            if len(donor_name) > 60:
                return self.send_json(400, {"error": "Display name must be 60 characters or fewer"})

            conn = get_db()
            c = conn.cursor()

            c.execute("SELECT * FROM campaigns WHERE id = ? AND status = 'approved'", (camp_id,))
            camp = c.fetchone()
            if not camp:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})

            rate = get_current_rate()
            amount_usd = round(amount_ngn / rate, 2)
            now = int(time.time())
            ref_code = f"UF-{uuid.uuid4().hex[:12].upper()}"

            c.execute("SELECT receipt_hash FROM contributions ORDER BY id DESC LIMIT 1")
            prev_row = c.fetchone()
            prev_hash = prev_row[0] if prev_row else "0000000000000000000000000000000000000000000000000000000000000000"

            seal_data = f"{ref_code}:{camp_id}:{amount_usd}:{amount_ngn}:NAIRA_TRANSFER:SIMULATED:{prev_hash}"
            receipt_hash = hashlib.sha256(seal_data.encode()).hexdigest()

            auth_user = self.get_auth_user()
            donor_id = auth_user["id"] if auth_user else None

            c.execute("""
            INSERT INTO contributions (ref, campaign_id, donor_id, donor_name, amount_usd, amount_ngn, currency, channel, status, network, receipt_hash, prev_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'NGN', 'NAIRA_TRANSFER', 'simulated', 'Cleva test flow (simulated)', ?, ?, ?)
            """, (ref_code, camp_id, donor_id, donor_name, amount_usd, amount_ngn, receipt_hash, prev_hash, now))

            conn.commit()
            conn.close()

            return self.send_json(200, {
                "status": "simulated",
                "reference": ref_code,
                "amount_ngn": amount_ngn,
                "amount_usd": amount_usd,
                "receipt_hash": receipt_hash,
                "message": "Demo only: Cleva did not verify this reference and no funds moved."
            })

        # 8. API: USSD dial-code preview (not a live bank integration)
        elif path == "/api/payments/ussd-initiate":
            camp_id = positive_id(data.get("campaign_id"))
            bank_code = text_value(data.get("bank_code", "737"))
            amount_ngn = finite_number(data.get("amount_ngn"), 0)
            valid_bank_codes = {"737", "966", "919", "894", "901", "7799"}

            if not camp_id or amount_ngn < 500 or bank_code not in valid_bank_codes:
                return self.send_json(400, {"error": "Minimum USSD contribution is ₦500."})

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT id, title, org FROM campaigns WHERE id = ? AND status = 'approved'", (camp_id,))
            camp = c.fetchone()
            conn.close()

            if not camp:
                return self.send_json(404, {"error": "Campaign not found"})

            # Generate real provider dial string
            account_num = f"90{camp['id']}044172"
            dial_string = f"*{bank_code}*000*{account_num}*{int(amount_ngn)}#"
            session_ref = f"USSD-{uuid.uuid4().hex[:8].upper()}"

            return self.send_json(200, {
                "dial_string": dial_string,
                "status": "simulated",
                "session_ref": session_ref,
                "amount_ngn": amount_ngn,
                "account_number": account_num,
                "security_notice": "Sandbox preview only. This is not a valid bank payment code; do not dial it.",
                "instructions": "No payment was initiated and no funds moved."
            })

        # 9. API: Post Spending / Withdrawal Transparency Report
        elif path == "/api/campaigns/spending":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Authentication required."})

            camp_id = positive_id(data.get("campaign_id"))
            title = text_value(data.get("title"))
            amount = finite_number(data.get("amount"), 0)
            currency = data.get("currency", "USD")
            vendor = text_value(data.get("vendor"))
            date_spent = text_value(data.get("date_spent")) or time.strftime("%Y-%m-%d")
            notes = text_value(data.get("notes"))

            if not camp_id or not title or amount <= 0 or not vendor or currency not in ("USD", "NGN"):
                return self.send_json(400, {"error": "Campaign, spending purpose, amount, and vendor are required"})

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM campaigns WHERE id = ? AND (user_id = ? OR ? = 'admin')", (camp_id, user["id"], user["role"]))
            if not c.fetchone():
                conn.close()
                return self.send_json(403, {"error": "Unauthorized to publish spending reports for this campaign."})

            c.execute("""
            INSERT INTO spending_reports (campaign_id, title, amount, currency, vendor, date_spent, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (camp_id, title, amount, currency, vendor, date_spent, notes, int(time.time())))
            conn.commit()
            conn.close()

            return self.send_json(201, {"message": "Spending transparency record posted successfully."})

        return self.send_json(404, {"error": "API endpoint not found"})

def run_server():
    init_db()
    server_address = ('', PORT)
    httpd = socketserver.TCPServer(server_address, UniFundAPIHandler)
    print(f"UniFund Backend Engine running on port {PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
