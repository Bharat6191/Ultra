from typing import Final

DEFAULT_PERMISSION_ACTIONS: Final[tuple[str, ...]] = ("view", "create", "update", "delete")


def normalize_segment(raw: str) -> str:
    return raw.strip().lower().replace("-", "_").replace(" ", "_")


def feature_storage_key(module_key: str, tab_key: str) -> str:
    """Stable ``features.key`` (letters/digits/underscores only)."""
    m = normalize_segment(module_key)
    t = normalize_segment(tab_key)
    if t == m:
        return m
    return f"{m}_{t}"


def build_permission_code(module_key: str, tab_key: str, action: str) -> str:
    """
    Canonical permission code: ``module.tab.action``, or ``module.action`` when the tab is the
    primary tab (tab key equals module key).
    """
    m = normalize_segment(module_key)
    t = normalize_segment(tab_key)
    a = normalize_segment(action)
    if a == "edit":
        a = "update"
    if t == m:
        return f"{m}.{a}"
    return f"{m}.{t}.{a}"


def permission_code(feature_key: str, action: str) -> str:
    """Generate a permission code for a single-tab feature (module == tab == ``feature_key``)."""
    return build_permission_code(feature_key, feature_key, action)
