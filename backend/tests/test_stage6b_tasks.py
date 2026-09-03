"""
Stage 6B — Tasks + Property extensions backend tests.
Runs against the public preview URL.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://str-analytics-core.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sourcebench.local"
ADMIN_PASSWORD = "ChangeMe123!"

# Tiny 1x1 PNG
TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def first_property(admin_token):
    r = requests.get(f"{BASE_URL}/api/properties", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    props = r.json()
    # accept list or {items: [...]}
    items = props if isinstance(props, list) else props.get("items") or props.get("properties") or []
    assert items, "no properties seeded"
    return items[0]


@pytest.fixture(scope="module")
def manager_and_staff(admin_token, first_property):
    ts = int(time.time())
    mgr_email = f"test_mgr_{ts}@sourcebench.local"
    staff_email = f"test_staff_{ts}@sourcebench.local"
    pw = "Test1234!"
    # create manager
    r = requests.post(f"{BASE_URL}/api/users", headers=_h(admin_token),
                      json={"name": "Test Manager", "email": mgr_email, "password": pw, "role": "manager"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    mgr = r.json()
    # create staff with assigned property
    r = requests.post(f"{BASE_URL}/api/users", headers=_h(admin_token),
                      json={"name": "Test Staff", "email": staff_email, "password": pw, "role": "staff",
                            "assigned_properties": [first_property["id"]]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    staff = r.json()
    mgr_token = _login(mgr_email, pw)
    staff_token = _login(staff_email, pw)
    yield {"mgr": mgr, "mgr_token": mgr_token, "staff": staff, "staff_token": staff_token}
    # cleanup
    for u in (mgr, staff):
        try:
            requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=_h(admin_token), timeout=30)
        except Exception:
            pass


# ---------- META / STATS ----------

def test_meta_requires_auth():
    r = requests.get(f"{BASE_URL}/api/tasks/meta", timeout=30)
    assert r.status_code == 401

def test_meta_admin(admin_token):
    r = requests.get(f"{BASE_URL}/api/tasks/meta", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert len(d["categories"]) == 8
    assert len(d["statuses"]) == 4
    assert len(d["priorities"]) == 4

def test_stats_admin(admin_token):
    r = requests.get(f"{BASE_URL}/api/tasks/stats", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("total", "by_status", "by_priority", "overdue", "mine_open"):
        assert k in d, f"missing {k}"


# ---------- CRUD ----------

@pytest.fixture(scope="module")
def created_task(admin_token, first_property):
    payload = {
        "title": "TEST_Maint_Task",
        "description": "smoke",
        "category": "maintenance",
        "priority": "high",
        "due_date": "2026-12-31",
        "property_id": first_property["id"],
        "checklist": ["step a", "step b", "step c"],
    }
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(admin_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    assert t.get("id")
    assert len(t["checklist"]) == 3
    yield t
    requests.delete(f"{BASE_URL}/api/tasks/{t['id']}", headers=_h(admin_token), timeout=30)


def test_list_returns_created(admin_token, created_task):
    r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()["items"]]
    assert created_task["id"] in ids

def test_list_filters_independent(admin_token, created_task, first_property):
    base = f"{BASE_URL}/api/tasks"
    for q in [
        "status=open", "category=maintenance", "priority=high",
        f"property_id={first_property['id']}", "mine=true",
    ]:
        r = requests.get(f"{base}?{q}", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{q} -> {r.status_code}"

def test_update_status_done(admin_token, created_task):
    r = requests.put(f"{BASE_URL}/api/tasks/{created_task['id']}", headers=_h(admin_token),
                     json={"title": "TEST_Maint_Updated", "description": "x", "status": "done",
                           "priority": "urgent", "due_date": "2027-01-15"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "done"
    assert d["completed_at"]
    assert d["completed_by"]
    assert d["priority"] == "urgent"
    # revert to open for downstream tests
    requests.put(f"{BASE_URL}/api/tasks/{created_task['id']}", headers=_h(admin_token),
                 json={"status": "open"}, timeout=30)


# ---------- CHECKLIST / COMMENTS ----------

def test_checklist_lifecycle(admin_token, created_task):
    tid = created_task["id"]
    r = requests.post(f"{BASE_URL}/api/tasks/{tid}/checklist", headers=_h(admin_token),
                      json={"text": "new step"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    item_id = r.json()["id"]
    # toggle
    r = requests.put(f"{BASE_URL}/api/tasks/{tid}/checklist/{item_id}", headers=_h(admin_token),
                     json={"done": True}, timeout=30)
    assert r.status_code == 200
    # verify
    t = requests.get(f"{BASE_URL}/api/tasks/{tid}", headers=_h(admin_token), timeout=30).json()
    match = [i for i in t["checklist"] if i["id"] == item_id][0]
    assert match["done"] is True
    assert match["done_at"]
    # delete
    r = requests.delete(f"{BASE_URL}/api/tasks/{tid}/checklist/{item_id}", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200


def test_comment_add(admin_token, created_task):
    r = requests.post(f"{BASE_URL}/api/tasks/{created_task['id']}/comments", headers=_h(admin_token),
                      json={"body": "hello world"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    c = r.json()
    assert c["body"] == "hello world"
    assert c["user_id"]
    assert c["user_name"]
    assert c["created_at"]


# ---------- PHOTOS ----------

def test_photo_add_ok(admin_token, created_task):
    r = requests.post(f"{BASE_URL}/api/tasks/{created_task['id']}/photos", headers=_h(admin_token),
                      json={"data_url": TINY_PNG, "label": "test"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    assert p["id"]
    # delete photo
    r2 = requests.delete(f"{BASE_URL}/api/tasks/{created_task['id']}/photos/{p['id']}", headers=_h(admin_token), timeout=30)
    assert r2.status_code == 200

def test_photo_reject_non_image(admin_token, created_task):
    r = requests.post(f"{BASE_URL}/api/tasks/{created_task['id']}/photos", headers=_h(admin_token),
                      json={"data_url": "data:text/plain;base64,Zm9v", "label": ""}, timeout=30)
    assert r.status_code == 400

def test_photo_reject_oversized(admin_token, created_task):
    big = "data:image/png;base64," + ("A" * 1_700_000)
    r = requests.post(f"{BASE_URL}/api/tasks/{created_task['id']}/photos", headers=_h(admin_token),
                      json={"data_url": big, "label": ""}, timeout=30)
    assert r.status_code == 413

def test_photo_cap_12(admin_token, created_task):
    tid = created_task["id"]
    added = []
    for i in range(12):
        r = requests.post(f"{BASE_URL}/api/tasks/{tid}/photos", headers=_h(admin_token),
                          json={"data_url": TINY_PNG, "label": f"p{i}"}, timeout=30)
        assert r.status_code in (200, 201), f"#{i}: {r.status_code} {r.text}"
        added.append(r.json()["id"])
    # 13th should fail
    r = requests.post(f"{BASE_URL}/api/tasks/{tid}/photos", headers=_h(admin_token),
                      json={"data_url": TINY_PNG, "label": "overflow"}, timeout=30)
    assert r.status_code == 400
    # cleanup
    for pid in added:
        requests.delete(f"{BASE_URL}/api/tasks/{tid}/photos/{pid}", headers=_h(admin_token), timeout=30)


# ---------- RBAC ----------

def test_manager_can_create_update_delete(admin_token, manager_and_staff, first_property):
    mt = manager_and_staff["mgr_token"]
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(mt),
                      json={"title": "TEST_mgr_task", "category": "admin", "property_id": first_property["id"]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    tid = r.json()["id"]
    r = requests.put(f"{BASE_URL}/api/tasks/{tid}", headers=_h(mt), json={"description": "updated"}, timeout=30)
    assert r.status_code == 200
    r = requests.delete(f"{BASE_URL}/api/tasks/{tid}", headers=_h(mt), timeout=30)
    assert r.status_code == 200

def test_staff_rbac(admin_token, manager_and_staff, first_property):
    st = manager_and_staff["staff_token"]
    staff_id = manager_and_staff["staff"]["id"]

    # Create a task at staff's property but NOT assigned to staff (admin creates)
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(admin_token),
                      json={"title": "TEST_unassigned", "category": "admin", "property_id": first_property["id"]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    unassigned_tid = r.json()["id"]

    # Create one assigned to staff
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(admin_token),
                      json={"title": "TEST_assigned", "category": "admin",
                            "property_id": first_property["id"], "assignee_id": staff_id}, timeout=30)
    assert r.status_code in (200, 201), r.text
    assigned_tid = r.json()["id"]

    # Staff list should include tasks at their property
    r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(st), timeout=30)
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()["items"]]
    assert unassigned_tid in ids and assigned_tid in ids

    # Staff cannot create
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(st),
                      json={"title": "x", "category": "admin"}, timeout=30)
    assert r.status_code == 403

    # Staff PUT on unassigned task with status -> 403 (not their task)
    r = requests.put(f"{BASE_URL}/api/tasks/{unassigned_tid}", headers=_h(st),
                     json={"status": "in_progress"}, timeout=30)
    assert r.status_code == 403, r.text

    # Staff PUT status on assigned task -> 200
    r = requests.put(f"{BASE_URL}/api/tasks/{assigned_tid}", headers=_h(st),
                     json={"status": "in_progress"}, timeout=30)
    assert r.status_code == 200, r.text

    # Staff cannot change title on assigned task
    r = requests.put(f"{BASE_URL}/api/tasks/{assigned_tid}", headers=_h(st),
                     json={"title": "hijack"}, timeout=30)
    assert r.status_code == 403

    # cleanup
    requests.delete(f"{BASE_URL}/api/tasks/{unassigned_tid}", headers=_h(admin_token), timeout=30)
    requests.delete(f"{BASE_URL}/api/tasks/{assigned_tid}", headers=_h(admin_token), timeout=30)


# ---------- PROPERTIES EXTENSIONS ----------

def test_properties_extended_fields_roundtrip(admin_token):
    payload = {
        "name": "TEST_PROP_ext",
        "property_name": "TEST",
        "unit_number": "99T",
        "complex": "Test Complex",
        "property_type": "Apartment",
        "address": "1 Test St",
        "key_collection_notes": "lockbox by door",
        "wifi_name": "TestWifi",
        "wifi_password": "pw1234",
        "parking_notes": "spot 9",
        "smart_lock_code": "1234#",
        "max_occupancy": 4,
        "checkin_time": "15:00",
        "checkout_time": "10:00",
        "ota_listings": {
            "airbnb_url": "https://airbnb.com/x",
            "booking_url": "https://booking.com/x",
            "stayz_url": "https://stayz.com/x",
            "vrbo_url": "https://vrbo.com/x",
            "expedia_url": "https://expedia.com/x",
        },
    }
    r = requests.post(f"{BASE_URL}/api/properties", headers=_h(admin_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    pid = p["id"]
    try:
        # GET back — no single GET endpoint, use list
        lst = requests.get(f"{BASE_URL}/api/properties", headers=_h(admin_token), timeout=30).json()
        items = lst if isinstance(lst, list) else lst.get("items", [])
        doc = next((x for x in items if x["id"] == pid), None)
        assert doc, "created property not found in list"
        for k in ("address", "key_collection_notes", "wifi_name", "wifi_password",
                  "parking_notes", "smart_lock_code", "checkin_time", "checkout_time"):
            assert doc.get(k) == payload[k], f"{k}: {doc.get(k)} != {payload[k]}"
        assert doc.get("max_occupancy") == 4
        ota = doc.get("ota_listings") or {}
        assert ota.get("airbnb_url") == "https://airbnb.com/x"
        assert ota.get("expedia_url") == "https://expedia.com/x"

        # PUT subset
        r = requests.put(f"{BASE_URL}/api/properties/{pid}", headers=_h(admin_token),
                         json={"wifi_password": "newpw!", "max_occupancy": 6}, timeout=30)
        assert r.status_code == 200, r.text
        # verify via list
        lst = requests.get(f"{BASE_URL}/api/properties", headers=_h(admin_token), timeout=30).json()
        items = lst if isinstance(lst, list) else lst.get("items", [])
        d = next((x for x in items if x["id"] == pid), None)
        assert d
        assert d.get("wifi_password") == "newpw!"
        assert d.get("max_occupancy") == 6
    finally:
        requests.delete(f"{BASE_URL}/api/properties/{pid}", headers=_h(admin_token), timeout=30)


# ---------- /users/assignable ----------

def test_assignable_open_to_all(admin_token, manager_and_staff):
    for tok in (admin_token, manager_and_staff["mgr_token"], manager_and_staff["staff_token"]):
        r = requests.get(f"{BASE_URL}/api/users/assignable", headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert items
        for u in items:
            assert "password_hash" not in u
            for k in ("id", "name", "email", "role"):
                assert k in u
