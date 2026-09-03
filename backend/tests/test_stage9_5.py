"""
Stage 9.5 — Pricing intelligence (occupancy forecast, rate correlation,
elasticity, rate recommendations, dedup notifications, webhook hook).

End-to-end tests against the public preview URL.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import date, datetime, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@sourcebench.local"
ADMIN_PASSWORD = "ChangeMe123!"
MGR_EMAIL = "TEST_stage7_mgr@sourcebench.local"
STAFF_EMAIL = "TEST_stage7_staff@sourcebench.local"
TEST_PASSWORD = "TestPass123!"
WEBHOOK_KEY = "rm_dev_secret_change_me_in_prod"

BUCKETS = {"Critical", "Low", "Healthy", "Peak"}
TRENDS = {"up", "stable", "down"}
RECS = {"REDUCE_RATE", "MAINTAIN_RATE", "INCREASE_RATE"}
SEVERITIES = {"critical", "warning", "info", "success", "none"}


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ensure_user(admin_token, email, name, role):
    r = requests.post(f"{API}/users",
                      json={"email": email, "name": name, "role": role,
                            "password": TEST_PASSWORD, "active": True},
                      headers=_h(admin_token), timeout=30)
    if r.status_code in (200, 201):
        return r.json()
    if r.status_code == 409:
        rr = requests.get(f"{API}/users", headers=_h(admin_token), timeout=30)
        for u in rr.json().get("items", []):
            if u.get("email", "").lower() == email.lower():
                requests.put(f"{API}/users/{u['id']}",
                             json={"password": TEST_PASSWORD, "role": role, "active": True},
                             headers=_h(admin_token), timeout=30)
                return u
    pytest.fail(f"could not create {email}: {r.text}")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token(): return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def mgr_token(admin_token):
    _ensure_user(admin_token, MGR_EMAIL, "TEST Mgr", "manager")
    return _login(MGR_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def staff_token(admin_token):
    _ensure_user(admin_token, STAFF_EMAIL, "TEST Staff", "staff")
    return _login(STAFF_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def a_property(admin_token):
    r = requests.get(f"{API}/properties", headers=_h(admin_token), timeout=30)
    items = r.json().get("items") or r.json()
    if isinstance(items, dict):
        items = items.get("items", [])
    if items:
        return items[0]
    r = requests.post(f"{API}/properties",
                      json={"name": f"TEST Prop {uuid.uuid4().hex[:6]}", "active": True},
                      headers=_h(admin_token), timeout=30)
    return r.json()


@pytest.fixture(scope="module")
def seeded_reservation(mgr_token, a_property, admin_token):
    """Create a reservation in the next 30 days so occupancy > 0."""
    ci = date.today() + timedelta(days=5)
    co = ci + timedelta(days=4)
    payload = {
        "event_type": "Reservation Initialization",
        "reservation_id": f"TEST-S95-{uuid.uuid4().hex[:8]}",
        "property_name": a_property["name"],
        "guest_name": "TEST Stage9.5 Guest",
        "guest_email": "s95@example.com",
        "check_in": ci.isoformat(), "check_out": co.isoformat(),
        "booking_source": "Airbnb", "total_value": 800, "status": "Confirmed",
    }
    r = requests.post(f"{API}/roommaster/webhook", json=payload,
                      headers={"X-RoomMaster-API-Key": WEBHOOK_KEY}, timeout=30)
    assert r.status_code == 200, r.text
    return {"ci": ci.isoformat(), "co": co.isoformat(), "property_id": a_property["id"]}


# =====================================================================
# 1. Occupancy forecast
# =====================================================================
class TestOccupancyForecast:
    def test_staff_forbidden(self, staff_token):
        r = requests.get(f"{API}/pricing/occupancy-forecast", headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_refresh_all(self, mgr_token):
        r = requests.post(f"{API}/pricing/occupancy-forecast/refresh",
                          headers=_h(mgr_token), timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "properties" in d and "cells_written" in d

    def test_refresh_single_property(self, mgr_token, a_property):
        r = requests.post(f"{API}/pricing/occupancy-forecast/refresh?property_id={a_property['id']}",
                          headers=_h(mgr_token), timeout=60)
        assert r.status_code == 200
        assert r.json()["properties"] == 1

    def test_get_shape(self, mgr_token, seeded_reservation):
        # refresh so seeded reservation is reflected
        requests.post(f"{API}/pricing/occupancy-forecast/refresh?property_id={seeded_reservation['property_id']}",
                      headers=_h(mgr_token), timeout=60)
        r = requests.get(f"{API}/pricing/occupancy-forecast",
                         headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["days_ahead"] == 30
        assert "items" in d and "summary" in d
        assert isinstance(d["items"], list) and len(d["items"]) > 0
        it = d["items"][0]
        for k in ("property_id", "date", "occupancy_pct", "occupancy_bucket",
                  "reserved_count", "available_count", "max_occupancy",
                  "confidence_score", "trend"):
            assert k in it, f"missing {k}"
        assert it["occupancy_bucket"] in BUCKETS
        assert it["trend"] in TRENDS
        assert it["max_occupancy"] == 7
        # summary keys
        s = d["summary"]
        for k in ("avg_next_7_days", "peak_date", "peak_pct", "critical_count"):
            assert k in s

    def test_bucket_mapping(self, mgr_token):
        r = requests.get(f"{API}/pricing/occupancy-forecast", headers=_h(mgr_token), timeout=30)
        for it in r.json()["items"]:
            pct = it["occupancy_pct"]
            b = it["occupancy_bucket"]
            if pct < 30: assert b == "Critical"
            elif pct < 50: assert b == "Low"
            elif pct < 80: assert b == "Healthy"
            else: assert b == "Peak"

    def test_reservation_reflected_in_forecast(self, mgr_token, seeded_reservation):
        # The seeded reservation runs 5 days; centred 7-day window should show >0 occ near check-in
        r = requests.get(f"{API}/pricing/occupancy-forecast?property_id={seeded_reservation['property_id']}",
                         headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        # Some item should reflect reserved_count > 0 near the check-in date
        assert any(it["reserved_count"] > 0 for it in items), "seeded reservation not reflected"


# =====================================================================
# 2. Rate correlation & elasticity summary
# =====================================================================
class TestRateCorrelation:
    def test_staff_forbidden(self, staff_token):
        r = requests.get(f"{API}/pricing/rate-correlation", headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_refresh(self, mgr_token):
        r = requests.post(f"{API}/pricing/rate-correlation/refresh", headers=_h(mgr_token), timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert "properties" in d and "weeks_written" in d

    def test_get_correlation_shape(self, mgr_token, a_property):
        r = requests.get(f"{API}/pricing/rate-correlation?property_id={a_property['id']}",
                         headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        if items:
            it = items[0]
            for k in ("year", "week", "date_start", "date_end", "avg_nightly_rate",
                      "occupancy_pct", "booking_count", "season", "ota_pct",
                      "direct_pct", "was_promotional", "elasticity_score"):
                assert k in it, f"missing {k}"
            # elasticity constant across the property's rows
            scores = {r["elasticity_score"] for r in items}
            assert len(scores) == 1

    def test_elasticity_summary(self, mgr_token):
        r = requests.get(f"{API}/pricing/elasticity-summary", headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        if items:
            for k in ("property_id", "property_name", "elasticity_score",
                      "confidence", "best_season", "best_season_avg_rate",
                      "total_weeks_analyzed"):
                assert k in items[0]


# =====================================================================
# 3. Rate recommendations
# =====================================================================
class TestRateRecommendations:
    def test_staff_forbidden(self, staff_token):
        r = requests.get(f"{API}/pricing/recommendations", headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_refresh_chain(self, mgr_token):
        r = requests.post(f"{API}/pricing/recommendations/refresh", headers=_h(mgr_token), timeout=90)
        assert r.status_code == 200
        d = r.json()
        for k in ("properties", "recommendations_written", "alerts_emitted"):
            assert k in d

    def test_get_shape(self, mgr_token):
        r = requests.get(f"{API}/pricing/recommendations", headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "summary" in d
        assert isinstance(d["items"], list) and len(d["items"]) > 0
        it = d["items"][0]
        for k in ("property_id", "date", "current_rate", "recommendation",
                  "suggested_rate", "adjustment_pct", "occupancy_forecast",
                  "occupancy_bucket", "elasticity_score", "reasoning",
                  "confidence", "alert_severity", "alert_message", "dismissed"):
            assert k in it, f"missing {k}"
        assert it["recommendation"] in RECS
        assert it["alert_severity"] in SEVERITIES

    def test_decision_tree(self, mgr_token):
        r = requests.get(f"{API}/pricing/recommendations", headers=_h(mgr_token), timeout=30)
        for it in r.json()["items"]:
            occ = it["occupancy_forecast"]
            rec = it["recommendation"]
            sev = it["alert_severity"]
            if occ < 30:
                assert rec == "REDUCE_RATE" and sev == "critical"
            elif occ < 50:
                assert rec == "REDUCE_RATE" and sev == "warning"
            elif occ < 80:
                assert rec == "MAINTAIN_RATE" and sev == "info"
            else:
                assert rec == "INCREASE_RATE" and sev == "success"

    def test_include_dismissed_flag(self, mgr_token):
        # first dismiss one
        r = requests.get(f"{API}/pricing/recommendations", headers=_h(mgr_token), timeout=30)
        items = r.json()["items"]
        if not items:
            pytest.skip("no recs")
        rec_id = items[0]["id"] if "id" in items[0] else None
        # get id from get_recommendations projection (we didn't include id, but service adds it)
        # Fall back to no-id path if needed
        if not rec_id:
            pytest.skip("no id returned in rec")
        rd = requests.post(f"{API}/pricing/recommendations/{rec_id}/dismiss",
                           headers=_h(mgr_token), timeout=30)
        assert rd.status_code == 200
        # default (dismissed excluded)
        r1 = requests.get(f"{API}/pricing/recommendations", headers=_h(mgr_token), timeout=30)
        ids1 = [x.get("id") for x in r1.json()["items"]]
        assert rec_id not in ids1
        # include
        r2 = requests.get(f"{API}/pricing/recommendations?include_dismissed=true",
                          headers=_h(mgr_token), timeout=30)
        ids2 = [x.get("id") for x in r2.json()["items"]]
        assert rec_id in ids2

    def test_apply_requires_base_rate(self, mgr_token):
        # find a rec whose date has no pricing_calendar cell
        r = requests.get(f"{API}/pricing/recommendations?include_dismissed=true",
                         headers=_h(mgr_token), timeout=30)
        recs = r.json()["items"]
        # try one with current_rate==0 → no base
        target = next((x for x in recs if not x.get("current_rate")), None)
        if not target:
            pytest.skip("no rec without base rate")
        r = requests.post(f"{API}/pricing/recommendations/{target['id']}/apply",
                          headers=_h(mgr_token), timeout=30)
        assert r.status_code == 400
        assert "base rate" in r.text.lower()

    def test_apply_success(self, mgr_token, a_property):
        # Set a pricing cell first for a date within the 30-day forecast
        d = (date.today() + timedelta(days=10)).isoformat()
        pr = requests.put(f"{API}/pricing/{a_property['id']}/{d}",
                          json={"base_nightly_rate": 200, "multiplier": 1.0},
                          headers=_h(mgr_token), timeout=30)
        assert pr.status_code == 200
        # rebuild recs
        rr = requests.post(f"{API}/pricing/recommendations/refresh",
                           headers=_h(mgr_token), timeout=90)
        assert rr.status_code == 200
        # find target rec (property + date, include dismissed to be safe)
        r = requests.get(f"{API}/pricing/recommendations?include_dismissed=true",
                         headers=_h(mgr_token), timeout=30)
        target = next((x for x in r.json()["items"]
                       if x["property_id"] == a_property["id"] and x["date"] == d), None)
        if not target:
            pytest.skip("target rec not present")
        ra = requests.post(f"{API}/pricing/recommendations/{target['id']}/apply",
                           headers=_h(mgr_token), timeout=30)
        assert ra.status_code == 200, ra.text
        body = ra.json()
        assert body["ok"] is True
        assert "new_final_rate" in body and "multiplier" in body


# =====================================================================
# 4. Notification dedup on refresh
# =====================================================================
class TestNotificationsDedup:
    def test_refresh_dedups_per_property(self, mgr_token):
        # trigger refresh twice; second call should not add extra notifications
        r1 = requests.post(f"{API}/pricing/recommendations/refresh",
                           headers=_h(mgr_token), timeout=90)
        assert r1.status_code == 200
        emitted1 = r1.json()["alerts_emitted"]
        r2 = requests.post(f"{API}/pricing/recommendations/refresh",
                           headers=_h(mgr_token), timeout=90)
        assert r2.status_code == 200
        # second call should emit 0 new
        assert r2.json()["alerts_emitted"] == 0, "dedup key not enforced"


# =====================================================================
# 5. Webhook triggers forecast/rec refresh
# =====================================================================
class TestWebhookRefresh:
    def test_new_reservation_updates_forecast(self, mgr_token, a_property):
        # Use a check-in far enough out that earlier tests haven't seeded overlapping nights.
        ci = date.today() + timedelta(days=25)
        co = ci + timedelta(days=2)
        # before
        r0 = requests.get(f"{API}/pricing/occupancy-forecast?property_id={a_property['id']}",
                          headers=_h(mgr_token), timeout=30)
        before = {it["date"]: it["reserved_count"] for it in r0.json()["items"]}
        payload = {
            "event_type": "Reservation Initialization",
            "reservation_id": f"TEST-WH-{uuid.uuid4().hex[:6]}",
            "property_name": a_property["name"],
            "guest_name": "TEST WH", "guest_email": "wh@example.com",
            "check_in": ci.isoformat(), "check_out": co.isoformat(),
            "booking_source": "Direct", "total_value": 400, "status": "Confirmed",
        }
        rw = requests.post(f"{API}/roommaster/webhook", json=payload,
                           headers={"X-RoomMaster-API-Key": WEBHOOK_KEY}, timeout=60)
        assert rw.status_code == 200
        time.sleep(1.5)
        r1 = requests.get(f"{API}/pricing/occupancy-forecast?property_id={a_property['id']}",
                          headers=_h(mgr_token), timeout=30)
        after = {it["date"]: it["reserved_count"] for it in r1.json()["items"]}
        # Single-unit STRs: booked dates are unique per property. The new booking should
        # push the reserved_count for ci strictly above `before` (which starts at 0 here).
        assert after.get(ci.isoformat(), 0) >= before.get(ci.isoformat(), 0) + 1


# =====================================================================
# 6. RBAC parametrized
# =====================================================================
class TestRBAC:
    @pytest.mark.parametrize("path", [
        "/pricing/occupancy-forecast",
        "/pricing/rate-correlation",
        "/pricing/elasticity-summary",
        "/pricing/recommendations",
    ])
    def test_staff_forbidden(self, staff_token, path):
        r = requests.get(f"{API}{path}", headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    @pytest.mark.parametrize("path", [
        "/pricing/occupancy-forecast",
        "/pricing/rate-correlation",
        "/pricing/elasticity-summary",
        "/pricing/recommendations",
    ])
    def test_manager_allowed(self, mgr_token, path):
        r = requests.get(f"{API}{path}", headers=_h(mgr_token), timeout=30)
        assert r.status_code == 200
