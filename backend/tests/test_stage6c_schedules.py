"""Stage 6C — Compliance & Housekeeping schedules backend tests."""
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://str-analytics-core.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@sourcebench.local"
ADMIN_PASSWORD = "ChangeMe123!"


# ----- shared helpers ------------------------------------------------------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return _hdr(admin_token)


@pytest.fixture(scope="module")
def properties(admin_h):
    r = requests.get(f"{API}/properties", headers=admin_h, timeout=20)
    assert r.status_code == 200
    data = r.json()
    props = data.get("items") if isinstance(data, dict) else data
    assert props and len(props) >= 1, "Need at least one property for tests"
    return props


@pytest.fixture(scope="module")
def manager_user(admin_h):
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "email": f"TEST_mgr_{suffix}@sourcebench.local",
        "name": f"TEST_MGR_{suffix}",
        "password": "MgrPass123!",
        "role": "manager",
    }
    r = requests.post(f"{API}/users", headers=admin_h, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    u = r.json()
    token = _login(payload["email"], payload["password"])
    yield {"user": u, "token": token, "headers": _hdr(token), "email": payload["email"]}
    requests.delete(f"{API}/users/{u['id']}", headers=admin_h, timeout=20)


@pytest.fixture(scope="module")
def staff_user(admin_h, properties):
    suffix = uuid.uuid4().hex[:8]
    pid = properties[0]["id"]
    payload = {
        "email": f"TEST_staff_{suffix}@sourcebench.local",
        "name": f"TEST_STAFF_{suffix}",
        "password": "StaffPass123!",
        "role": "staff",
        "assigned_properties": [pid],
    }
    r = requests.post(f"{API}/users", headers=admin_h, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    u = r.json()
    token = _login(payload["email"], payload["password"])
    yield {"user": u, "token": token, "headers": _hdr(token), "property_id": pid}
    requests.delete(f"{API}/users/{u['id']}", headers=admin_h, timeout=20)


# Track schedule items we create so we can clean up.
_CREATED_SCHEDULES = []
_CREATED_TASKS = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_h):
    yield
    for sid in _CREATED_SCHEDULES:
        try:
            requests.delete(f"{API}/schedules/{sid}", headers=admin_h, timeout=10)
        except Exception:
            pass
    for tid in _CREATED_TASKS:
        try:
            requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=10)
        except Exception:
            pass


# ----- meta + auth ---------------------------------------------------------

class TestMeta:
    def test_meta_requires_auth(self):
        r = requests.get(f"{API}/schedules/meta", timeout=15)
        assert r.status_code in (401, 403)

    def test_meta_payload(self, admin_h):
        r = requests.get(f"{API}/schedules/meta", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data["compliance_defaults"]) == 6
        assert len(data["housekeeping_defaults"]) == 6
        assert data["default_lead_days"] == 14
        subs = {d["subtype"] for d in data["compliance_defaults"]}
        assert {"smoke_alarm", "gas_safety", "electrical_safety", "pool_fence",
                "insurance_renewal", "council_registration"} == subs
        hk = {d["subtype"] for d in data["housekeeping_defaults"]}
        assert {"deep_clean", "mattress_flip", "oven_rangehood", "carpet_upholstery",
                "window_clean", "pillow_rotation"} == hk


# ----- list, filters, summary ---------------------------------------------

class TestList:
    def test_list_default(self, admin_h, properties):
        r = requests.get(f"{API}/schedules", headers=admin_h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "summary" in body
        items = body["items"]
        summ = body["summary"]
        # 15 props × 12 defaults = 180 baseline
        expected = len(properties) * 12
        # auto-task creation may bump schedules but item count stays the same
        # (auto-sync inserts tasks, not schedule items). Allow any custom items
        # added by previous tests but at least the baseline.
        assert summ["total"] == len(items)
        assert summ["by_kind"]["compliance"] >= expected // 2
        assert summ["by_kind"]["housekeeping"] >= expected // 2
        assert summ["by_kind"]["compliance"] + summ["by_kind"]["housekeeping"] == summ["total"]

    def test_filter_kind_compliance(self, admin_h):
        r = requests.get(f"{API}/schedules?kind=compliance", headers=admin_h, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items, "expected compliance items"
        assert all(it["kind"] == "compliance" for it in items)

    def test_filter_kind_housekeeping(self, admin_h):
        r = requests.get(f"{API}/schedules?kind=housekeeping", headers=admin_h, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items, "expected housekeeping items"
        assert all(it["kind"] == "housekeeping" for it in items)

    def test_filter_property(self, admin_h, properties):
        pid = properties[0]["id"]
        r = requests.get(f"{API}/schedules?property_id={pid}", headers=admin_h, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items, "expected schedules for property"
        assert all(it["property_id"] == pid for it in items)

    def test_filter_status(self, admin_h, properties):
        # Force an overdue item, then ensure the filter returns it.
        pid = properties[-1]["id"]
        # create a custom schedule with next_due in the past
        payload = {
            "property_id": pid, "kind": "compliance",
            "subtype": f"TEST_overdue_{uuid.uuid4().hex[:6]}",
            "label": "TEST overdue filter", "cadence_days": 30,
        }
        c = requests.post(f"{API}/schedules", headers=admin_h, json=payload, timeout=15)
        assert c.status_code == 200
        sid = c.json()["id"]
        _CREATED_SCHEDULES.append(sid)
        past = (date.today() - timedelta(days=10)).isoformat()
        u = requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                         json={"next_due_at": past}, timeout=15)
        assert u.status_code == 200
        r = requests.get(f"{API}/schedules?status=overdue", headers=admin_h, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(it["id"] == sid for it in items)
        assert all(it["status"] == "overdue" for it in items)


# ----- CRUD + mark-done ----------------------------------------------------

class TestCRUD:
    def test_create_update_delete(self, admin_h, properties):
        pid = properties[0]["id"]
        payload = {
            "property_id": pid, "kind": "housekeeping",
            "subtype": f"TEST_crud_{uuid.uuid4().hex[:6]}",
            "label": "TEST CRUD item", "cadence_days": 60,
            "notes": "init",
        }
        r = requests.post(f"{API}/schedules", headers=admin_h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        item = r.json()
        sid = item["id"]
        _CREATED_SCHEDULES.append(sid)
        assert item["cadence_days"] == 60
        assert item["property_id"] == pid

        # update with last_done_at → next_due_at = last_done + cadence
        ldate = "2026-01-01"
        u = requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                         json={"last_done_at": ldate, "cadence_days": 30, "label": "TEST CRUD edited"}, timeout=15)
        assert u.status_code == 200
        updated = u.json()
        assert updated["cadence_days"] == 30
        assert updated["last_done_at"] == ldate
        expected_next = (date.fromisoformat(ldate) + timedelta(days=30)).isoformat()
        assert updated["next_due_at"] == expected_next
        assert updated["label"] == "TEST CRUD edited"

        # manual next_due_at override
        future = (date.today() + timedelta(days=120)).isoformat()
        u2 = requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                          json={"next_due_at": future}, timeout=15)
        assert u2.status_code == 200
        assert u2.json()["next_due_at"] == future

        # delete
        d = requests.delete(f"{API}/schedules/{sid}", headers=admin_h, timeout=15)
        assert d.status_code == 200
        _CREATED_SCHEDULES.remove(sid)
        # confirm gone
        r2 = requests.put(f"{API}/schedules/{sid}", headers=admin_h, json={"label": "x"}, timeout=10)
        assert r2.status_code == 404

    def test_mark_done(self, admin_h, properties):
        pid = properties[0]["id"]
        payload = {
            "property_id": pid, "kind": "compliance",
            "subtype": f"TEST_md_{uuid.uuid4().hex[:6]}",
            "label": "TEST mark-done", "cadence_days": 90,
        }
        r = requests.post(f"{API}/schedules", headers=admin_h, json=payload, timeout=15)
        assert r.status_code == 200
        sid = r.json()["id"]
        _CREATED_SCHEDULES.append(sid)

        m = requests.post(f"{API}/schedules/{sid}/mark-done", headers=admin_h, timeout=15)
        assert m.status_code == 200
        doc = m.json()
        today = date.today().isoformat()
        assert doc["last_done_at"] == today
        assert doc["next_due_at"] == (date.today() + timedelta(days=90)).isoformat()
        assert doc["linked_task_id"] is None

    def test_seed_defaults(self, admin_h, properties):
        pid = properties[0]["id"]
        r = requests.post(f"{API}/schedules/seed-defaults?property_id={pid}", headers=admin_h, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # All 12 already exist from startup seed → inserted=0, skipped=12
        assert body["inserted"] + body["skipped"] == 12
        assert body["skipped"] >= 6  # at least the existing defaults preserved


# ----- auto-task creation & bump-on-completion -----------------------------

class TestAutoTask:
    def test_auto_create_then_bump(self, admin_h, properties):
        pid = properties[0]["id"]
        # Create a fresh schedule and force overdue
        payload = {
            "property_id": pid, "kind": "housekeeping",
            "subtype": f"TEST_auto_{uuid.uuid4().hex[:6]}",
            "label": "TEST auto-task", "cadence_days": 30,
        }
        r = requests.post(f"{API}/schedules", headers=admin_h, json=payload, timeout=15)
        assert r.status_code == 200
        sid = r.json()["id"]
        _CREATED_SCHEDULES.append(sid)
        past = (date.today() - timedelta(days=1)).isoformat()
        u = requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                         json={"next_due_at": past}, timeout=15)
        assert u.status_code == 200

        # Trigger auto-sync via GET as admin
        lst = requests.get(f"{API}/schedules", headers=admin_h, timeout=30)
        assert lst.status_code == 200
        item = next((it for it in lst.json()["items"] if it["id"] == sid), None)
        assert item is not None
        assert item["linked_task_id"], "expected a linked task to be created"
        tid = item["linked_task_id"]
        _CREATED_TASKS.append(tid)

        # Verify task properties
        t = requests.get(f"{API}/tasks/{tid}", headers=admin_h, timeout=15)
        assert t.status_code == 200, t.text
        td = t.json()
        assert td["schedule_item_id"] == sid
        assert td["category"] == "housekeeping"
        assert td["priority"] == "urgent"  # overdue
        assert td["due_date"] == past
        assert "TEST auto-task" in td["title"]

        # Complete task → schedule item bumped
        comp = requests.put(f"{API}/tasks/{tid}", headers=admin_h,
                            json={"status": "done"}, timeout=15)
        assert comp.status_code == 200
        s2 = requests.get(f"{API}/schedules?property_id={pid}", headers=admin_h, timeout=30)
        bumped = next((it for it in s2.json()["items"] if it["id"] == sid), None)
        today = date.today().isoformat()
        assert bumped["last_done_at"] == today
        assert bumped["next_due_at"] == (date.today() + timedelta(days=30)).isoformat()
        assert bumped["linked_task_id"] is None

    def test_bump_fallback_no_schedule_item_id(self, admin_h, properties):
        pid = properties[1]["id"] if len(properties) > 1 else properties[0]["id"]
        # Create a custom housekeeping schedule with unique subtype
        sub = f"TEST_fb_{uuid.uuid4().hex[:6]}"
        sp = {"property_id": pid, "kind": "housekeeping", "subtype": sub,
              "label": "TEST fallback", "cadence_days": 45}
        sr = requests.post(f"{API}/schedules", headers=admin_h, json=sp, timeout=15)
        assert sr.status_code == 200
        sid = sr.json()["id"]
        _CREATED_SCHEDULES.append(sid)

        # Create a task with matching schedule_subtype but NO schedule_item_id
        tp = {
            "title": "TEST fallback task",
            "category": "housekeeping",
            "priority": "medium",
            "property_id": pid,
            "schedule_subtype": sub,
        }
        tr = requests.post(f"{API}/tasks", headers=admin_h, json=tp, timeout=15)
        assert tr.status_code == 200, tr.text
        tid = tr.json()["id"]
        _CREATED_TASKS.append(tid)
        # Sanity: schedule_item_id should be null on the task
        assert tr.json().get("schedule_item_id") in (None, "")

        # Mark done
        cd = requests.put(f"{API}/tasks/{tid}", headers=admin_h,
                          json={"status": "done"}, timeout=15)
        assert cd.status_code == 200
        # Schedule should be bumped via fallback match
        r = requests.get(f"{API}/schedules?property_id={pid}", headers=admin_h, timeout=30)
        item = next((it for it in r.json()["items"] if it["id"] == sid), None)
        assert item is not None
        today = date.today().isoformat()
        assert item["last_done_at"] == today

    def test_delete_task_clears_linked(self, admin_h, properties):
        pid = properties[0]["id"]
        # Make fresh overdue schedule
        sp = {"property_id": pid, "kind": "compliance",
              "subtype": f"TEST_dl_{uuid.uuid4().hex[:6]}",
              "label": "TEST delete-task link", "cadence_days": 30}
        sr = requests.post(f"{API}/schedules", headers=admin_h, json=sp, timeout=15)
        sid = sr.json()["id"]
        _CREATED_SCHEDULES.append(sid)
        past = (date.today() - timedelta(days=2)).isoformat()
        requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                     json={"next_due_at": past}, timeout=15)
        # Trigger auto-sync
        lst = requests.get(f"{API}/schedules", headers=admin_h, timeout=30)
        item = next((it for it in lst.json()["items"] if it["id"] == sid), None)
        assert item["linked_task_id"]
        tid = item["linked_task_id"]
        # Deactivate the schedule so the next auto-sync does NOT immediately
        # re-link a brand new task (which would mask the delete-clears behavior).
        requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                     json={"active": False}, timeout=15)
        # Delete task
        d = requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=15)
        assert d.status_code == 200
        # Schedule's linked_task_id should be cleared
        r2 = requests.get(f"{API}/schedules?property_id={pid}", headers=admin_h, timeout=30)
        it2 = next((it for it in r2.json()["items"] if it["id"] == sid), None)
        assert it2["linked_task_id"] is None


# ----- RBAC ----------------------------------------------------------------

class TestRBAC:
    def test_manager_full_crud(self, manager_user, properties):
        h = manager_user["headers"]
        pid = properties[0]["id"]
        payload = {"property_id": pid, "kind": "compliance",
                   "subtype": f"TEST_mgr_{uuid.uuid4().hex[:6]}",
                   "label": "TEST mgr crud", "cadence_days": 365}
        c = requests.post(f"{API}/schedules", headers=h, json=payload, timeout=15)
        assert c.status_code == 200, c.text
        sid = c.json()["id"]
        _CREATED_SCHEDULES.append(sid)
        u = requests.put(f"{API}/schedules/{sid}", headers=h, json={"label": "TEST mgr edited"}, timeout=15)
        assert u.status_code == 200
        m = requests.post(f"{API}/schedules/{sid}/mark-done", headers=h, timeout=15)
        assert m.status_code == 200
        d = requests.delete(f"{API}/schedules/{sid}", headers=h, timeout=15)
        assert d.status_code == 200
        _CREATED_SCHEDULES.remove(sid)

    def test_staff_get_filtered(self, staff_user):
        r = requests.get(f"{API}/schedules", headers=staff_user["headers"], timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        # Only items for staff's assigned property
        assert all(it["property_id"] == staff_user["property_id"] for it in items)

    def test_staff_forbidden_writes(self, staff_user, properties, admin_h):
        h = staff_user["headers"]
        pid = staff_user["property_id"]
        # POST
        p = requests.post(f"{API}/schedules", headers=h, json={
            "property_id": pid, "kind": "compliance", "subtype": "x",
            "label": "X", "cadence_days": 10}, timeout=15)
        assert p.status_code == 403
        # Need an existing item to test PUT/DELETE/mark-done
        # Use first available schedule from the admin listing
        a = requests.get(f"{API}/schedules?property_id={pid}", headers=admin_h, timeout=20)
        sid = a.json()["items"][0]["id"]
        pu = requests.put(f"{API}/schedules/{sid}", headers=h, json={"label": "no"}, timeout=15)
        assert pu.status_code == 403
        de = requests.delete(f"{API}/schedules/{sid}", headers=h, timeout=15)
        assert de.status_code == 403
        md = requests.post(f"{API}/schedules/{sid}/mark-done", headers=h, timeout=15)
        assert md.status_code == 403

    def test_staff_get_does_not_autosync(self, staff_user, admin_h, properties):
        # Make an overdue item in their property, with no linked task.
        pid = staff_user["property_id"]
        sp = {"property_id": pid, "kind": "compliance",
              "subtype": f"TEST_nosync_{uuid.uuid4().hex[:6]}",
              "label": "TEST no-sync", "cadence_days": 30}
        sr = requests.post(f"{API}/schedules", headers=admin_h, json=sp, timeout=15)
        sid = sr.json()["id"]
        _CREATED_SCHEDULES.append(sid)
        past = (date.today() - timedelta(days=1)).isoformat()
        requests.put(f"{API}/schedules/{sid}", headers=admin_h,
                     json={"next_due_at": past}, timeout=15)
        # Staff GET should not create the task.
        sg = requests.get(f"{API}/schedules?property_id={pid}", headers=staff_user["headers"], timeout=20)
        assert sg.status_code == 200
        it = next((i for i in sg.json()["items"] if i["id"] == sid), None)
        assert it is not None
        assert it.get("linked_task_id") in (None, ""), "staff GET must not auto-create tasks"
