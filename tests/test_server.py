import hashlib
import http.client
import json
import os
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer

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
        self.assertEqual(self.json_request("GET", "/api/health")[1]["database"], "connected")
        self.assertEqual(self.json_request("GET", "/api/exchange-rate")[0], 200)
        self.assertEqual(self.json_request("GET", "/api/campaigns")[0], 200)
        self.assertEqual(self.json_request("GET", "/api/ledger")[0], 200)
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/index.html")[0], 200)
        self.assertEqual(self.request("GET", "/unifund.db")[0], 404)
        self.assertEqual(self.request("GET", "/server.py")[0], 404)

    def test_donor_session_history_and_logout(self):
        status, user = self.json_request("POST", "/api/auth/register", {
            "name": "Demo Backer",
            "email": "backer@example.edu",
            "password": "strong-password-123",
            "role": "donor",
        })
        self.assertEqual(status, 201)
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

    def test_registration_campaign_review_and_spending_workflow(self):
        status, new_user = self.json_request("POST", "/api/auth/register", {
            "name": "Student Lead",
            "email": "lead@example.edu",
            "password": "strong-password-123",
            "role": "student_org",
            "org_name": "Campus Makers",
            "campus": "UNIUYO",
            "matric_number": "ENG/22/0123",
        })
        self.assertEqual(status, 201)
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
        self.assertEqual(campaign["status"], "pending")
        self.assertEqual(self.json_request("GET", f"/api/campaigns/{campaign_id}")[0], 404)

        admin_headers = {
            "Authorization": f"Bearer {self.login('admin@unifund.org', 'admin123')}"
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
        status, detail = self.json_request("GET", f"/api/campaigns/{campaign_id}")
        self.assertEqual(status, 200)
        self.assertEqual(len(detail["campaign"]["spending_reports"]), 1)

    def test_sandbox_payments_never_credit_campaign_totals(self):
        tx_hash = hashlib.sha256(b"demo tx").hexdigest()
        before_status, before = self.json_request("GET", "/api/campaigns/1")
        self.assertEqual(before_status, 200)
        initial = before["campaign"]

        status, result = self.json_request("POST", "/api/payments/verify-usdt", {
            "campaign_id": 1,
            "tx_hash": tx_hash,
            "amount_usd": 12,
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "simulated")
        self.assertIn("no funds moved", result["message"])

        status, result_ngn = self.json_request("POST", "/api/payments/verify-naira", {
            "campaign_id": 1,
            "provider_reference": "demo-reference-001",
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
        _, ledger = self.json_request("GET", "/api/ledger")
        self.assertTrue(any(row["status"] == "simulated" for row in ledger["ledger"]))

        duplicate, _ = self.json_request("POST", "/api/payments/verify-usdt", {
            "campaign_id": 1,
            "tx_hash": tx_hash,
            "amount_usd": 12,
        })
        self.assertEqual(duplicate, 400)

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
        self.login("admin@unifund.org", "admin123")
        with server.get_db() as conn:
            stored = conn.execute(
                "SELECT password_hash FROM users WHERE email = ?",
                ("admin@unifund.org",),
            ).fetchone()["password_hash"]
        self.assertTrue(stored.startswith("pbkdf2_sha256$"))


if __name__ == "__main__":
    unittest.main()
