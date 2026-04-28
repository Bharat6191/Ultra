def __getattr__(name: str):
    if name == "router":
        from app_api.routes import router

        return router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["router"]
