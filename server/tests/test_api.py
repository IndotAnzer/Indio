from unittest import TestCase

from fastapi.testclient import TestClient

from app.main import create_app


class ApiRoutesTest(TestCase):
    def test_health_and_bootstrap_wire_shape(self) -> None:
        app = create_app()
        with TestClient(app) as client:
            health = client.get("/health")
            bootstrap = client.get("/api/bootstrap")

        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ok"])
        self.assertEqual(bootstrap.status_code, 200)
        self.assertIn("music", bootstrap.json())
        self.assertIn("codexStatus", bootstrap.json())

    def test_websocket_sends_snapshot_event(self) -> None:
        app = create_app()
        with TestClient(app) as client:
            with client.websocket_connect("/ws/radio") as websocket:
                event = websocket.receive_json()

        self.assertIn(event["type"], {"radio.state", "plan.updated"})
