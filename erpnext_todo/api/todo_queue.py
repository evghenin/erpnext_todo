# Copyright (c) 2026, Evgheni Nemerenco and contributors
# License: MIT. See license.txt

from html import unescape

import frappe
from frappe.utils import cint, cstr, sanitize_html, strip_html, today

PRIORITIES = ("High", "Medium", "Low")
STATUSES = ("Open", "Closed", "Cancelled")
PAGE_SIZE = 20
MAX_START = 20
PREVIEW_LENGTH = 120
HEAVY_TAGS = {"img", "audio", "video", "canvas", "svg", "picture", "source", "iframe", "object", "embed"}


def on_todo_change(doc, method=None):
	users = set()
	if doc.allocated_to:
		users.add(doc.allocated_to)
	previous = doc.get_doc_before_save()
	if previous and previous.allocated_to:
		users.add(previous.allocated_to)
	for user in users:
		frappe.publish_realtime("erpnext_todo_queue_changed", user=user, after_commit=True)


@frappe.whitelist()
def get_queue_counts():
	user = _session_user()
	rows = frappe.db.sql(
		"""
		SELECT priority,
			COUNT(*) AS cnt,
			SUM(CASE WHEN `date` IS NOT NULL AND `date` != '' AND `date` < %s THEN 1 ELSE 0 END) AS overdue
		FROM `tabToDo`
		WHERE status = 'Open' AND allocated_to = %s
		GROUP BY priority
		""",
		(today(), user),
		as_dict=True,
	)
	counts = {priority: 0 for priority in PRIORITIES}
	has_overdue = False
	for row in rows:
		if row.priority in counts:
			counts[row.priority] = cint(row.cnt)
		if cint(row.overdue):
			has_overdue = True
	counts["has_overdue"] = has_overdue
	return counts


@frappe.whitelist()
def get_queue(priority=None, start=0):
	user = _session_user()
	priority = _clean_priority(priority)
	start = _clean_start(start)
	conditions = ["status = 'Open'", "allocated_to = %s"]
	values = [user]
	if priority:
		conditions.append("priority = %s")
		values.append(priority)
	values.extend([PAGE_SIZE, start])
	rows = frappe.db.sql(
		f"""
		SELECT name, description, priority, `date`, status, reference_type, reference_name
		FROM `tabToDo`
		WHERE {" AND ".join(conditions)}
		ORDER BY FIELD(priority, 'High', 'Medium', 'Low'),
			CASE WHEN `date` IS NULL OR `date` = '' THEN 1 ELSE 0 END,
			`date` ASC
		LIMIT %s OFFSET %s
		""",
		values,
		as_dict=True,
	)
	return [_row_payload(row) for row in rows]


@frappe.whitelist()
def get_todo_detail(name):
	doc = _own_todo(name)
	return {
		"name": doc.name,
		"description_html": _safe_html(doc.description),
		"priority": doc.priority,
		"date": cstr(doc.date or ""),
		"status": doc.status,
		"reference_type": doc.reference_type,
		"reference_name": doc.reference_name,
	}


@frappe.whitelist()
def set_todo_status(name, status):
	if status not in STATUSES:
		frappe.throw(frappe._("Invalid status"))
	doc = _own_todo(name)
	doc.status = status
	doc.save()
	return {"name": doc.name, "status": doc.status}


def _session_user():
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	return user


def _clean_priority(priority):
	if not priority:
		return None
	if priority not in PRIORITIES:
		frappe.throw(frappe._("Invalid priority"))
	return priority


def _clean_start(start):
	start = cint(start)
	if start < 0 or start > MAX_START:
		frappe.throw(frappe._("Invalid start"))
	return start


def _own_todo(name):
	_session_user()
	if not name or not isinstance(name, str):
		frappe.throw(frappe._("ToDo not found"), frappe.DoesNotExistError)
	allocated_to = frappe.db.get_value("ToDo", name, "allocated_to")
	if allocated_to is None and not frappe.db.exists("ToDo", name):
		frappe.throw(frappe._("ToDo not found"), frappe.DoesNotExistError)
	if allocated_to != frappe.session.user:
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	return frappe.get_doc("ToDo", name)


def _row_payload(row):
	return {
		"name": row.name,
		"preview": _preview(row.description),
		"priority": row.priority,
		"date": cstr(row.date or ""),
		"status": row.status,
		"reference_type": row.reference_type,
		"reference_name": row.reference_name,
	}


def _preview(description):
	text = unescape(strip_html(cstr(description or "")))
	text = " ".join(text.split())
	if len(text) <= PREVIEW_LENGTH:
		return text
	return text[: PREVIEW_LENGTH - 1].rstrip() + "…"


def _safe_html(description):
	return sanitize_html(cstr(description or ""), disallowed_tags=HEAVY_TAGS)

