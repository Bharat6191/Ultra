class NotFoundError(Exception):
    def __init__(self, entity: str, id_: int | str) -> None:
        self.entity = entity
        self.id = id_
        super().__init__(f"{entity} {id_!r} not found")


class ConflictError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class RbacSafetyError(Exception):
    """RBAC mutation blocked by a production guardrail."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
