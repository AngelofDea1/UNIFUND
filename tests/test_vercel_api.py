import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.requests import Request

import app as vercel_entrypoint
import server
import vercel_app


class VercelAPIAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_file = server.DB_FILE
        self.original_database_url = server.DATABASE_URL
        server.DB_FILE = os.path.join(self.tempdir.name, "test.db")
        server.DATABASE_URL = ""
        vercel_app.database_initialized = False

    def tearDown(self):
        server.DB_FILE = self.original_db_file
        server.DATABASE_URL = self.original_database_url
        vercel_app.database_initialized = False
        self.tempdir.cleanup()

    def request(self, method, path, body=None, headers=None):
        raw_body = json.dumps(body).encode() if body is not None else b""
        request_headers = [(b"content-length", str(len(raw_body)).encode())]
        if body is not None:
            request_headers.append((b"content-type", b"application/json"))
        for key, value in (headers or {}).items():
            request_headers.append((key.lower().encode(), value.encode()))
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path.split("?", 1)[0],
            "raw_path": path.split("?", 1)[0].encode(),
            "query_string": path.split("?", 1)[1].encode() if "?" in path else b"",
            "root_path": "",
            "headers": request_headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        }
        delivered = False

        async def receive():
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": raw_body, "more_body": False}

        async def invoke():
            request = Request(scope, receive)
            return await vercel_app.dispatch_api(path, request)

        response = asyncio.run(invoke())
        payload = json.loads(response.body) if response.body else {}
        return response.status_code, payload

    def test_api_adapter_runs_login_campaign_review_and_contributions(self):
        status, health = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["database"], "connected")

        status, admin = self.request(
            "POST",
            "/api/auth/login",
            {"email": "committee@example.test", "password": "admin123"},
        )
        self.assertEqual(status, 200)
        admin_headers = {"Authorization": f"Bearer {admin['token']}"}

        status, organization = self.request(
            "POST",
            "/api/auth/register",
            {
                "name": "Demo Lead",
                "email": "lead@example.edu",
                "password": "secure-password-123",
                "role": "student_org",
                "org_name": "Campus Lab",
                "campus": "UNIUYO",
            },
        )
        self.assertEqual(status, 201)
        organization_headers = {"Authorization": f"Bearer {organization['token']}"}

        status, campaign = self.request(
            "POST",
            "/api/campaigns",
            {
                "title": "Campus Weather Station",
                "category": "tech",
                "goal_usd": 500,
                "days": 30,
                "about": "Build a weather station for student research.",
            },
            organization_headers,
        )
        self.assertEqual(status, 201)
        self.assertEqual(campaign["status"], "approved")

        status, _ = self.request(
            "POST",
            f"/api/admin/campaigns/{campaign['id']}/review",
            {"action": "approve"},
            admin_headers,
        )
        self.assertEqual(status, 200)

        status, contribution = self.request(
            "POST",
            "/api/payments/verify-naira",
            {
                "campaign_id": campaign["id"],
                "provider_reference": "demo-reference-101",
                "amount_ngn": 5000,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(contribution["status"], "simulated")

    def test_vercel_reports_missing_database_instead_of_fake_auth_error(self):
        with patch.dict(os.environ, {"VERCEL": "1"}):
            status, result = self.request("GET", "/api/health")
        self.assertEqual(status, 503)
        self.assertIn("DATABASE_URL", result["error"])

    def test_root_entrypoint_routes_api_requests_to_fastapi(self):
        response = TestClient(vercel_entrypoint.app).get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "connected")
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        for path in ("/campaigns", "/c/3", "/privacy"):
            self.assertEqual(TestClient(vercel_entrypoint.app).get(path).status_code, 200)

    def test_demo_content_seeds_after_an_admin_already_exists(self):
        original_seed_setting = server.SEED_DEMO_DATA
        try:
            server.SEED_DEMO_DATA = False
            server.init_db()
            conn = server.get_db()
            conn.execute(
                """
                INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
                VALUES (?, ?, ?, ?, 'admin', 1, ?)
                """,
                ("existing-admin", "admin@example.org", "hash", "Admin", 1),
            )
            conn.commit()
            conn.close()

            server.SEED_DEMO_DATA = True
            server.init_db()
            conn = server.get_db()
            user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            campaign_count = conn.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0]
            conn.close()

            self.assertEqual(user_count, 1)
            self.assertEqual(campaign_count, 27)
        finally:
            server.SEED_DEMO_DATA = original_seed_setting


if __name__ == "__main__":
    unittest.main()
