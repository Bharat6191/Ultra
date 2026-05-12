"""Contractor rate negotiation module.

A rate goes through:
  draft -> pending_approval -> approved (active) | rejected | cancelled | expired

The package exposes:
  * ``models``        - SQLAlchemy ORM rows (contractor_rates, negotiation_logs,
                        negotiation_attachments, contractor_rate_audit_logs)
  * ``schema``        - Pydantic request/response shapes
  * ``audit``         - audit log helpers (action codes + write helper)
  * ``service``       - business logic (savings calc, rounds, submit, finalize)
  * ``timeline``      - merge audit + rounds + approvals into one feed
  * ``router_app``    - FastAPI routes (mounted at ``/`` and re-mounted at ``/admin``)
  * ``router_admin``  - admin re-mount wrapper
  * ``module_config`` - RBAC catalog for ``contractor_rates`` (Part Master lives in ``part_master``)
"""
