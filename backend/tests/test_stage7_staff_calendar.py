"""
Stage 7 — Staff Calendar + Hours + iCal + Team Noticeboard
End-to-end backend tests hitting the public preview URL.

Covers:
  - Announcements CRUD + dismiss + RBAC
  - Shifts CRUD + RBAC + staff visibility scoping
  - Time off create/approve/decline + reason validation + staff-self scope
  - Hours draft/submit/approve/reject flow + summary + CSV export
  - iCal info + individual + team feed + admin-only token rotation
  - Staff profile aggregation
  - Regression sweep of Stage 1–6E endpoints
"""
from __future__ import annotations

import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://str-analytics-core.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@sourcebench.local"
ADMIN_PASSWORD = "ChangeMe123!"

MGR_EMAIL = "TEST_stage7_mgr@sourcebench.local"
STAFF_EMAIL = "TEST_stage7_staff@sourcebench.local"
STAFF_EMAIL_2 = "TEST_stage7_staff2@sourcebench.local"
TEST_PASSWORD = "TestPass123!"


# ---------------- helpers ----------------

def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ensure_user(admin_token: str, email: str, name: str, role: str) -> dict:
    # Try to create; if 409, get from users list
    r = requests.post(
        f"{API}/users",
        json={"email": email, "name": name, "role": role, "password": TEST_PASSWORD, "active": True},
        headers=_h(admin_token),
        timeout=30,
    )
    if r.status_code == 200 or r.status_code == 201:
        return r.json()
    if r.status_code == 409:
        # find user via /users assignable listing (admin can see all)
        rr = requests.get(f"{API}/users", headers=_h(admin_token), timeout=30)
        assert rr.status_code == 200, rr.text
        for u in rr.json().get("items", []):
            if u.get("email", "").lower() == email.lower():
                # Reset password so tests can log in
                requests.put(
                    f"{API}/users/{u['id']}",
                    json={"password": TEST_PASSWORD, "role": role, "active": True},
                    headers=_h(admin_token),
                    timeout=30,
                )
                return u
    pytest.fail(f"Could not create/find user {email}: {r.status_code} {r.text}")


# ---------------- fixtures ----------------

@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def admin_me(admin_token):
    r = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def manager_user(admin_token):
    return _ensure_user(admin_token, MGR_EMAIL, "TEST Stage7 Manager", "manager")


@pytest.fixture(scope="module")
def staff_user(admin_token):
    return _ensure_user(admin_token, STAFF_EMAIL, "TEST Stage7 Staff", "staff")


@pytest.fixture(scope="module")
def staff2_user(admin_token):
    return _ensure_user(admin_token, STAFF_EMAIL_2, "TEST Stage7 Staff2", "staff")


@pytest.fixture(scope="module")
def manager_token(manager_user):
    return _login(MGR_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def staff_token(staff_user):
    return _login(STAFF_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def staff2_token(staff2_user):
    return _login(STAFF_EMAIL_2, TEST_PASSWORD)


# ==================================================================
# 1. Auth sanity
# ==================================================================
class TestAuth:
    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and isinstance(d["token"], str) and len(d["token"]) > 10
        assert d["user"]["email"] == ADMIN_EMAIL
        assert d["user"]["role"] == "admin"

    def test_auth_me_admin(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


# ==================================================================
# 2. Announcements
# ==================================================================
class TestAnnouncements:
    _created_ids: list = []

    def test_list_authenticated(self, admin_token):
        r = requests.get(f"{API}/announcements", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        assert "unread_count" in d

    def test_create_normal_and_urgent_as_manager(self, manager_token):
        for prio, title in [("Normal", f"TEST_ann_normal_{uuid.uuid4().hex[:6]}"),
                            ("Urgent", f"TEST_ann_urgent_{uuid.uuid4().hex[:6]}")]:
            r = requests.post(f"{API}/announcements",
                              json={"title": title, "body": f"body for {prio}", "priority": prio},
                              headers=_h(manager_token), timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["title"] == title
            assert d["priority"] == prio
            assert "id" in d
            assert d["dismissed_by"] == []
            TestAnnouncements._created_ids.append(d["id"])

    def test_urgent_sorted_first(self, admin_token):
        r = requests.get(f"{API}/announcements", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        # Find our two test announcements
        ours = [a for a in items if a["id"] in TestAnnouncements._created_ids]
        assert len(ours) == 2
        # First one in our subset should be Urgent (Urgents come first)
        # Verify order in the full list too: our urgent index < our normal index
        idx_urgent = next(i for i, a in enumerate(items) if a in ours and a["priority"] == "Urgent")
        idx_normal = next(i for i, a in enumerate(items) if a in ours and a["priority"] == "Normal")
        assert idx_urgent < idx_normal

    def test_dismiss_adds_current_user(self, staff_token, staff_user):
        assert TestAnnouncements._created_ids, "no created announcements"
        aid = TestAnnouncements._created_ids[0]
        r = requests.post(f"{API}/announcements/{aid}/dismiss",
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        # Verify dismissed_by contains staff user id
        r2 = requests.get(f"{API}/announcements", headers=_h(staff_token), timeout=30)
        assert r2.status_code == 200
        item = next(a for a in r2.json()["items"] if a["id"] == aid)
        assert staff_user["id"] in item["dismissed_by"]

    def test_staff_cannot_create(self, staff_token):
        r = requests.post(f"{API}/announcements",
                          json={"title": "TEST_denied", "body": "x", "priority": "Normal"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_staff_cannot_delete(self, staff_token):
        aid = TestAnnouncements._created_ids[0]
        r = requests.delete(f"{API}/announcements/{aid}", headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_manager_can_delete(self, manager_token):
        # Delete both created announcements
        for aid in TestAnnouncements._created_ids:
            r = requests.delete(f"{API}/announcements/{aid}", headers=_h(manager_token), timeout=30)
            assert r.status_code == 200, r.text
        TestAnnouncements._created_ids.clear()

    def test_delete_missing_returns_404(self, manager_token):
        r = requests.delete(f"{API}/announcements/does-not-exist",
                            headers=_h(manager_token), timeout=30)
        assert r.status_code == 404


# ==================================================================
# 3. Shifts
# ==================================================================
class TestShifts:
    _created_ids: list = []

    def test_create_shift_as_manager(self, manager_token, staff_user):
        today = date.today().isoformat()
        payload = {"staff_member_id": staff_user["id"], "date": today,
                   "shift_type": "Work Day", "start_time": "09:00", "end_time": "17:00",
                   "notes": "TEST_shift"}
        r = requests.post(f"{API}/staff/shifts", json=payload,
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["staff_member_id"] == staff_user["id"]
        assert d["date"] == today
        assert d["shift_type"] == "Work Day"
        assert "id" in d
        TestShifts._created_ids.append(d["id"])

    def test_list_shifts_in_range(self, admin_token):
        today = date.today()
        start = (today - timedelta(days=7)).isoformat()
        end = (today + timedelta(days=7)).isoformat()
        r = requests.get(f"{API}/staff/shifts", params={"start": start, "end": end},
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(s["id"] in TestShifts._created_ids for s in items)

    def test_update_shift(self, manager_token, staff_user):
        sid = TestShifts._created_ids[0]
        today = date.today().isoformat()
        r = requests.put(f"{API}/staff/shifts/{sid}",
                         json={"staff_member_id": staff_user["id"], "date": today,
                               "shift_type": "Training", "start_time": "10:00",
                               "end_time": "16:00", "notes": "TEST_updated"},
                         headers=_h(manager_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["shift_type"] == "Training"
        assert r.json()["notes"] == "TEST_updated"

    def test_staff_can_only_see_own_shifts(self, staff2_token, staff_user):
        # staff2 shouldn't see the shift assigned to staff_user
        r = requests.get(f"{API}/staff/shifts", headers=_h(staff2_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        for s in items:
            assert s["staff_member_id"] != staff_user["id"]

    def test_staff_cannot_create_shift(self, staff_token, staff_user):
        r = requests.post(f"{API}/staff/shifts",
                          json={"staff_member_id": staff_user["id"], "date": date.today().isoformat(),
                                "shift_type": "Work Day", "start_time": "09:00", "end_time": "17:00"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_delete_shift(self, manager_token):
        for sid in TestShifts._created_ids:
            r = requests.delete(f"{API}/staff/shifts/{sid}",
                                headers=_h(manager_token), timeout=30)
            assert r.status_code == 200
        TestShifts._created_ids.clear()


# ==================================================================
# 4. Time off
# ==================================================================
class TestTimeOff:
    _created_ids: list = []

    def test_staff_creates_own_timeoff(self, staff_token, staff_user):
        start = (date.today() + timedelta(days=10)).isoformat()
        end = (date.today() + timedelta(days=12)).isoformat()
        r = requests.post(f"{API}/staff/time-off",
                          json={"staff_member_id": staff_user["id"], "start_date": start,
                                "end_date": end, "leave_type": "Annual Leave",
                                "notes": "TEST_timeoff"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["staff_member_id"] == staff_user["id"]
        assert d["status"] == "Pending"
        assert d["leave_type"] == "Annual Leave"
        TestTimeOff._created_ids.append(d["id"])

    def test_staff_cannot_submit_for_other(self, staff_token, staff2_user, staff_user):
        # Server forces target=actor.id when staff, so it should silently create for self.
        start = (date.today() + timedelta(days=20)).isoformat()
        r = requests.post(f"{API}/staff/time-off",
                          json={"staff_member_id": staff2_user["id"], "start_date": start,
                                "leave_type": "Sick Leave"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        # Should have been reassigned to the staff user (actor.id)
        assert r.json()["staff_member_id"] == staff_user["id"]
        TestTimeOff._created_ids.append(r.json()["id"])

    def test_manager_approves(self, manager_token):
        tid = TestTimeOff._created_ids[0]
        r = requests.post(f"{API}/staff/time-off/{tid}/approve",
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "Approved"

    def test_decline_requires_reason(self, manager_token):
        tid = TestTimeOff._created_ids[1]
        # Empty reason -> 400
        r = requests.post(f"{API}/staff/time-off/{tid}/decline",
                          json={"reason": ""},
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 400
        # With reason -> 200
        r = requests.post(f"{API}/staff/time-off/{tid}/decline",
                          json={"reason": "TEST_conflict with schedule"},
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "Declined"
        assert r.json()["decline_reason"] == "TEST_conflict with schedule"

    def test_staff_cannot_approve(self, staff_token):
        # create one to try to approve
        tid = TestTimeOff._created_ids[0]
        r = requests.post(f"{API}/staff/time-off/{tid}/approve",
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_cleanup_timeoff(self, admin_token):
        for tid in TestTimeOff._created_ids:
            requests.delete(f"{API}/staff/time-off/{tid}", headers=_h(admin_token), timeout=30)


# ==================================================================
# 5. Hours
# ==================================================================
class TestHours:
    _created_ids: list = []

    def test_create_draft_as_staff(self, staff_token, staff_user):
        today = date.today().isoformat()
        r = requests.post(f"{API}/staff/hours",
                          json={"date": today, "clock_in_time": "09:00",
                                "clock_out_time": "17:00", "notes": "TEST_hours_1"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["staff_member_id"] == staff_user["id"]
        assert d["status"] == "Draft"
        assert d["total_hours"] == 8.0
        TestHours._created_ids.append(d["id"])

    def test_submit_moves_to_submitted(self, staff_token):
        hid = TestHours._created_ids[0]
        r = requests.post(f"{API}/staff/hours/{hid}/submit",
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "Submitted"

    def test_approve_as_manager(self, manager_token):
        hid = TestHours._created_ids[0]
        r = requests.post(f"{API}/staff/hours/{hid}/approve",
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "Approved"

    def test_reject_requires_reason(self, staff_token, manager_token):
        # Create a fresh draft to reject
        r = requests.post(f"{API}/staff/hours",
                          json={"date": date.today().isoformat(),
                                "clock_in_time": "10:00", "clock_out_time": "14:00",
                                "notes": "TEST_hours_reject"},
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        hid = r.json()["id"]
        TestHours._created_ids.append(hid)
        # empty reason -> 400
        rr = requests.post(f"{API}/staff/hours/{hid}/reject", json={"reason": ""},
                           headers=_h(manager_token), timeout=30)
        assert rr.status_code == 400
        rr = requests.post(f"{API}/staff/hours/{hid}/reject",
                           json={"reason": "TEST_missing lunch break"},
                           headers=_h(manager_token), timeout=30)
        assert rr.status_code == 200
        assert rr.json()["status"] == "Rejected"

    def test_staff_cannot_approve(self, staff_token):
        hid = TestHours._created_ids[0]
        r = requests.post(f"{API}/staff/hours/{hid}/approve",
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 403

    def test_summary_manager_only(self, manager_token, staff_token, staff_user):
        r = requests.get(f"{API}/staff/hours/summary",
                         headers=_h(manager_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "by_staff" in d and "by_property" in d and "grand_total" in d
        # Our approved staff hours (8h) should appear
        entry = next((s for s in d["by_staff"] if s["staff_member_id"] == staff_user["id"]), None)
        assert entry is not None, f"staff not in summary: {d}"
        assert entry["total_hours"] >= 8.0
        # Staff cannot access summary
        r2 = requests.get(f"{API}/staff/hours/summary",
                          headers=_h(staff_token), timeout=30)
        assert r2.status_code == 403

    def test_export_csv(self, manager_token):
        r = requests.get(f"{API}/staff/hours/export.csv",
                         headers=_h(manager_token), timeout=30)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "") or "text/plain" in r.headers.get("content-type", "")
        # Header row present
        assert "staff_name" in r.text
        assert "total_hours" in r.text

    def test_cleanup(self, admin_token):
        for hid in TestHours._created_ids:
            requests.delete(f"{API}/staff/hours/{hid}", headers=_h(admin_token), timeout=30)


# ==================================================================
# 6. iCal
# ==================================================================
class TestICal:
    def test_ical_info_admin(self, admin_token, staff_user):
        r = requests.get(f"{API}/staff/{staff_user['id']}/ical-info",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and len(d["token"]) > 10
        assert "path" in d

    def test_individual_ical_feed(self, admin_token, staff_user):
        info = requests.get(f"{API}/staff/{staff_user['id']}/ical-info",
                            headers=_h(admin_token), timeout=30).json()
        token = info["token"]
        r = requests.get(f"{API}/staff/{staff_user['id']}/ical",
                         params={"token": token}, timeout=30)
        assert r.status_code == 200
        assert "text/calendar" in r.headers.get("content-type", "")
        assert "BEGIN:VCALENDAR" in r.text
        assert "END:VCALENDAR" in r.text

    def test_ical_bad_token_403(self, staff_user):
        r = requests.get(f"{API}/staff/{staff_user['id']}/ical",
                         params={"token": "wrong-token"}, timeout=30)
        assert r.status_code == 403

    def test_team_ical(self, manager_token):
        info = requests.get(f"{API}/staff/team/ical-info",
                            headers=_h(manager_token), timeout=30)
        assert info.status_code == 200
        token = info.json()["token"]
        r = requests.get(f"{API}/staff/team/ical", params={"token": token}, timeout=30)
        assert r.status_code == 200
        assert "BEGIN:VCALENDAR" in r.text

    def test_rotate_token_admin_only(self, admin_token, manager_token, staff_token, staff_user):
        # Get current token
        info = requests.get(f"{API}/staff/{staff_user['id']}/ical-info",
                            headers=_h(admin_token), timeout=30).json()
        old_token = info["token"]
        # Manager cannot rotate
        r = requests.post(f"{API}/staff/{staff_user['id']}/rotate-ical-token",
                          headers=_h(manager_token), timeout=30)
        assert r.status_code == 403
        # Staff cannot rotate
        r = requests.post(f"{API}/staff/{staff_user['id']}/rotate-ical-token",
                          headers=_h(staff_token), timeout=30)
        assert r.status_code == 403
        # Admin can
        r = requests.post(f"{API}/staff/{staff_user['id']}/rotate-ical-token",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        new_token = r.json()["token"]
        assert new_token != old_token
        # Old token no longer works
        rr = requests.get(f"{API}/staff/{staff_user['id']}/ical",
                          params={"token": old_token}, timeout=30)
        assert rr.status_code == 403
        # New token works
        rr = requests.get(f"{API}/staff/{staff_user['id']}/ical",
                          params={"token": new_token}, timeout=30)
        assert rr.status_code == 200


# ==================================================================
# 7. Staff profile
# ==================================================================
class TestStaffProfile:
    def test_profile_returns_shape(self, admin_token, staff_user):
        r = requests.get(f"{API}/staff/{staff_user['id']}/profile",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["user", "month_hours_approved", "open_tasks_count",
                    "shifts_this_week", "assigned_property_names", "pending_timeoff"]:
            assert key in d, f"missing key: {key}"
        assert d["user"]["id"] == staff_user["id"]
        assert isinstance(d["shifts_this_week"], list)
        assert isinstance(d["assigned_property_names"], list)
        assert isinstance(d["pending_timeoff"], list)
        assert isinstance(d["month_hours_approved"], (int, float))
        assert isinstance(d["open_tasks_count"], int)

    def test_staff_can_view_own_profile(self, staff_token, staff_user):
        r = requests.get(f"{API}/staff/{staff_user['id']}/profile",
                         headers=_h(staff_token), timeout=30)
        assert r.status_code == 200

    def test_staff_cannot_view_others(self, staff_token, staff2_user):
        r = requests.get(f"{API}/staff/{staff2_user['id']}/profile",
                         headers=_h(staff_token), timeout=30)
        assert r.status_code == 403


# ==================================================================
# 8. Regression sweep — Stages 1-6E
# ==================================================================
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/auth/me",
        "/reservations",
        "/analytics/summary",
        "/tasks",
        "/inventory",
        "/schedules",
        "/reviews",
        "/campaigns",
        "/properties",
        "/users/assignable",
    ])
    def test_admin_endpoints_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"

    def test_staff_cannot_post_reservations(self, staff_token):
        r = requests.post(f"{API}/reservations",
                          json={"property_id": "x", "guest_name": "y"},
                          headers=_h(staff_token), timeout=30)
        # Either 403 (forbidden) or 405 (method not allowed if no POST). RBAC is what matters.
        assert r.status_code in (403, 404, 405), f"Expected RBAC block, got {r.status_code}"

    def test_staff_cannot_view_reservations(self, staff_token):
        r = requests.get(f"{API}/reservations", headers=_h(staff_token), timeout=30)
        # Reservations are AUTH_MGR
        assert r.status_code == 403
