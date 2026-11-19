import http.client
import json
import os
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server


class UniFundAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            partial(server.UniFundAPIHandler, directory=server.STATIC_ROOT),
        )
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        server.DB_FILE = os.path.join(self.tempdir.name, "test.db")
        server.PAYMENTS_MODE = "sandbox"
        server.init_db()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_remote_admin_bootstrap_uses_documented_environment_variables(self):
        with patch.dict(os.environ, {
            "BOOTSTRAP_ADMIN_EMAIL": "  admin@example.edu ",
            "BOOTSTRAP_ADMIN_PASSWORD": "private-password",
        }, clear=False):
            os.environ.pop("DEMO_ADMIN_PASSWORD", None)
            self.assertEqual(
                server.bootstrap_admin_credentials(),
                ("admin@example.edu", "private-password"),
            )

        with patch.dict(os.environ, {
            "BOOTSTRAP_ADMIN_EMAIL": "",
            "BOOTSTRAP_ADMIN_PASSWORD": "",
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "BOOTSTRAP_ADMIN_EMAIL"):
                server.bootstrap_admin_credentials()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        encoded = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        request_headers = dict(headers or {})
        if encoded is not None:
            request_headers["Content-Type"] = "application/json"
        conn.request(method, path, body=encoded, headers=request_headers)
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        return result

    def json_request(self, method, path, body=None, headers=None):
        status, content = self.request(method, path, body, headers)
        return status, json.loads(content)

    def login(self, email, password):
        status, data = self.json_request(
            "POST", "/api/auth/login", {"email": email, "password": password}
        )
        self.assertEqual(status, 200)
        return data["token"]

    def test_api_reads_and_static_file_allowlist(self):
        health_status, health = self.json_request("GET", "/api/health")
        self.assertEqual(health_status, 200)
        self.assertEqual(health["database"], "connected")
        self.assertEqual(self.json_request("GET", "/api/exchange-rate")[0], 200)
        self.assertEqual(self.json_request("GET", "/api/campaigns")[0], 200)
        self.assertEqual(self.json_request("GET", "/api/ledger")[0], 200)
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/index.html")[0], 200)
        self.assertEqual(self.request("GET", "/campaigns")[0], 200)
        self.assertEqual(self.request("GET", "/c/3")[0], 200)
        self.assertEqual(self.request("GET", "/privacy")[0], 200)
        self.assertEqual(self.request("GET", "/unifund.db")[0], 404)
        self.assertEqual(self.request("GET", "/server.py")[0], 404)

    def test_seed_ledger_records_are_marked_as_examples(self):
        status, response = self.json_request("GET", "/api/ledger")
        self.assertEqual(status, 200)
        seeded = [row for row in response["ledger"] if row["ref"].startswith("UF-")]
        self.assertTrue(seeded)
        self.assertTrue(all(row["status"] == "sample" for row in seeded))
        self.assertTrue(all(row["donor_name"] == "Example backer" for row in seeded))

        conn = server.get_db()
        try:
            seed_rows = conn.execute(
                "SELECT tx_hash, block_height FROM contributions WHERE ref IN (?, ?, ?, ?)",
                ("UF-9B38D1", "UF-81CA4E", "UF-77D92A", "UF-43A88C"),
            ).fetchall()
            self.assertEqual(len(seed_rows), 4)
            self.assertTrue(all(row["tx_hash"] is None and row["block_height"] is None for row in seed_rows))
        finally:
            conn.close()

    def test_campaign_category_options_are_accepted_by_the_api(self):
        admin_headers = {
            "Authorization": f"Bearer {self.login('committee@example.test', 'admin123')}"
        }
        for category in ("tech", "labs", "competitions", "energy", "education", "health", "community", "arts", "business"):
            with self.subTest(category=category):
                status, result = self.json_request("POST", "/api/campaigns", {
                    "title": f"Test project {category}",
                    "category": category,
                    "goal_usd": 500,
                    "days": 30,
                    "about": "A test campaign for category validation.",
                }, admin_headers)
                self.assertEqual(status, 201, result)

    def test_public_campaign_and_ledger_responses_hide_private_fields(self):
        for path in ("/api/campaigns", "/api/campaigns?status=mine", "/api/campaigns?status=pending", "/api/campaigns?status=all"):
            _, listing = self.json_request("GET", path)
            self.assertTrue(listing["campaigns"])
            self.assertNotIn("user_id", listing["campaigns"][0])
            self.assertNotIn("wallet_address", listing["campaigns"][0])

        _, detail = self.json_request("GET", "/api/campaigns/1")
        self.assertNotIn("user_id", detail["campaign"])
        self.assertNotIn("wallet_address", detail["campaign"])
        self.assertNotIn("donor_id", detail["campaign"]["contributions"][0])
        self.assertNotIn("tx_hash", detail["campaign"]["contributions"][0])

        _, ledger = self.json_request("GET", "/api/ledger")
        self.assertTrue(ledger["ledger"])
        self.assertNotIn("donor_id", ledger["ledger"][0])
        self.assertNotIn("tx_hash", ledger["ledger"][0])
        self.assertNotIn("prev_hash", ledger["ledger"][0])

    def test_donor_session_history_and_logout(self):
        status, user = self.json_request("POST", "/api/auth/register", {
            "name": "Demo Backer",
            "email": "backer@example.edu",
            "password": " strong-password-123 ",
            "role": "donor",
        })
        self.assertEqual(status, 201)
        self.assertTrue(self.login("backer@example.edu", " strong-password-123 "))
        headers = {"Authorization": f"Bearer {user['token']}"}
        self.assertEqual(self.json_request("GET", "/api/auth/me", headers=headers)[0], 200)
        self.assertEqual(self.json_request("GET", "/api/donor/history", headers=headers)[0], 200)
        self.assertEqual(
            self.json_request(
                "POST",
                "/api/campaigns",
                {
                    "title": "Backer cannot create this",
                    "goal_usd": 50,
                    "about": "This request must be denied for donor accounts.",
                },
                headers,
            )[0],
            403,
        )
        self.assertEqual(self.json_request("POST", "/api/auth/logout", headers=headers)[0], 200)
        self.assertEqual(self.json_request("GET", "/api/auth/me", headers=headers)[0], 401)

    def test_account_deletion_removes_associated_demo_data_and_sessions(self):
        status, registered = self.json_request("POST", "/api/auth/register", {
            "name": "Student Lead",
            "email": "delete-me@example.edu",
            "password": "strong-password-123",
            "role": "student_org",
            "org_name": "Campus Makers",
            "campus": "UNIUYO",
        })
        self.assertEqual(status, 201)
        user_id = registered["user"]["id"]
        headers = {"Authorization": f"Bearer {registered['token']}"}

        status, campaign = self.json_request("POST", "/api/campaigns", {
            "title": "Campaign to delete",
            "category": "tech",
            "goal_usd": 500,
            "days": 30,
            "about": "A test campaign for account deletion.",
        }, headers)
        self.assertEqual(status, 201)
        campaign_id = campaign["id"]

        status, _ = self.json_request("POST", "/api/campaigns/spending", {
            "campaign_id": campaign_id,
            "title": "Test supplies",
            "amount": 20,
            "currency": "USD",
            "vendor": "Demo supplier",
        }, headers)
        self.assertEqual(status, 201)

        status, contribution = self.json_request("POST", "/api/payments/verify-usdt", {
            "campaign_id": 1,
            "amount_usd": 7,
        }, headers)
        self.assertEqual(status, 200)
        self.assertEqual(contribution["status"], "simulated")

        self.assertEqual(
            self.json_request("POST", "/api/account/delete", {"password": "wrong-password"}, headers)[0],
            403,
        )
        self.assertEqual(self.json_request("GET", "/api/auth/me", headers=headers)[0], 200)

        status, result = self.json_request(
            "POST", "/api/account/delete", {"password": "strong-password-123"}, headers
        )
        self.assertEqual(status, 200)
        self.assertIn("deleted", result["message"])
        self.assertEqual(self.json_request("GET", "/api/auth/me", headers=headers)[0], 401)

        conn = server.get_db()
        try:
            self.assertIsNone(conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone())
            self.assertIsNone(conn.execute("SELECT token FROM sessions WHERE user_id = ?", (user_id,)).fetchone())
            self.assertIsNone(conn.execute("SELECT id FROM campaigns WHERE id = ?", (campaign_id,)).fetchone())
            self.assertIsNone(conn.execute("SELECT id FROM spending_reports WHERE campaign_id = ?", (campaign_id,)).fetchone())
            self.assertIsNone(conn.execute("SELECT id FROM contributions WHERE donor_id = ?", (user_id,)).fetchone())
        finally:
            conn.close()

    def test_admin_cannot_delete_account_through_self_service(self):
        admin_token = self.login("committee@example.test", "admin123")
        headers = {"Authorization": f"Bearer {admin_token}"}
        self.assertEqual(
            self.json_request("POST", "/api/account/delete", {"password": "admin123"}, headers)[0],
            403,
        )
        self.assertEqual(self.json_request("GET", "/api/auth/me", headers=headers)[0], 200)

    def test_registration_campaign_review_and_spending_workflow(self):
        status, new_user = self.json_request("POST", "/api/auth/register", {
            "name": "Student Lead",
            "email": "lead@example.edu",
            "password": "strong-password-123",
            "role": "student_org",
            "org_name": "Campus Makers",
            "campus": "UNIUYO",
            "matric_number": "not-collected",
        })
        self.assertEqual(status, 201)
        conn = server.get_db()
        try:
            student_id = conn.execute(
                "SELECT matric_number FROM users WHERE email = ?",
                ("lead@example.edu",),
            ).fetchone()["matric_number"]
            self.assertEqual(student_id, "")
        finally:
            conn.close()
        owner_headers = {"Authorization": f"Bearer {new_user['token']}"}

        status, campaign = self.json_request("POST", "/api/campaigns", {
            "title": "Build a campus weather station",
            "category": "tech",
            "goal_usd": 500,
            "days": 30,
            "about": "A student-built station for local weather monitoring.",
        }, owner_headers)
        self.assertEqual(status, 201)
        campaign_id = campaign["id"]
        self.assertEqual(campaign["status"], "approved")
        self.assertEqual(self.json_request("GET", f"/api/campaigns/{campaign_id}")[0], 200)

        admin_headers = {
            "Authorization": f"Bearer {self.login('committee@example.test', 'admin123')}"
        }
        self.assertEqual(
            self.json_request("GET", "/api/campaigns?status=pending", headers=admin_headers)[0],
            200,
        )
        self.assertEqual(
            self.json_request("GET", "/api/campaigns?status=all", headers=admin_headers)[0],
            200,
        )
        status, _ = self.json_request(
            "POST",
            f"/api/admin/campaigns/{campaign_id}/review",
            {"action": "approve"},
            admin_headers,
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.json_request("GET", f"/api/campaigns/{campaign_id}")[0], 200)

        status, _ = self.json_request("POST", "/api/campaigns/spending", {
            "campaign_id": campaign_id,
            "title": "Weather sensors",
            "amount": 80,
            "currency": "USD",
            "vendor": "Campus supplier",
        }, owner_headers)
        self.assertEqual(status, 201)
        status, detail = self.json_request("GET", f"/api/campaigns/{campaign_id}", headers=owner_headers)
        self.assertEqual(status, 200)
        self.assertTrue(detail["campaign"]["is_owner"])
        self.assertEqual(len(detail["campaign"]["spending_reports"]), 1)

    def test_sandbox_payment_endpoints_are_disabled_on_vercel(self):
        original_is_vercel = server.IS_VERCEL
        server.IS_VERCEL = True
        try:
            status, health = self.json_request("GET", "/api/health")
            self.assertEqual(status, 200)
            self.assertEqual(health["payments"], "disabled")
            for path, body in (
                ("/api/payments/verify-usdt", {"campaign_id": 1, "amount_usd": 12}),
                ("/api/payments/verify-naira", {"campaign_id": 1, "amount_ngn": 5000}),
            ):
                status, result = self.json_request("POST", path, body)
                self.assertEqual(status, 503)
                self.assertIn("No contribution was recorded", result["error"])
            _, ledger = self.json_request("GET", "/api/ledger")
            self.assertFalse(any(row["status"] == "simulated" for row in ledger["ledger"]))
        finally:
            server.IS_VERCEL = original_is_vercel

    def test_tron_testnet_records_only_solidified_matching_transfers(self):
        server.PAYMENTS_MODE = "tron-testnet"
        server.TRON_TESTNET_NETWORK = "nile"
        server.TRON_TESTNET_RPC_URL = "https://nile.trongrid.io"
        server.TRON_TESTNET_TOKEN_CONTRACT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"
        server.TRON_TESTNET_RECEIVER_ADDRESS = "TNo8zm9LYgVeJZPyspseugpzFKqqMcJ7jk"
        config = server.tron_testnet_configuration()
        with patch.object(server, "TRON_TESTNET_TOKEN_CONTRACT", "TWrongContractAddress"):
            with self.assertRaisesRegex(ValueError, "approved Nile test USDT contract"):
                server.tron_testnet_configuration()
        sender = "TGQVLckg1gDZS5wUwPTrPgRG4U8MKC4jcP"
        sender_bytes = server.decode_tron_address(sender)
        receiver_topic = config["receiver_bytes"][1:].hex().rjust(64, "0")
        sender_topic = sender_bytes[1:].hex().rjust(64, "0")
        tx_id = "ab" * 32
        transfer = {
            "address": config["token_bytes"][1:].hex(),
            "topics": [server.TRON_TRANSFER_TOPIC, sender_topic, receiver_topic],
            "data": f"{12_500_000:064x}",
        }
        receipt = {
            "id": tx_id,
            "blockNumber": 12345,
            "receipt": {"result": "SUCCESS"},
            "log": [transfer],
        }
        before = self.json_request("GET", "/api/campaigns/1")[1]["campaign"]
        with patch.object(server, "get_tron_solidified_receipt", return_value=receipt) as rpc:
            config_status, payment_config = self.json_request("GET", "/api/payments/config")
            self.assertEqual(config_status, 200)
            self.assertEqual(payment_config["chain_id"], "0xcd8690dc")

            status, result = self.json_request("POST", "/api/payments/verify-usdt", {
                "campaign_id": 1,
                "amount_usd": "12.5",
                "sender_address": sender,
                "tx_id": tx_id,
            })
            self.assertEqual(status, 200)
            self.assertEqual(result["status"], "testnet_confirmed")
            self.assertEqual(result["block_height"], 12345)
            self.assertIn("no real value", result["message"])

            duplicate, _ = self.json_request("POST", "/api/payments/verify-usdt", {
                "campaign_id": 1,
                "amount_usd": "12.5",
                "sender_address": sender,
                "tx_id": tx_id,
            })
            self.assertEqual(duplicate, 409)
            rpc.assert_called_once()

        _, after = self.json_request("GET", "/api/campaigns/1")
        self.assertEqual(after["campaign"]["raised_usd"], before["raised_usd"])
        self.assertEqual(after["campaign"]["contributions"][0]["tx_hash"], tx_id)
        _, ledger = self.json_request("GET", "/api/ledger")
        verified = next(row for row in ledger["ledger"] if row["tx_hash"] == tx_id)
        self.assertEqual(verified["status"], "testnet_confirmed")
        self.assertEqual(verified["block_height"], 12345)

    def test_tron_testnet_rejects_pending_and_mismatched_receipts(self):
        server.PAYMENTS_MODE = "tron-testnet"
        server.TRON_TESTNET_NETWORK = "nile"
        server.TRON_TESTNET_RPC_URL = "https://nile.trongrid.io"
        server.TRON_TESTNET_TOKEN_CONTRACT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"
        server.TRON_TESTNET_RECEIVER_ADDRESS = "TNo8zm9LYgVeJZPyspseugpzFKqqMcJ7jk"
        config = server.tron_testnet_configuration()
        sender = "TGQVLckg1gDZS5wUwPTrPgRG4U8MKC4jcP"
        sender_topic = server.decode_tron_address(sender)[1:].hex().rjust(64, "0")
        receiver_topic = config["receiver_bytes"][1:].hex().rjust(64, "0")
        with patch.object(server, "get_tron_solidified_receipt", return_value={}):
            status, result = self.json_request("POST", "/api/payments/verify-usdt", {
                "campaign_id": 1,
                "amount_usd": "12.5",
                "sender_address": sender,
                "tx_id": "cd" * 32,
            })
            self.assertEqual(status, 202)
            self.assertEqual(result["status"], "pending")

        mismatches = (
            (config["token_bytes"][1:].hex(), "00" * 32, receiver_topic, 12_500_000),
            (config["token_bytes"][1:].hex(), sender_topic, sender_topic, 12_500_000),
            ("00" * 20, sender_topic, receiver_topic, 12_500_000),
            (config["token_bytes"][1:].hex(), sender_topic, receiver_topic, 12_500_001),
        )
        for index, (contract, from_topic, to_topic, units) in enumerate(mismatches, 1):
            tx_id = f"{index:064x}"
            mismatch = {
                "id": tx_id,
                "blockNumber": 12346,
                "receipt": {"result": "SUCCESS"},
                "log": [{
                    "address": contract,
                    "topics": [server.TRON_TRANSFER_TOPIC, from_topic, to_topic],
                    "data": f"{units:064x}",
                }],
            }
            request = {
                "campaign_id": 1,
                "amount_usd": "12.5",
                "sender_address": sender,
                "tx_id": tx_id,
            }
            with self.subTest(mismatch=index), patch.object(
                server, "get_tron_solidified_receipt", return_value=mismatch
            ):
                status, result = self.json_request("POST", "/api/payments/verify-usdt", request)
                self.assertEqual(status, 400)
                self.assertIn("No matching USDT transfer", result["error"])

        failed_tx_id = "ee" * 32
        failed = {
            "id": failed_tx_id,
            "blockNumber": 12347,
            "receipt": {"result": "FAILED"},
            "log": [],
        }
        with patch.object(server, "get_tron_solidified_receipt", return_value=failed):
            status, result = self.json_request("POST", "/api/payments/verify-usdt", {
                "campaign_id": 1,
                "amount_usd": "12.5",
                "sender_address": sender,
                "tx_id": failed_tx_id,
            })
            self.assertEqual(status, 400)
            self.assertIn("did not succeed", result["error"])
        _, ledger = self.json_request("GET", "/api/ledger")
        self.assertFalse(any(row["status"] == "testnet_confirmed" for row in ledger["ledger"]))

    def test_sandbox_payments_never_credit_campaign_totals(self):
        before_status, before = self.json_request("GET", "/api/campaigns/1")
        self.assertEqual(before_status, 200)
        initial = before["campaign"]

        status, result = self.json_request("POST", "/api/payments/verify-usdt", {
            "campaign_id": 1,
            "amount_usd": 12,
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "simulated")
        self.assertIn("no funds moved", result["message"])
        self.assertEqual(
            self.json_request("POST", "/api/payments/verify-usdt", {
                "campaign_id": 1,
                "amount_usd": "1e308",
            })[0],
            400,
        )
        self.assertEqual(
            self.json_request("POST", "/api/payments/verify-naira", {
                "campaign_id": 1,
                "amount_ngn": 5000,
                "donor_name": "x" * 61,
            })[0],
            400,
        )

        status, result_ngn = self.json_request("POST", "/api/payments/verify-naira", {
            "campaign_id": 1,
            "amount_ngn": 5000,
        })
        self.assertEqual(status, 200)
        self.assertEqual(result_ngn["status"], "simulated")

        _, after = self.json_request("GET", "/api/campaigns/1")
        self.assertEqual(after["campaign"]["raised_usd"], initial["raised_usd"])
        self.assertEqual(after["campaign"]["backers_count"], initial["backers_count"])
        self.assertEqual(
            [row["status"] for row in after["campaign"]["contributions"]].count("simulated"),
            2,
        )
        conn = server.get_db()
        stored_hashes = conn.execute(
            "SELECT tx_hash FROM contributions WHERE status = 'simulated'"
        ).fetchall()
        conn.close()
        self.assertEqual(len(stored_hashes), 2)
        self.assertTrue(all(row["tx_hash"] is None for row in stored_hashes))
        self.assertTrue(all("donor_id" not in row and "tx_hash" not in row for row in after["campaign"]["contributions"]))
        _, ledger = self.json_request("GET", "/api/ledger")
        self.assertTrue(any(row["status"] == "simulated" for row in ledger["ledger"]))
        self.assertTrue(all("donor_id" not in row and "tx_hash" not in row and "prev_hash" not in row for row in ledger["ledger"]))
        duplicate, _ = self.json_request("POST", "/api/payments/verify-usdt", {
            "campaign_id": 1,
            "amount_usd": 12,
        })
        self.assertEqual(duplicate, 200)

    def test_ussd_endpoint_is_only_a_non_payable_preview(self):
        status, result = self.json_request("POST", "/api/payments/ussd-initiate", {
            "campaign_id": 1,
            "bank_code": "737",
            "amount_ngn": 500,
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "simulated")
        self.assertIn("No payment was initiated", result["instructions"])
        self.assertEqual(
            self.json_request("POST", "/api/payments/ussd-initiate", {
                "campaign_id": 1,
                "bank_code": "not-a-bank-code",
                "amount_ngn": 500,
            })[0],
            400,
        )

    def test_invalid_inputs_and_disabled_payment_mode_fail_explicitly(self):
        status, _ = self.json_request("POST", "/api/auth/register", {
            "name": 123,
            "email": "bad@example.edu",
            "password": "long-enough-password",
            "role": "donor",
        })
        self.assertEqual(status, 400)
        self.assertEqual(self.request("POST", "/api/auth/login", body=b"not json")[0], 400)
        self.assertEqual(self.request("POST", "/api/auth/login", body=[])[0], 400)

        server.PAYMENTS_MODE = "disabled"
        status, result = self.json_request("POST", "/api/payments/verify-naira", {
            "campaign_id": 1,
            "provider_reference": "not-a-payment",
            "amount_ngn": 5000,
        })
        self.assertEqual(status, 503)
        self.assertIn("No contribution was recorded", result["error"])

    def test_legacy_demo_password_is_upgraded_after_login(self):
        self.login("committee@example.test", "admin123")
        with server.get_db() as conn:
            stored = conn.execute(
                "SELECT password_hash FROM users WHERE email = ?",
                ("committee@example.test",),
            ).fetchone()["password_hash"]
        self.assertTrue(stored.startswith("pbkdf2_sha256$"))

    def test_ledger_hash_chain_verification_endpoint(self):
        status, result = self.json_request("GET", "/api/ledger/verify")
        self.assertEqual(status, 200)
        self.assertTrue(result["valid"])
        self.assertGreaterEqual(result["records_checked"], 1)
        self.assertEqual(result["broken_references"], [])

    def test_withdrawal_and_payout_workflow_with_dual_approval(self):
        # 1. Register student org
        status, reg = self.json_request("POST", "/api/auth/register", {
            "name": "Robotics Lead",
            "email": "lead@robotics.test",
            "password": "strong-password-123",
            "role": "student_org",
            "org_name": "Autonomous Drone Club",
            "campus": "UNIUYO",
        })
        self.assertEqual(status, 201)
        token = reg["token"]

        # 2. Create campaign with destination wallet
        dest_wallet = "TNo8zm9LYgVeJZPyspseugpzFKqqMcJ7jk"
        status, camp = self.json_request("POST", "/api/campaigns", {
            "title": "Quadrotor Telemetry Rig",
            "category": "tech",
            "days": 45,
            "goal_usd": 1500,
            "about": "Procuring carbon arms and telemetry transceivers for campus trials.",
            "wallet_address": dest_wallet,
        }, headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 201)
        camp_id = camp["id"]

        # 3. Admin approves campaign
        admin_token = self.login("committee@example.test", "admin123")
        status, _ = self.json_request("POST", f"/api/admin/campaigns/{camp_id}/review", {
            "action": "approve",
            "notes": "Approved for hackathon finale demo",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(status, 200)

        # 4. Record testnet confirmed contribution to give campaign available funds
        with server.get_db() as conn:
            c = conn.cursor()
            c.execute("""
            INSERT INTO contributions (
                ref, campaign_id, donor_name, amount_usd, amount_ngn,
                currency, channel, status, tx_hash, block_height,
                receipt_hash, prev_hash, created_at
            )
            VALUES (?, ?, 'Demo Backer', 400.0, 600000.0, 'USD', 'USDT_TRC20', 'testnet_confirmed', 'abc123fakehash', 12345, 'hash1', '0'*64, 1700000000)
            """, (f"UF-TEST-{camp_id}", camp_id))
            conn.commit()

        # 5. Check payout summary as student org
        status, summary = self.json_request("GET", f"/api/campaigns/{camp_id}/payout-summary", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 200)
        self.assertEqual(summary["available_testnet_usd"], 400.0)
        self.assertEqual(summary["destination_address"], dest_wallet)

        # 6. Request withdrawal
        status, w_req = self.json_request("POST", "/api/campaigns/withdraw", {
            "campaign_id": camp_id,
            "amount_usd": 250.0,
            "destination_address": dest_wallet,
            "notes": "Components purchase from local electronics supplier",
        }, headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 201)
        self.assertEqual(w_req["status"], "requested")
        wid = w_req["id"]

        # 7. Verify remaining available funds are reduced
        status, summary2 = self.json_request("GET", f"/api/campaigns/{camp_id}/payout-summary", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 200)
        self.assertEqual(summary2["available_testnet_usd"], 150.0)

        # 8. Check admin withdrawals list and approve
        status, admin_w = self.json_request("GET", "/api/admin/withdrawals", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(status, 200)
        self.assertTrue(any(item["id"] == wid for item in admin_w["withdrawals"]))

        status, rev = self.json_request("POST", f"/api/admin/withdrawals/{wid}/review", {
            "action": "approve",
            "notes": "Verified by committee",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(status, 200)
        self.assertEqual(rev["status"], "approved")

        # 9. Complete payout
        status, comp = self.json_request("POST", f"/api/admin/withdrawals/{wid}/review", {
            "action": "complete",
            "notes": "Disbursed via testnet treasury batch",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(status, 200)
        self.assertEqual(comp["status"], "completed")


if __name__ == "__main__":
    unittest.main()
