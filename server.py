"""SQLite/PostgreSQL-backed hackathon prototype API with optional Nile testnet verification."""

import http.server
import socketserver
import json
import sqlite3
import hashlib
import hmac
import math
import time
import decimal
import urllib.parse
import urllib.error
import urllib.request
import os
import secrets
import uuid
import re

# Load .env variables if present and not already set
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.isfile(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as env_f:
            for line in env_f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    # Also map commonly named TRON keys to TRON_TESTNET_*
                    os.environ[k] = v
    except Exception:
        pass

# Aliasing TRON .env keys if specified under TRON_* instead of TRON_TESTNET_*
if "TRON_RECEIVER_ADDRESS" in os.environ and "TRON_TESTNET_RECEIVER_ADDRESS" not in os.environ:
    os.environ["TRON_TESTNET_RECEIVER_ADDRESS"] = os.environ["TRON_RECEIVER_ADDRESS"]
if "TRON_USDT_CONTRACT" in os.environ and "TRON_TESTNET_TOKEN_CONTRACT" not in os.environ:
    os.environ["TRON_TESTNET_TOKEN_CONTRACT"] = os.environ["TRON_USDT_CONTRACT"]
if "TRON_RPC_URL" in os.environ and "TRON_TESTNET_RPC_URL" not in os.environ:
    os.environ["TRON_TESTNET_RPC_URL"] = os.environ["TRON_RPC_URL"]

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
HOST = os.environ.get("HOST", "127.0.0.1").strip() or "127.0.0.1"
PORT = int(os.environ.get("PORT", 3001))
PAYMENTS_MODE = os.environ.get("PAYMENTS_MODE", "disabled" if IS_VERCEL else "sandbox").strip().lower()
TRON_TESTNET_NETWORK = os.environ.get("TRON_TESTNET_NETWORK", "nile").strip().lower()
TRON_TESTNET_RPC_URL = os.environ.get("TRON_TESTNET_RPC_URL", "https://nile.trongrid.io").strip().rstrip("/")
TRON_TESTNET_TOKEN_CONTRACT = os.environ.get("TRON_TESTNET_TOKEN_CONTRACT", "").strip()
TRON_TESTNET_RECEIVER_ADDRESS = os.environ.get("TRON_TESTNET_RECEIVER_ADDRESS", "").strip()
TRON_TESTNET_TOKEN_DECIMALS = 6
TRON_NILE_USDT_CONTRACT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"
STATIC_ROOT = os.path.realpath(os.path.dirname(__file__))
NOT_FOUND_FILE = os.path.join(STATIC_ROOT, "__not_found__")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
TRON_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRON_TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


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

def strip_hex_prefix(value):
    return value[2:] if value.startswith("0x") else value

def token_units_from_number(amount, decimals=6):
    d = decimal.Decimal(str(amount))
    return int(d * (10 ** decimals))

class TronRPCError(Exception):
    pass

def decode_tron_address(address):
    if not isinstance(address, str) or not address:
        raise ValueError("A valid TRON address is required")
    value = 0
    try:
        for character in address:
            value = value * 58 + TRON_BASE58_ALPHABET.index(character)
    except ValueError as exc:
        raise ValueError("A valid TRON address is required") from exc

    decoded = value.to_bytes((value.bit_length() + 7) // 8, "big") if value else b""
    decoded = b"\x00" * (len(address) - len(address.lstrip("1"))) + decoded
    if len(decoded) != 25:
        raise ValueError("A valid TRON address is required")
    payload, checksum = decoded[:-4], decoded[-4:]
    expected = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if payload[0] != 0x41 or not hmac.compare_digest(checksum, expected):
        raise ValueError("A valid TRON address is required")
    return payload

def tron_testnet_configuration():
    if TRON_TESTNET_NETWORK != "nile":
        raise ValueError("Only the TRON Nile testnet is supported")
    rpc = urllib.parse.urlsplit(TRON_TESTNET_RPC_URL)
    if (
        rpc.scheme != "https"
        or rpc.hostname != "nile.trongrid.io"
        or rpc.username
        or rpc.password
        or rpc.port
        or rpc.path
        or rpc.query
        or rpc.fragment
    ):
        raise ValueError("TRON testnet must use the official Nile RPC base URL")
    if not TRON_TESTNET_TOKEN_CONTRACT or not TRON_TESTNET_RECEIVER_ADDRESS:
        raise ValueError(
            "Set TRON_TESTNET_TOKEN_CONTRACT and TRON_TESTNET_RECEIVER_ADDRESS to enable Nile payments"
        )
    if TRON_TESTNET_TOKEN_CONTRACT != TRON_NILE_USDT_CONTRACT:
        raise ValueError("Only the approved Nile test USDT contract is supported")
    contract_bytes = decode_tron_address(TRON_TESTNET_TOKEN_CONTRACT)
    receiver_bytes = decode_tron_address(TRON_TESTNET_RECEIVER_ADDRESS)
    return {
        "network": "nile",
        "rpc_url": TRON_TESTNET_RPC_URL,
        "token_contract": TRON_TESTNET_TOKEN_CONTRACT,
        "token_bytes": contract_bytes,
        "receiver_address": TRON_TESTNET_RECEIVER_ADDRESS,
        "receiver_bytes": receiver_bytes,
        "decimals": TRON_TESTNET_TOKEN_DECIMALS,
    }

def get_tron_solidified_receipt(tx_id, config):
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("TRONGRID_API_KEY", "").strip()
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key
    request = urllib.request.Request(
        config["rpc_url"] + "/walletsolidity/gettransactioninfobyid",
        data=json.dumps({"value": tx_id}).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise TronRPCError(f"TRON Nile RPC returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TronRPCError("TRON Nile RPC could not verify the transaction") from exc
    if not isinstance(body, dict):
        raise TronRPCError("TRON Nile RPC returned an invalid receipt")
    return body

def has_matching_tron_transfer(receipt, config, sender_bytes, expected_units):
    expected_contract = config["token_bytes"][1:].hex()
    expected_sender = sender_bytes[1:].hex().rjust(64, "0")
    expected_receiver = config["receiver_bytes"][1:].hex().rjust(64, "0")
    matches = 0
    for event in receipt.get("log", []):
        if not isinstance(event, dict):
            continue
        contract = text_value(event.get("address")).lower()
        if contract.startswith("0x"):
            contract = contract[2:]
        topics = event.get("topics")
        if (
            contract != expected_contract
            or not isinstance(topics, list)
            or len(topics) < 3
            or strip_hex_prefix(text_value(topics[0]).lower()) != TRON_TRANSFER_TOPIC
            or strip_hex_prefix(text_value(topics[1]).lower()) != expected_sender
            or strip_hex_prefix(text_value(topics[2]).lower()) != expected_receiver
        ):
            continue
        try:
            units = int(strip_hex_prefix(text_value(event.get("data"))), 16)
        except ValueError:
            continue
        if units == expected_units:
            matches += 1
    return matches == 1

def has_matching_tron_transfer_between(receipt, config, sender_address, receiver_address, expected_units):
    sender_bytes = decode_tron_address(sender_address)
    receiver_bytes = decode_tron_address(receiver_address)
    expected_contract = config["token_bytes"][1:].hex()
    expected_sender = sender_bytes[1:].hex().rjust(64, "0")
    expected_receiver = receiver_bytes[1:].hex().rjust(64, "0")
    matches = 0
    for event in receipt.get("log", []):
        if not isinstance(event, dict):
            continue
        contract = text_value(event.get("address")).lower().removeprefix("0x")
        topics = event.get("topics")
        if (
            contract != expected_contract
            or not isinstance(topics, list)
            or len(topics) < 3
            or strip_hex_prefix(text_value(topics[0]).lower()) != TRON_TRANSFER_TOPIC
            or strip_hex_prefix(text_value(topics[1]).lower()) != expected_sender
            or strip_hex_prefix(text_value(topics[2]).lower()) != expected_receiver
        ):
            continue
        try:
            units = int(strip_hex_prefix(text_value(event.get("data"))), 16)
        except ValueError:
            continue
        if units == expected_units:
            matches += 1
    return matches == 1

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
        status TEXT NOT NULL, -- 'sample', 'simulated', or solidified Nile testnet record
        tx_hash TEXT, -- Provider or testnet transaction ID
        network TEXT, -- e.g. 'TRON', 'NIBSS'
        block_height INTEGER,
        receipt_hash TEXT NOT NULL, -- SHA-256 database audit reference
        prev_hash TEXT,
        created_at INTEGER,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    )
    """)
    c.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS idx_testnet_tx_hash
    ON contributions (tx_hash)
    WHERE status = 'testnet_confirmed' AND tx_hash IS NOT NULL
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
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        amount_ngn REAL NOT NULL,
        destination_address TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        block_height INTEGER,
        notes TEXT,
        receipt_hash TEXT NOT NULL,
        prev_hash TEXT,
        requested_at INTEGER,
        reviewed_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """)
    c.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_tx_hash_unique
    ON withdrawal_requests (tx_hash) WHERE tx_hash IS NOT NULL
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
    if SEED_DEMO_DATA and campaign_count < 27:
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
                else "committee@example.test"
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            """, (admin_id, admin_email, admin_pwd, "Sample audit committee", "admin", int(time.time())))

            org1_id = str(uuid.uuid4())
            org1_pwd = (
                password_hash(secrets.token_urlsafe(32))
                if DATABASE_URL
                else hashlib.sha256("student123".encode()).hexdigest()
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, org_name, campus, matric_number, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (org1_id, "organizer@example.test", org1_pwd, "Sample student organizer", "student_org", "Example Robotics and AI Team", "UNIUYO", "", int(time.time())))

            donor_id = str(uuid.uuid4())
            donor_pwd = (
                password_hash(secrets.token_urlsafe(32))
                if DATABASE_URL
                else hashlib.sha256("donor123".encode()).hexdigest()
            )
            c.execute("""
            INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            """, (donor_id, "backer@example.test", donor_pwd, "Sample backer", "donor", int(time.time())))
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

        # Seed 3 realistic student initiatives for each of the 9 categories across diverse Nigerian universities
        now = int(time.time())
        campaigns_seed = [
            # 1. Technology (tech)
            (org1_id, "Campus Solar Charging Kiosks", "IEEE Student Branch", "UNIUYO", "tech",
             1500, 2250000, 1150, 1725000, 48, 14, 
             "Setting up 3 solar charging stations with phone lockers near student lecture halls.",
             "Solar Panels: $650\nCharge Controllers & Inverters: $450\nSecure Lockers & Wiring: $400",
             None, "approved", "Pre-approved"),
            (org1_id, "Robotics Society Autonomous Buggy", "Robotics Club", "ABU", "tech",
             1800, 2700000, 1400, 2100000, 52, 21,
             "Building a lightweight autonomous parcel delivery robot for the engineering campus.",
             "Microcontrollers & Sensors: $500\nDC Motors & Chassis: $700\nLi-ion Batteries: $600",
             None, "approved", "Pre-approved"),
            (org1_id, "Student Open Wi-Fi Mesh Node", "Computer Science Guild", "UNILAG", "tech",
             1200, 1800000, 950, 1425000, 64, 18,
             "Extending student library internet coverage to nearby hostel quads using solar mesh routers.",
             "Outdoor APs & Antennas: $600\nSolar Power Kits: $400\nMounting Brackets & Cables: $200",
             None, "approved", "Pre-approved"),

            # 2. Research & Labs (labs)
            (org1_id, "Biomedical Capstone Testing Rig", "Biomedical Engineering Society", "UNILAG", "labs",
             1600, 2400000, 1250, 1875000, 39, 16,
             "Acquiring digital test meters and breadboards for undergraduate final year hardware projects.",
             "Digital Multimeters: $500\nOscilloscope: $700\nPrototyping Components: $400",
             None, "approved", "Pre-approved"),
            (org1_id, "Hostel Water Quality Sensor Unit", "Water Resources Club", "UNN", "labs",
             1100, 1650000, 850, 1275000, 31, 12,
             "Installing turbidity and pH testing stations across student hostel boreholes.",
             "Sensor Probes: $450\nMicrocontroller Logger: $350\nPiping & Hardware: $300",
             None, "approved", "Pre-approved"),
            (org1_id, "Soil Nutrient Testing Starter Kit", "Agricultural Students Union", "FUTA", "labs",
             1300, 1950000, 980, 1470000, 35, 20,
             "Providing digital NPK soil testing kits for students testing farmland plots.",
             "Digital NPK Meters: $600\nReagent Kits: $450\nProtective Cases: $250",
             None, "approved", "Pre-approved"),

            # 3. Competitions (competitions)
            (org1_id, "All-African Debate Tournament Team", "Parliamentary Debate Union", "UI", "competitions",
             1400, 2100000, 1200, 1800000, 46, 9,
             "Travel accommodation and registration for 4 student debaters at the national finals.",
             "Team Travel: $800\nRegistration Fees: $400\nTraining Materials: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Inter-Campus Cyber CTF Delegation", "Cyber Security Club", "FUTO", "competitions",
             1200, 1800000, 950, 1425000, 41, 15,
             "Hardware kits and contest registration for the national collegiate hacking finals.",
             "Hardware Toolkits: $500\nContest Registration: $400\nTravel Logistics: $300",
             None, "approved", "Pre-approved"),
            (org1_id, "National Law Students Moot Court", "Law Students Association", "OAU", "competitions",
             1000, 1500000, 820, 1230000, 33, 11,
             "Legal research briefs and travel support for the collegiate appellate moot court team.",
             "Case Materials & Printing: $300\nTravel & Lodging: $500\nCourt Robes: $200",
             None, "approved", "Pre-approved"),

            # 4. Clean Energy (energy)
            (org1_id, "Hostel Common Room Solar Inverter", "Clean Energy Advocates", "OAU", "energy",
             1400, 2100000, 1100, 1650000, 54, 19,
             "Providing 24-hour reading room lights and fan inverter power in Moremi Hall.",
             "Hybrid Inverter: $550\nSolar Battery: $550\nInstallation & Wiring: $300",
             None, "approved", "Pre-approved"),
            (org1_id, "Engineering Quad Solar Lighting", "Electrical Engineering Society", "UNIUYO", "energy",
             1250, 1875000, 920, 1380000, 38, 14,
             "Mounting 4 standalone solar LED floodlights along the engineering night walkway.",
             "Solar Floodlights: $700\nMounting Poles: $350\nHardware & Anchors: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Biogas Demonstration Digester", "Environmental Tech Society", "UNIBEN", "energy",
             1100, 1650000, 780, 1170000, 29, 22,
             "Setting up a small organic cafeteria waste digester producing clean cooking gas.",
             "Mini Digester Drum: $500\nGas Valves & Hoses: $350\nFeedstock System: $250",
             None, "approved", "Pre-approved"),

            # 5. Education (education)
            (org1_id, "Free Engineering Exam Prep Guides", "Academic Mentorship Forum", "UI", "education",
             700, 1050000, 620, 930000, 44, 10,
             "Printing 200 copies of past question solutions and exam study guides for freshmen.",
             "Printing & Binding: $450\nDesign & Typesetting: $150\nDistribution Bags: $100",
             None, "approved", "Pre-approved"),
            (org1_id, "Campus Coding Bootcamp for Women", "Women in Tech Club", "UNILAG", "education",
             1100, 1650000, 890, 1335000, 37, 17,
             "Weekend Python and web development workshops for 60 female undergraduates.",
             "Workshop Materials & Cloud Credits: $500\nMentor Honoraria: $400\nCertificates & Refreshments: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Audio Narration for Blind Students", "Special Needs Support Team", "UNN", "education",
             900, 1350000, 750, 1125000, 28, 13,
             "Recording essential law and social science lecture audiobooks for visually impaired students.",
             "Condenser Microphone & Headset: $350\nPortable MP3 Audio Players: $400\nStorage Memory Cards: $150",
             None, "approved", "Pre-approved"),

            # 6. Health (health)
            (org1_id, "Campus First Aid Response Kits", "Red Cross Detachment", "UNIUYO", "health",
             850, 1275000, 720, 1080000, 49, 12,
             "Equipping emergency trauma bags and blood pressure monitors in 5 student hostels.",
             "First Aid Bags & Tourniquets: $400\nBlood Pressure Cuffs: $250\nMedical Consumables: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Hostel Health & Wellness Supplies", "Public Health Ambassadors", "ABU", "health",
             750, 1125000, 610, 915000, 32, 16,
             "Stocking sanitary essentials and basic OTC medications in dormitory welfare offices.",
             "Sanitary Pack Kits: $400\nHealth Info Leaflets: $150\nStorage Dispensers: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Student Blood Drive Transit Coolers", "Medical Students Association", "OAU", "health",
             950, 1425000, 830, 1245000, 40, 8,
             "Acquiring temperature-controlled coolers for volunteer blood donation drives.",
             "Insulated Transport Coolers: $500\nCooling Gel Packs: $250\nTesting Strips: $200",
             None, "approved", "Pre-approved"),

            # 7. Community (community)
            (org1_id, "Night Security Solar Wall Packs", "Student Union Welfare Council", "UNIBEN", "community",
             1300, 1950000, 1050, 1575000, 58, 15,
             "Installing 6 motion-sensing solar wall lights on dark paths near girls' hostels.",
             "Solar Wall Lights: $750\nMounting Brackets & Screws: $300\nSecurity Whistles: $250",
             None, "approved", "Pre-approved"),
            (org1_id, "Hostel Food Pantry Project", "Rotaract Campus Club", "UI", "community",
             900, 1350000, 780, 1170000, 36, 14,
             "Setting up emergency food cupboards stocked with staple grains for students in need.",
             "Dry Food Staples: $550\nStorage Containers: $200\nLogistics & Delivery: $150",
             None, "approved", "Pre-approved"),
            (org1_id, "Library Laptop Repair Workshop", "Hardware Enthusiasts Club", "FUTO", "community",
             800, 1200000, 670, 1005000, 33, 11,
             "Providing free laptop diagnostic, battery, and screen repairs for 50 student laptops.",
             "Precision Screwdriver Kits: $250\nSoldering Tools & Paste: $300\nThermal Paste & Alcohol: $250",
             None, "approved", "Pre-approved"),

            # 8. Arts and culture (arts)
            (org1_id, "Inter-Faculty Drama Festival", "Dramatic Society", "OAU", "arts",
             1100, 1650000, 920, 1380000, 45, 12,
             "Stage props, period costumes, and sound mixing for the annual student theatre showcase.",
             "Stage Lighting Rentals: $450\nCostumes & Props: $400\nSound Equipment & Cables: $250",
             None, "approved", "Pre-approved"),
            (org1_id, "Folk Music Archiving Project", "Music Students Guild", "UNIUYO", "arts",
             950, 1425000, 780, 1170000, 34, 18,
             "Digital audio recording and preservation of indigenous drum patterns and songs.",
             "Handheld Field Recorder: $500\nCondenser Mic: $300\nSD Cards & Hard Drive: $150",
             None, "approved", "Pre-approved"),
            (org1_id, "Campus Art Studio Mural Project", "Fine Arts Students Guild", "UNN", "arts",
             850, 1275000, 680, 1020000, 27, 20,
             "Purchasing acrylic exterior paints and brushes to restore the faculty studio entrance mural.",
             "Exterior Acrylic Paints: $450\nBrushes & Rollers: $200\nProtective Sealant: $200",
             None, "approved", "Pre-approved"),

            # 9. Business (business)
            (org1_id, "Student Entrepreneur Seed Grants", "Junior Chamber International", "UNILAG", "business",
             1500, 2250000, 1200, 1800000, 50, 16,
             "Three $500 mini-grants for student-run micro-enterprises on campus.",
             "Mini Seed Grant 1: $500\nMini Seed Grant 2: $500\nMini Seed Grant 3: $500",
             None, "approved", "Pre-approved"),
            (org1_id, "Student Hostel Laundromat Setup", "Campus Cooperative Club", "UNIUYO", "business",
             1600, 2400000, 1300, 1950000, 47, 19,
             "Procuring 2 semi-industrial washing machines for a student-run laundry cooperative.",
             "2x Washing Machines: $1,100\nPlumbing & Electrical: $300\nDetergent & Bins: $200",
             None, "approved", "Pre-approved"),
            (org1_id, "Campus Vegetable Micro-Farm", "Agricultural Club", "FUTA", "business",
             1000, 1500000, 810, 1215000, 32, 25,
             "Setting up drip irrigation to grow fresh greens sold to student cafeteria vendors.",
             "Drip Irrigation Piping: $450\nSeeds & Organic Fertilizer: $350\nGardening Tools: $200",
             None, "approved", "Pre-approved"),
        ]

        for camp in campaigns_seed:
            c.execute("SELECT id FROM campaigns WHERE title = ?", (camp[1],))
            if not c.fetchone():
                c.execute("""
                INSERT INTO campaigns (user_id, title, org, campus, category, goal_usd, goal_ngn, raised_usd, raised_ngn, backers_count, days, about, budget_breakdown, wallet_address, status, approval_notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, camp + (now,))

        # Seed Contributions with cryptographic hashes
        c.execute("SELECT id FROM campaigns ORDER BY id ASC LIMIT 4")
        seeded_ids = [r[0] for r in c.fetchall()]
        cid1 = seeded_ids[0] if len(seeded_ids) > 0 else 1
        cid2 = seeded_ids[1] if len(seeded_ids) > 1 else cid1
        cid3 = seeded_ids[2] if len(seeded_ids) > 2 else cid1
        cid4 = seeded_ids[3] if len(seeded_ids) > 3 else cid1

        prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
        seed_ledger = [
            ("UF-9B38D1", cid1, donor_id, "Example backer", 150, 225000, "USD", "USDT_TRC20", "sample", None, "Example data only", None),
            ("UF-81CA4E", cid2, None, "Example backer", 50, 75000, "NGN", "NAIRA_TRANSFER", "sample", None, "Example data only", None),
            ("UF-77D92A", cid3, donor_id, "Example backer", 200, 300000, "USD", "USDT_TRC20", "sample", None, "Example data only", None),
            ("UF-43A88C", cid4, None, "Example backer", 75, 112500, "USD", "USDT_TRC20", "sample", None, "Example data only", None)
        ]

        for item in seed_ledger:
            c.execute("SELECT id FROM contributions WHERE ref = ?", (item[0],))
            if not c.fetchone():
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
    # Always enforce strictly 3 approved campaigns per category across all 9 categories
    for cat in ("arts", "business", "community", "competitions", "education", "energy", "health", "labs", "tech"):
        c.execute("SELECT id FROM campaigns WHERE category = ? AND status = 'approved' ORDER BY id ASC", (cat,))
        cat_rows = c.fetchall()
        if len(cat_rows) > 3:
            for excess in cat_rows[3:]:
                c.execute("DELETE FROM campaigns WHERE id = ?", (excess[0],))

    conn.commit()

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
                "payments": (
                    "tron-testnet"
                    if PAYMENTS_MODE == "tron-testnet"
                    else "sandbox" if PAYMENTS_MODE == "sandbox" and not IS_VERCEL else "disabled"
                ),
                "demo_accounts_allowed": not bool(DATABASE_URL),
            })
        elif path == "/api/payments/config":
            receiver_address = (
                TRON_TESTNET_RECEIVER_ADDRESS
                or os.environ.get("TRON_RECEIVER_ADDRESS", "").strip()
                or "TNo8zm9LYgVeJZPyspseugpzFKqqMcJ7jk"
            )
            token_contract = (
                TRON_TESTNET_TOKEN_CONTRACT
                or os.environ.get("TRON_USDT_CONTRACT", "").strip()
                or TRON_NILE_USDT_CONTRACT
            )
            is_active = PAYMENTS_MODE == "tron-testnet"
            return self.send_json(200, {
                "mode": "tron-testnet" if is_active else "preview",
                "network": "TRON Nile Testnet",
                "chain_id": "0xcd8690dc",
                "token_symbol": "USDT",
                "token_contract": token_contract,
                "receiver_address": receiver_address,
                "decimals": TRON_TESTNET_TOKEN_DECIMALS,
                "can_verify": is_active,
                "notice": "Nile testnet only. Test tokens have no real value.",
            })

        elif path == "/api/ledger/verify":
            conn = get_db()
            c = conn.cursor()
            c.execute("""
            SELECT ref, receipt_hash, prev_hash
            FROM contributions
            WHERE receipt_hash IS NOT NULL
            ORDER BY id ASC
            """)
            records = [dict(r) for r in c.fetchall()]
            conn.close()
            previous = "0" * 64
            broken = []
            for record in records:
                if record["prev_hash"] and record["prev_hash"] != previous:
                    broken.append(record["ref"])
                previous = record["receipt_hash"]
            return self.send_json(200, {
                "valid": not broken,
                "records_checked": len(records),
                "broken_references": broken,
                "notice": "Database hash-chain check only. This is not an on-chain or blockchain proof.",
            })

        elif path == "/api/admin/withdrawals":
            user = self.get_auth_user()
            if not user or user["role"] != "admin":
                return self.send_json(403, {"error": "Administrator privilege required"})
            conn = get_db()
            c = conn.cursor()
            c.execute("""
            SELECT w.*, c.title AS campaign_title, c.org AS organization
            FROM withdrawal_requests w
            JOIN campaigns c ON c.id = w.campaign_id
            ORDER BY w.requested_at DESC, w.id DESC
            """)
            rows = [dict(r) for r in c.fetchall()]
            conn.close()
            return self.send_json(200, {"withdrawals": rows})

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
                rows = [dict(r) for r in c.fetchall()]
            elif status_filter == "pending" and user and user["role"] == "admin":
                public_listing = False
                c.execute("SELECT * FROM campaigns WHERE status = 'pending' ORDER BY id DESC")
                rows = [dict(r) for r in c.fetchall()]
            elif status_filter == "mine" and user:
                public_listing = False
                c.execute("SELECT * FROM campaigns WHERE user_id = ? ORDER BY id DESC", (user["id"],))
                rows = [dict(r) for r in c.fetchall()]
            else:
                c.execute("SELECT * FROM campaigns WHERE status = 'approved' ORDER BY id DESC")
                all_approved = [dict(r) for r in c.fetchall()]
                # Strict guarantee: exactly up to 3 campaigns per category
                rows = []
                cat_tally = {}
                for row in all_approved:
                    cat = row.get("category")
                    if cat_tally.get(cat, 0) < 3:
                        cat_tally[cat] = cat_tally.get(cat, 0) + 1
                        rows.append(row)
            conn.close()
            if public_listing:
                for row in rows:
                    row.pop("user_id", None)
                    row.pop("wallet_address", None)
                    row.pop("approval_notes", None)
            return self.send_json(200, {"campaigns": rows})

        elif path.startswith("/api/campaigns/") and path.endswith("/payout-summary"):
            camp_id = positive_id(path.split("/")[-2])
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Sign in to view payout information"})
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM campaigns WHERE id = ?", (camp_id,))
            campaign = c.fetchone()
            if not campaign:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})
            campaign = dict(campaign)
            if user["role"] != "admin" and campaign["user_id"] != user["id"]:
                conn.close()
                return self.send_json(403, {"error": "You cannot view payout information for this campaign"})
            c.execute("""
            SELECT COALESCE(SUM(amount_usd), 0) AS total
            FROM contributions
            WHERE campaign_id = ? AND status = 'testnet_confirmed'
            """, (camp_id,))
            confirmed = float(c.fetchone()["total"])
            c.execute("""
            SELECT COALESCE(SUM(amount_usd), 0) AS total
            FROM withdrawal_requests
            WHERE campaign_id = ? AND status IN ('requested', 'approved', 'completed')
            """, (camp_id,))
            reserved = float(c.fetchone()["total"])
            c.execute("""
            SELECT * FROM withdrawal_requests
            WHERE campaign_id = ?
            ORDER BY requested_at DESC, id DESC
            """, (camp_id,))
            withdrawals = [dict(r) for r in c.fetchall()]
            conn.close()
            available = max(0.0, round(confirmed - reserved, 6))
            return self.send_json(200, {
                "campaign_id": camp_id,
                "confirmed_testnet_usd": confirmed,
                "reserved_testnet_usd": reserved,
                "available_testnet_usd": available,
                "destination_address": campaign.get("wallet_address") or "",
                "withdrawals": withdrawals,
                "notice": "Testnet funds only. No real-value payout or custody transfer is available.",
            })

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
                   channel, status, created_at, tx_hash, block_height
            FROM contributions
            WHERE campaign_id = ? AND status IN ('verified', 'sample', 'simulated', 'testnet_confirmed')
            ORDER BY id DESC LIMIT 10
            """, (camp_id,))
            conts = [dict(r) for r in c.fetchall()]
            for contribution in conts:
                if contribution["status"] != "testnet_confirmed":
                    contribution.pop("tx_hash", None)
                    contribution.pop("block_height", None)

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
                   l.tx_hash, l.block_height,
                   c.title as campaign_title, c.org as campaign_org, c.campus as campus
            FROM contributions l
            JOIN campaigns c ON l.campaign_id = c.id
            WHERE l.status IN ('verified', 'sample', 'simulated', 'testnet_confirmed')
            ORDER BY l.id DESC
            """)
            ledger_rows = [dict(r) for r in c.fetchall()]
            conn.close()
            for record in ledger_rows:
                if record["status"] != "testnet_confirmed":
                    record.pop("tx_hash", None)
                    record.pop("block_height", None)
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

    def verify_tron_testnet_contribution(self, data, camp_id, donor_name):
        try:
            config = tron_testnet_configuration()
        except ValueError as exc:
            return self.send_json(503, {"error": str(exc)})

        tx_id = text_value(data.get("tx_id")).lower()
        if not re.fullmatch(r"[a-f0-9]{64}", tx_id):
            return self.send_json(400, {"error": "Enter a valid TRON transaction ID"})
        if not camp_id:
            return self.send_json(400, {"error": "Campaign ID is required"})
        if len(donor_name) > 60:
            return self.send_json(400, {"error": "Display name must be 60 characters or fewer"})
        try:
            amount = decimal.Decimal(str(data.get("amount_usd")))
            sender_bytes = decode_tron_address(data.get("sender_address"))
        except (decimal.InvalidOperation, ValueError):
            return self.send_json(400, {"error": "Enter a valid amount and TRON sender address"})
        if not amount.is_finite() or amount < 1:
            return self.send_json(400, {"error": "The minimum testnet contribution is 1 USDT"})
        scaled_amount = amount * (10 ** config["decimals"])
        if scaled_amount != scaled_amount.to_integral_value():
            return self.send_json(400, {"error": "USDT amount cannot have more than 6 decimal places"})
        amount_units = int(scaled_amount)
        amount_usd = float(amount)
        if not math.isfinite(amount_usd) or amount_units >= 2 ** 256:
            return self.send_json(400, {"error": "Contribution amount is too large"})

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM campaigns WHERE id = ? AND status = 'approved'", (camp_id,))
        if not c.fetchone():
            conn.close()
            return self.send_json(404, {"error": "Campaign not found"})
        c.execute(
            "SELECT id FROM contributions WHERE tx_hash = ? AND status = 'testnet_confirmed'",
            (tx_id,),
        )
        if c.fetchone():
            conn.close()
            return self.send_json(409, {"error": "This testnet transaction has already been recorded"})
        conn.close()

        try:
            receipt = get_tron_solidified_receipt(tx_id, config)
        except TronRPCError as exc:
            return self.send_json(503, {"error": str(exc)})
        if text_value(receipt.get("id")).lower() != tx_id or not isinstance(receipt.get("receipt"), dict):
            return self.send_json(202, {
                "status": "pending",
                "message": "The transaction is not solidified yet. Keep this reference and try verification again shortly.",
                "tx_hash": tx_id,
            })
        if receipt["receipt"].get("result") != "SUCCESS":
            return self.send_json(400, {"error": "The solidified TRON transaction did not succeed"})
        block_height = positive_id(receipt.get("blockNumber"))
        if not block_height:
            return self.send_json(503, {"error": "The solidified receipt did not include a block number"})
        if not has_matching_tron_transfer(receipt, config, sender_bytes, amount_units):
            return self.send_json(400, {
                "error": "No matching USDT transfer to the configured Nile receiver was found"
            })

        rate = get_current_rate()
        amount_ngn = round(amount_usd * rate, 2)
        if not math.isfinite(amount_ngn):
            return self.send_json(400, {"error": "Contribution amount is too large"})
        now = int(time.time())
        ref_code = f"UF-{uuid.uuid4().hex[:12].upper()}"
        auth_user = self.get_auth_user()
        donor_id = auth_user["id"] if auth_user else None
        conn = get_db()
        prev_hash_row = conn.execute(
            "SELECT receipt_hash FROM contributions ORDER BY id DESC LIMIT 1"
        ).fetchone()
        conn.close()
        prev_hash = prev_hash_row[0] if prev_hash_row else "0" * 64
        receipt_hash = hashlib.sha256(
            f"{ref_code}:{camp_id}:{tx_id}:{amount_usd}:{prev_hash}".encode()
        ).hexdigest()

        conn = get_db()
        c = conn.cursor()
        c.execute("""
        INSERT INTO contributions (
            ref, campaign_id, donor_id, donor_name, amount_usd, amount_ngn,
            currency, channel, status, tx_hash, network, block_height,
            receipt_hash, prev_hash, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'USD', 'USDT_TRC20', 'testnet_confirmed', ?, 'TRON Nile', ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        """, (
            ref_code, camp_id, donor_id, donor_name, amount_usd, amount_ngn,
            tx_id, block_height, receipt_hash, prev_hash, now,
        ))
        if c.rowcount == 0:
            conn.close()
            return self.send_json(409, {"error": "This testnet transaction has already been recorded"})
        conn.commit()
        conn.close()
        return self.send_json(200, {
            "status": "testnet_confirmed",
            "reference": ref_code,
            "amount_usd": amount_usd,
            "amount_ngn": amount_ngn,
            "tx_hash": tx_id,
            "block_height": block_height,
            "network": "TRON Nile",
            "receipt_hash": receipt_hash,
            "message": "Transfer verified on TRON Nile testnet. Test tokens have no real value; campaign totals are unchanged.",
        })

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
            # Keep the legacy column empty; registration no longer collects unverified student IDs.
            matric_number = ""

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

            if role == "student_org" and (not org_name or not campus):
                return self.send_json(400, {"error": "Student organizations must provide a group name and campus code"})
            if role == "student_org" and (len(org_name) > 80 or len(campus) > 12):
                return self.send_json(400, {"error": "Organization name or campus code is too long"})

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
                "message": "Your account and its campaigns, spending reports, and associated simulated or testnet contribution records were deleted."
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
            wallet = text_value(data.get("wallet_address")) or None

            if wallet:
                try:
                    decode_tron_address(wallet)
                except ValueError:
                    return self.send_json(400, {"error": "Enter a valid TRON destination wallet address"})

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

            # Campaigns go live immediately; payouts remain gated by audit committee release
            initial_status = "approved"

            conn = get_db()
            c = conn.cursor()
            c.execute("""
            INSERT INTO campaigns (user_id, title, org, campus, category, goal_usd, goal_ngn, days, about, budget_breakdown, wallet_address, status, approval_notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user["id"], title, user.get("org_name") or user["name"], user.get("campus") or "NATIONAL", category, goal_usd, goal_ngn, days, about, budget, wallet, initial_status, "Published directly; payouts require audit committee approval", now))
            
            new_id = c.lastrowid
            conn.commit()
            conn.close()

            return self.send_json(201, {
                "id": new_id,
                "status": initial_status,
                "message": "Campaign is live! Payouts require audit committee approval."
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

        # 6. API: USDT sandbox or Nile testnet record
        elif path == "/api/payments/verify-usdt":
            camp_id = positive_id(data.get("campaign_id"))
            donor_name = text_value(data.get("donor_name")) or "Anonymous Backer"
            expected_amount = finite_number(data.get("amount_usd"), 0)

            if PAYMENTS_MODE == "tron-testnet":
                return self.verify_tron_testnet_contribution(data, camp_id, donor_name)
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

        # 10. API: Organization Payout / Withdrawal Request (Testnet & Multitrust Simulation)
        elif path.startswith("/api/campaigns/") and path.endswith("/wallet"):
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Authentication required."})
            camp_id = positive_id(path.split("/")[-2])
            wallet = text_value(data.get("wallet_address"))
            if not wallet:
                return self.send_json(400, {"error": "A destination wallet address is required"})
            try:
                decode_tron_address(wallet)
            except ValueError:
                return self.send_json(400, {"error": "Enter a valid TRON destination wallet address"})
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM campaigns WHERE id = ?", (camp_id,))
            camp = c.fetchone()
            if not camp:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})
            camp = dict(camp)
            if user["role"] != "admin" and camp["user_id"] != user["id"]:
                conn.close()
                return self.send_json(403, {"error": "Only the campaign organizer or an administrator can update the payout wallet"})
            c.execute("UPDATE campaigns SET wallet_address = ? WHERE id = ?", (wallet, camp_id))
            conn.commit()
            conn.close()
            return self.send_json(200, {
                "message": "Destination wallet updated successfully.",
                "wallet_address": wallet,
            })

        # 11. API: Organization Payout / Withdrawal Request (Testnet & Multitrust Simulation)
        elif path == "/api/campaigns/withdraw":
            user = self.get_auth_user()
            if not user:
                return self.send_json(401, {"error": "Authentication required."})

            camp_id = positive_id(data.get("campaign_id"))
            amount_usd = finite_number(data.get("amount_usd"), 0)
            destination = text_value(data.get("destination_address"))
            notes = text_value(data.get("notes")) or "Organization treasury withdrawal"

            if not camp_id or amount_usd <= 0:
                return self.send_json(400, {"error": "Campaign ID and a positive withdrawal amount are required"})

            try:
                decode_tron_address(destination)
            except ValueError:
                return self.send_json(400, {"error": "Enter a valid TRON destination wallet address"})

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM campaigns WHERE id = ?", (camp_id,))
            campaign = c.fetchone()
            if not campaign:
                conn.close()
                return self.send_json(404, {"error": "Campaign not found"})
            campaign = dict(campaign)
            if user["role"] != "admin" and campaign["user_id"] != user["id"]:
                conn.close()
                return self.send_json(403, {"error": "Only the campaign organizer or an administrator can request withdrawals"})

            # Calculate available testnet funds
            c.execute("""
            SELECT COALESCE(SUM(amount_usd), 0) AS total
            FROM contributions
            WHERE campaign_id = ? AND status = 'testnet_confirmed'
            """, (camp_id,))
            confirmed = float(c.fetchone()["total"])

            c.execute("""
            SELECT COALESCE(SUM(amount_usd), 0) AS total
            FROM withdrawal_requests
            WHERE campaign_id = ? AND status IN ('requested', 'approved', 'completed')
            """, (camp_id,))
            reserved = float(c.fetchone()["total"])

            available = max(0.0, round(confirmed - reserved, 6))
            if amount_usd > available:
                conn.close()
                return self.send_json(400, {
                    "error": f"Withdrawal amount (${amount_usd:.2f}) exceeds available confirmed testnet funds (${available:.2f})"
                })

            rate = get_current_rate()
            amount_ngn = round(amount_usd * rate, 2)
            now = int(time.time())

            c.execute("SELECT receipt_hash FROM withdrawal_requests ORDER BY id DESC LIMIT 1")
            prev_row = c.fetchone()
            prev_hash = prev_row[0] if prev_row else "0" * 64
            seal_data = f"WREQ:{camp_id}:{amount_usd}:{destination}:{now}:{prev_hash}"
            receipt_hash = hashlib.sha256(seal_data.encode()).hexdigest()

            c.execute("""
            INSERT INTO withdrawal_requests (
                campaign_id, user_id, amount_usd, amount_ngn, destination_address,
                status, notes, receipt_hash, prev_hash, requested_at
            )
            VALUES (?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?)
            """, (
                camp_id, user["id"], amount_usd, amount_ngn, destination,
                notes, receipt_hash, prev_hash, now,
            ))
            w_id = c.lastrowid
            conn.commit()
            conn.close()

            return self.send_json(201, {
                "id": w_id,
                "status": "requested",
                "campaign_id": camp_id,
                "amount_usd": amount_usd,
                "destination_address": destination,
                "receipt_hash": receipt_hash,
                "message": "Withdrawal requested. Awaiting audit committee dual-approval release.",
                "notice": "Testnet funds only. No real fiat or cryptocurrency custody transfer is available.",
            })

        # 11. API: Admin Review and Release/Execute Withdrawal Request
        elif path.startswith("/api/admin/withdrawals/") and path.endswith("/review"):
            user = self.get_auth_user()
            if not user or user["role"] != "admin":
                return self.send_json(403, {"error": "Administrator privilege required"})

            w_id = positive_id(path.split("/")[-2])
            action = text_value(data.get("action")) # 'approve', 'reject', 'complete'
            tx_id = text_value(data.get("tx_id")) or None
            review_notes = text_value(data.get("notes")) or ""

            if action not in ("approve", "reject", "complete"):
                return self.send_json(400, {"error": "Action must be approve, reject, or complete"})

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM withdrawal_requests WHERE id = ?", (w_id,))
            req = c.fetchone()
            if not req:
                conn.close()
                return self.send_json(404, {"error": "Withdrawal request not found"})
            req = dict(req)

            now = int(time.time())
            block_height = None

            if action == "approve":
                new_status = "approved"
                c.execute("""
                UPDATE withdrawal_requests
                SET status = ?, notes = COALESCE(?, notes), reviewed_at = ?
                WHERE id = ?
                """, (new_status, review_notes or "Approved by audit committee", now, w_id))
            elif action == "reject":
                new_status = "rejected"
                c.execute("""
                UPDATE withdrawal_requests
                SET status = ?, notes = COALESCE(?, notes), reviewed_at = ?
                WHERE id = ?
                """, (new_status, review_notes or "Declined by audit committee", now, w_id))
            elif action == "complete":
                new_status = "completed"
                # If Nile testnet mode is active and a tx_id is provided, verify on-chain transfer from receiver/custody wallet
                if PAYMENTS_MODE == "tron-testnet" and tx_id:
                    if not re.match(r"^[a-f0-9]{64}$", tx_id, re.I):
                        conn.close()
                        return self.send_json(400, {"error": "Invalid transaction ID format"})
                    try:
                        config = tron_testnet_configuration()
                        receipt = get_tron_solidified_receipt(tx_id, config)
                    except (ValueError, TronRPCError) as exc:
                        conn.close()
                        return self.send_json(503, {"error": f"Nile verification failed: {exc}"})
                    if not receipt or not receipt.get("receipt"):
                        conn.close()
                        return self.send_json(202, {"status": "pending", "message": "Transaction receipt pending on Nile"})
                    if receipt["receipt"].get("result") != "SUCCESS":
                        conn.close()
                        return self.send_json(400, {"error": "The withdrawal transaction did not succeed on Nile"})
                    block_height = positive_id(receipt.get("blockNumber"))
                    amount_units = token_units_from_number(req["amount_usd"], config["decimals"])
                    if not has_matching_tron_transfer_between(receipt, config, config["receiver_address"], req["destination_address"], amount_units):
                        conn.close()
                        return self.send_json(400, {"error": "No matching USDT payout transfer found from custody wallet to organization destination"})

                c.execute("""
                UPDATE withdrawal_requests
                SET status = ?, tx_hash = ?, block_height = ?, notes = COALESCE(?, notes), completed_at = ?
                WHERE id = ?
                """, (new_status, tx_id, block_height, review_notes or "Disbursed to student organization treasury", now, w_id))

            conn.commit()
            conn.close()

            return self.send_json(200, {
                "id": w_id,
                "status": new_status,
                "tx_hash": tx_id,
                "block_height": block_height,
                "message": f"Withdrawal request {new_status} successfully.",
            })

        return self.send_json(404, {"error": "API endpoint not found"})

def run_server():
    init_db()
    server_address = (HOST, PORT)
    httpd = socketserver.TCPServer(server_address, UniFundAPIHandler)
    print(f"UniFund backend running at http://{HOST}:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
